import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  expandTargets,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import {
  validateIdealDomainSplits,
  type IdealDomainSplits
} from "./ideal-dataset-lib";

const candidatePaths =
  process.argv.length > 2
    ? process.argv.slice(2).map((filename) => path.resolve(filename))
    : await discoverCandidatePaths();
const existingPath = path.resolve("benchmarks/live-sites/targets.json");
const splitPath = path.resolve("benchmarks/ideal-domain-splits.json");
const promotionPath = path.resolve(
  "benchmarks/domain-qualification/promotions.json"
);
const eligibleCapturePath = path.resolve(
  "benchmarks/capture-pilots/eligible-captures.json"
);
interface PromotionManifest {
  version: 1;
  promotions: Array<{
    siteId: string;
    cohort: "training" | "validation" | "selection" | "final";
    qualificationReport: string;
    promotedAt: string;
  }>;
}
interface EligibleCaptureManifest {
  version: 1;
  captures: Array<{
    siteId: string;
    cohort: "training" | "validation" | "selection" | "final";
    pageId: string;
    captureTimestamp: string;
    observationSha256: string;
    annotationScreenshotSha256: string;
    qualificationReport: string;
    pilotReport: string;
    machineValidation: "passed";
    visualValidation: "passed";
  }>;
}
interface QualificationGate {
  minimumDistinctListingPages: number;
  requiredViewportProfiles: Array<"desktop" | "narrow">;
  minimumCandidatesPerPage: number;
  maximumUnresolvedObstructionCoverage: number;
  minimumQueryTokenCoverage: number;
  requiredMachineValidation: boolean;
  requiredVisualValidation: boolean;
  allowTruncatedObservation: boolean;
}
interface QualificationPageEvidence {
  pageId: string;
  viewportProfile: "desktop" | "narrow";
  candidateCount: number;
  observationTruncated: boolean;
  unresolvedObstructionCoverage: number;
  queryTokenCoverage: number;
  machineValidation: string;
  visualValidation: string;
}
interface QualificationReport {
  results?: Record<
    string,
    { status?: string; pages?: QualificationPageEvidence[] }
  >;
  decision?: {
    qualifiedDomains?: string[];
    assignedDomains?: Array<{ siteId: string; cohort: string }>;
  };
}
const SHA256 = /^[a-f0-9]{64}$/;
const gatePath = path.resolve(
  "benchmarks/domain-qualification/wave-01-p00.json"
);
const [candidates, existing, splits, promotions, eligibleCaptures, gateSource] =
  await Promise.all([
    Promise.all(
      candidatePaths.map((filename) => readJson<CorpusTargetManifest>(filename))
    ),
    readJson<CorpusTargetManifest>(existingPath),
    readJson<IdealDomainSplits>(splitPath),
    readJson<PromotionManifest>(promotionPath),
    readJson<EligibleCaptureManifest>(eligibleCapturePath),
    readJson<{ qualificationGate: QualificationGate }>(gatePath)
  ]);
const gate = gateSource.qualificationGate;
const errors = validateIdealDomainSplits(splits);
const existingIds = new Set(existing.sites.map((site) => site.id));
const existingHosts = new Set(existing.sites.map((site) => site.hostname));
const candidateIds = new Set<string>();
const candidateHosts = new Set<string>();
const knownIds = new Set(existingIds);

