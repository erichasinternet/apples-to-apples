import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  expandTargets,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import {
  validateIdealDomainSplits,
  type IdealDomainSplits
} from "./ideal-dataset-lib";

const candidatePath = path.resolve(
  process.argv[2] ?? "benchmarks/live-sites/qualification-wave-01.json"
);
const existingPath = path.resolve("benchmarks/live-sites/targets.json");
const splitPath = path.resolve("benchmarks/ideal-domain-splits.json");
const promotionPath = path.resolve(
  "benchmarks/domain-qualification/promotions.json"
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
const gatePath = path.resolve(
  "benchmarks/domain-qualification/wave-01-p00.json"
);
const [candidate, existing, splits, promotions, gateSource] = await Promise.all([
  readJson<CorpusTargetManifest>(candidatePath),
  readJson<CorpusTargetManifest>(existingPath),
  readJson<IdealDomainSplits>(splitPath),
  readJson<PromotionManifest>(promotionPath),
  readJson<{ qualificationGate: QualificationGate }>(gatePath)
]);
const gate = gateSource.qualificationGate;
const errors = validateIdealDomainSplits(splits);
const existingIds = new Set(existing.sites.map((site) => site.id));
const existingHosts = new Set(existing.sites.map((site) => site.hostname));
const candidateIds = new Set<string>();
const candidateHosts = new Set<string>();

for (const site of candidate.sites) {
  if (candidateIds.has(site.id)) errors.push(`duplicate candidate site id: ${site.id}`);
  if (candidateHosts.has(site.hostname)) {
    errors.push(`duplicate candidate hostname: ${site.hostname}`);
  }
  if (existingIds.has(site.id)) errors.push(`candidate site already exists: ${site.id}`);
  if (existingHosts.has(site.hostname)) {
    errors.push(`candidate hostname already exists: ${site.hostname}`);
  }
  candidateIds.add(site.id);
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
  if (!candidateIds.has(promotion.siteId)) {
    errors.push(`promotion references unknown candidate: ${promotion.siteId}`);
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

let targets = 0;
try {
  targets = expandTargets(candidate).length;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
const dimensions = new Set(
  Object.values(candidate.querySets ?? {})
    .flat()
    .map((query) => query.dimension)
);
const strata = new Set(candidate.sites.map((site) => site.stratum));
if (dimensions.size < 5) errors.push("qualification wave must cover all five dimensions");
if (strata.size < 8) errors.push("qualification wave must cover at least eight strata");

const report = {
  valid: errors.length === 0,
  candidatePath,
  sites: candidate.sites.length,
  targets,
  strata: strata.size,
  dimensions: [...dimensions].sort(),
  promotedSites: promotions.promotions.length,
  errors
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
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