for (const [manifestIndex, candidate] of candidates.entries()) {
  const candidateLabel = path.basename(candidatePaths[manifestIndex]!);
  for (const site of candidate.sites) {
    if (candidateIds.has(site.id)) {
      errors.push(`duplicate candidate site id: ${site.id}`);
    }
    if (candidateHosts.has(site.hostname)) {
      errors.push(`duplicate candidate hostname: ${site.hostname}`);
    }
    if (existingIds.has(site.id)) {
      errors.push(`candidate site already exists: ${site.id}`);
    }
    if (existingHosts.has(site.hostname)) {
      errors.push(`candidate hostname already exists: ${site.hostname}`);
    }
    candidateIds.add(site.id);
    knownIds.add(site.id);
    candidateHosts.add(site.hostname);
    const searchUrl = new URL(
      site.searchUrlTemplate
        .replaceAll("{query}", "test")
        .replaceAll("{querySlug}", "test")
    );
    if (searchUrl.protocol !== "https:") {
      errors.push(`${site.id} search URL must use HTTPS`);
    }
    if (searchUrl.hostname !== site.hostname) {
      errors.push(`${site.id} hostname does not match its search URL`);
    }
  }
  try {
    expandTargets(candidate);
  } catch (error) {
    errors.push(
      `${candidateLabel}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const waveDimensions = new Set(
    [
      ...Object.values(candidate.querySets ?? {}).flat(),
      ...candidate.sites.flatMap((site) => site.queries ?? [])
    ].map((query) => query.dimension)
  );
  const waveStrata = new Set(candidate.sites.map((site) => site.stratum));
  if (waveDimensions.size < 5) {
    errors.push(
      `${candidateLabel}: qualification wave must cover all five dimensions`
    );
  }
  if (waveStrata.size < 8) {
    errors.push(
      `${candidateLabel}: qualification wave must cover at least eight strata`
    );
  }
}

const assigned = new Set([
  ...splits.training,
  ...splits.validation,
  ...splits.selection,
  ...splits.final,
  ...splits.retired
]);
const assignmentCohort = new Map<string, string>([
  ...splits.training.map((siteId) => [siteId, "training"] as const),
  ...splits.validation.map((siteId) => [siteId, "validation"] as const),
  ...splits.selection.map((siteId) => [siteId, "selection"] as const),
  ...splits.final.map((siteId) => [siteId, "final"] as const),
  ...splits.retired.map((siteId) => [siteId, "retired"] as const)
]);
const promotionBySite = new Map(
  promotions.promotions.map((promotion) => [promotion.siteId, promotion])
);
if (promotionBySite.size !== promotions.promotions.length) {
  errors.push("promotion manifest contains duplicate site ids");
}
for (const siteId of candidateIds) {
  if (!assigned.has(siteId)) continue;
  const promotion = promotionBySite.get(siteId);
  if (!promotion) {
    errors.push(`assigned candidate lacks qualification promotion: ${siteId}`);
    continue;
  }
  if (promotion.cohort !== assignmentCohort.get(siteId)) {
    errors.push(`promotion cohort does not match assignment: ${siteId}`);
  }
}
for (const promotion of promotions.promotions) {
  if (!knownIds.has(promotion.siteId)) {
    errors.push(`promotion references unknown site: ${promotion.siteId}`);
    continue;
  }
  if (!assigned.has(promotion.siteId)) {
    errors.push(`promoted candidate is not assigned: ${promotion.siteId}`);
  } else if (assignmentCohort.get(promotion.siteId) !== promotion.cohort) {
    errors.push(`promoted candidate cohort does not match assignment: ${promotion.siteId}`);
  }
  if (!Number.isFinite(Date.parse(promotion.promotedAt))) {
    errors.push(`promotion has invalid timestamp: ${promotion.siteId}`);
  }
  try {
    const report = await readJson<QualificationReport>(
      path.resolve(promotion.qualificationReport)
    );
    if (!report.decision?.qualifiedDomains?.includes(promotion.siteId)) {
      errors.push(
        `promotion report does not qualify candidate: ${promotion.siteId}`
      );
    }
    if (
      !report.decision?.assignedDomains?.some(
        (assignment) =>
          assignment.siteId === promotion.siteId &&
          assignment.cohort === promotion.cohort
      )
    ) {
      errors.push(
        `promotion report does not assign candidate cohort: ${promotion.siteId}`
      );
    }
    validatePromotionEvidence(promotion.siteId, report, gate, errors);
  } catch {
    errors.push(`promotion report is unreadable: ${promotion.siteId}`);
  }
}

const eligibleObservationHashes = new Set<string>();
const eligiblePageSources = new Set<string>();
for (const capture of eligibleCaptures.captures) {
  if (!SHA256.test(capture.observationSha256)) {
    errors.push(`eligible capture has invalid observation hash: ${capture.pageId}`);
  }
  if (!SHA256.test(capture.annotationScreenshotSha256)) {
    errors.push(`eligible capture has invalid screenshot hash: ${capture.pageId}`);
  }
  if (!Number.isFinite(Date.parse(capture.captureTimestamp))) {
    errors.push(`eligible capture has invalid timestamp: ${capture.pageId}`);
  }
  if (eligibleObservationHashes.has(capture.observationSha256)) {
    errors.push(`duplicate eligible observation hash: ${capture.observationSha256}`);
  }
  eligibleObservationHashes.add(capture.observationSha256);
  const pageSource = `${capture.pageId}\0${capture.observationSha256}`;
  if (eligiblePageSources.has(pageSource)) {
    errors.push(`duplicate eligible capture: ${capture.pageId}`);
  }
  eligiblePageSources.add(pageSource);
  const promotion = promotionBySite.get(capture.siteId);
  if (!promotion || promotion.cohort !== capture.cohort) {
    errors.push(`eligible capture lacks matching domain promotion: ${capture.pageId}`);
  } else if (promotion.qualificationReport !== capture.qualificationReport) {
    errors.push(`eligible capture qualification report mismatch: ${capture.pageId}`);
  }
  if (!capture.pageId.startsWith(`${capture.siteId}--`)) {
    errors.push(`eligible capture page id does not match site: ${capture.pageId}`);
  }
  if (
    capture.machineValidation !== "passed" ||
    capture.visualValidation !== "passed"
  ) {
    errors.push(`eligible capture lacks validation: ${capture.pageId}`);
  }
  for (const reportPath of [
    capture.qualificationReport,
    capture.pilotReport
  ]) {
    try {
      await readFile(path.resolve(reportPath));
    } catch {
      errors.push(`eligible capture report is unreadable: ${reportPath}`);
    }
  }
}
for (const promotion of promotions.promotions) {
  if (
    !eligibleCaptures.captures.some(
      (capture) =>
        capture.siteId === promotion.siteId &&
        capture.cohort === promotion.cohort
    )
  ) {
    errors.push(`promoted domain lacks an eligible live capture: ${promotion.siteId}`);
  }
}

let targets = 0;
for (const candidate of candidates) {
  try {
    targets += expandTargets(candidate).length;
  } catch {
    // The wave-specific expansion error is already reported above.
  }
}
const dimensions = new Set(
  candidates
    .flatMap((candidate) => [
      ...Object.values(candidate.querySets ?? {}).flat(),
      ...candidate.sites.flatMap((site) => site.queries ?? [])
    ])
    .map((query) => query.dimension)
);
const strata = new Set(
  candidates.flatMap((candidate) =>
    candidate.sites.map((site) => site.stratum)
  )
);

const report = {
  valid: errors.length === 0,
  candidatePaths,
  waves: candidates.length,
  sites: candidates.reduce(
    (total, candidate) => total + candidate.sites.length,
    0
  ),
  targets,
  strata: strata.size,
  dimensions: [...dimensions].sort(),
  promotedSites: promotions.promotions.length,
  eligibleCaptures: eligibleCaptures.captures.length,
  errors
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

async function discoverCandidatePaths(): Promise<string[]> {
  const directory = path.resolve("benchmarks/live-sites");
  const paths = (await readdir(directory))
    .filter((filename) => /^qualification-wave-\d+\.json$/.test(filename))
    .sort()
    .map((filename) => path.join(directory, filename));
  if (paths.length === 0) {
    throw new Error("No qualification-wave manifests were found.");
  }
  return paths;
}

function validatePromotionEvidence(
  siteId: string,
  report: QualificationReport,
  gate: QualificationGate,
  errors: string[]
): void {
  const result = report.results?.[siteId];
  if (result?.status !== "qualified") {
    errors.push(`promotion evidence is not qualified: ${siteId}`);
    return;
  }
  const pages = result.pages ?? [];
  const pageIds = new Set(pages.map((page) => page.pageId));
  if (pageIds.size < gate.minimumDistinctListingPages) {
    errors.push(`promotion lacks distinct listing pages: ${siteId}`);
  }
  const viewports = new Set(pages.map((page) => page.viewportProfile));
  for (const viewport of gate.requiredViewportProfiles) {
    if (!viewports.has(viewport)) {
      errors.push(`promotion lacks ${viewport} evidence: ${siteId}`);
    }
  }
  for (const page of pages) {
    if (!page.pageId?.trim()) {
      errors.push(`promotion page id is missing: ${siteId}`);
    }
    if (
      !Number.isInteger(page.candidateCount) ||
      page.candidateCount < gate.minimumCandidatesPerPage
    ) {
      errors.push(`promotion page has too few candidates: ${page.pageId}`);
    }
    if (
      !Number.isFinite(page.unresolvedObstructionCoverage) ||
      page.unresolvedObstructionCoverage < 0 ||
      page.unresolvedObstructionCoverage >
      gate.maximumUnresolvedObstructionCoverage
    ) {
      errors.push(`promotion page exceeds obstruction gate: ${page.pageId}`);
    }
    if (
      !Number.isFinite(page.queryTokenCoverage) ||
      page.queryTokenCoverage < gate.minimumQueryTokenCoverage ||
      page.queryTokenCoverage > 1
    ) {
      errors.push(`promotion page lacks requested-query evidence: ${page.pageId}`);
    }
    if (gate.requiredMachineValidation && page.machineValidation !== "passed") {
      errors.push(`promotion page lacks machine validation: ${page.pageId}`);
    }
    if (gate.requiredVisualValidation && page.visualValidation !== "passed") {
      errors.push(`promotion page lacks visual validation: ${page.pageId}`);
    }
    if (
      !gate.allowTruncatedObservation &&
      page.observationTruncated !== false
    ) {
      errors.push(`promotion page observation is truncated: ${page.pageId}`);
    }
  }
}
