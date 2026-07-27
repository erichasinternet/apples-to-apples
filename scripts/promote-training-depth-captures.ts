import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  validateCaptureProvenance,
  type CaptureProvenance
} from "./capture-provenance-lib";
import {
  prepareCaptureReplacements,
  type CaptureReplacementSpec,
  type RegistrableCaptureEntry,
  type RetiredCaptureEntry
} from "./capture-retirement-lib";

interface DepthSpec {
  version: 1;
  pilotId: string;
  capturedAt: string;
  sourceManifest: string;
  requestedCaptureAttempts: number;
  runs: Array<{
    runDirectory: string;
    pageIds: string[];
  }>;
  samplingFinding: string;
  visualValidationFinding: string;
  replacements?: CaptureReplacementSpec[];
}

interface TargetManifest {
  version: 1;
  sites: Array<{
    id: string;
    hostname: string;
    stratum: string;
  }>;
}

interface CaptureRun {
  version: 1;
  runId: string;
  anonymousContext: true;
  limits: {
    pageTimeoutMs: number;
    cardScreenshotBudgetMs: number;
  };
  requestedPages: number;
  capturedPages: number;
  complete: boolean;
  results: Array<{
    pageId: string;
    status: "captured" | "blocked" | "error";
    viewport?: {
      profile: "desktop" | "narrow";
      width: number;
      height: number;
    };
  }>;
}

interface CapturePage {
  pageId: string;
  capturedAt: string;
  target: {
    hostname: string;
  };
  viewport: {
    width: number;
    height: number;
  };
  httpStatus: number | null;
  blocked: boolean;
  redactionCount: number;
  candidateCount: number;
  candidateScreenshotsCaptured: number;
  observationNodeCount: number;
  observationTruncated: boolean;
  dismissedObstructions: number;
  unresolvedObstructionCoverage: number;
  queryTokenCoverage: number;
  mainScreenshotCaptured: boolean;
  annotationScreenshotCaptured: boolean;
  observationSha256: string;
}

interface PromotionManifest {
  version: 1;
  promotions: Array<{
    siteId: string;
    cohort: "training" | "validation" | "selection" | "final";
    qualificationReport: string;
  }>;
}

interface EligibleCaptureManifest {
  version: 1;
  captures: RegistrableCaptureEntry[];
}

interface RetiredCaptureManifest {
  version: 1;
  captures: RetiredCaptureEntry[];
}

const options = optionMap(process.argv.slice(2));
const specPath = requiredPath(options, "--spec");
const outputPath = requiredPath(options, "--output");
const registryPath = path.resolve(
  options.get("--registry") ??
    "benchmarks/capture-pilots/eligible-captures.json"
);
const promotionPath = path.resolve(
  options.get("--promotions") ??
    "benchmarks/domain-qualification/promotions.json"
);
const retiredRegistryPath = path.resolve(
  options.get("--retired-registry") ??
    "benchmarks/capture-pilots/retired-captures.json"
);

const spec = await readJson<DepthSpec>(specPath);
if (
  spec.version !== 1 ||
  !spec.pilotId ||
  !Number.isFinite(Date.parse(spec.capturedAt)) ||
  !Number.isInteger(spec.requestedCaptureAttempts) ||
  spec.requestedCaptureAttempts < 1 ||
  spec.runs.length < 1
) {
  throw new Error("Depth promotion spec is invalid.");
}

const manifestPath = path.resolve(spec.sourceManifest);
const [manifestBytes, manifest, promotions, registry, retiredRegistry] =
  await Promise.all([
    readFile(manifestPath),
    readJson<TargetManifest>(manifestPath),
    readJson<PromotionManifest>(promotionPath),
    readJson<EligibleCaptureManifest>(registryPath),
    readJson<RetiredCaptureManifest>(retiredRegistryPath)
  ]);
const sourceManifestSha256 = sha256(manifestBytes);
const sites = new Map(manifest.sites.map((site) => [site.id, site]));
const promotionBySite = new Map(
  promotions.promotions.map((promotion) => [promotion.siteId, promotion])
);
const pilotReport = path.relative(process.cwd(), outputPath);
const replacementState = prepareCaptureReplacements({
  captures: registry.captures,
  retiredCaptures: retiredRegistry.captures,
  replacements: spec.replacements ?? [],
  replacementPilotReport: pilotReport,
  retiredAt: spec.capturedAt
});
const pilotReplacements = (spec.replacements ?? []).map((replacement) => {
  const retirement = replacementState.retiredCaptures.find(
    (capture) =>
      capture.pageId === replacement.pageId &&
      capture.observationSha256 === replacement.priorObservationSha256 &&
      capture.replacementPilotReport === pilotReport
  );
  if (!retirement) {
    throw new Error(`${replacement.pageId}: replacement retirement is absent`);
  }
  return {
    ...replacement,
    retiredAt: retirement.retiredAt
  };
});
const retainedRegistryCaptures = replacementState.retainedCaptures;
const existingPages = new Set(
  retainedRegistryCaptures.map((capture) => capture.pageId)
);
const existingObservationHashes = new Set(
  retainedRegistryCaptures.map((capture) => capture.observationSha256)
);
const acceptedPages = new Set<string>();
const acceptedCohorts = new Set<
  "training" | "validation" | "selection" | "final"
>();
const collectorHashes = new Set<string>();
const reportRuns = [];
const reportCaptures = [];
const registryCaptures = [];
let successfulCaptureAttempts = 0;
let requestedCaptureAttempts = 0;

for (const runSpec of spec.runs) {
  const runDirectory = path.resolve(runSpec.runDirectory);
  const runPath = path.join(runDirectory, "run.json");
  const runBytes = await readFile(runPath);
  const run = JSON.parse(runBytes.toString("utf8")) as CaptureRun;
  if (
    run.version !== 1 ||
    run.anonymousContext !== true ||
    run.complete !== true
  ) {
    throw new Error(`${runDirectory}: capture run is incomplete or non-anonymous`);
  }
  requestedCaptureAttempts += run.requestedPages;
  successfulCaptureAttempts += run.capturedPages;
  reportRuns.push({
    runId: run.runId,
    runManifestSha256: sha256(runBytes),
    pageTimeoutMs: run.limits.pageTimeoutMs,
    cardScreenshotBudgetMs: run.limits.cardScreenshotBudgetMs
  });
  const runResults = new Map(run.results.map((result) => [result.pageId, result]));

  for (const pageId of runSpec.pageIds) {
    if (acceptedPages.has(pageId) || existingPages.has(pageId)) {
      throw new Error(`${pageId}: page is already eligible or repeated`);
    }
    acceptedPages.add(pageId);
    const result = runResults.get(pageId);
    if (result?.status !== "captured" || !result.viewport) {
      throw new Error(`${pageId}: accepted page is not captured in its run`);
    }
    const site = [...sites.values()].find((candidate) =>
      pageId.startsWith(`${candidate.id}--`)
    );
    if (!site) throw new Error(`${pageId}: page is absent from source manifest`);
    const promotion = promotionBySite.get(site.id);
    if (!promotion) {
      throw new Error(`${pageId}: site lacks a domain promotion`);
    }
    acceptedCohorts.add(promotion.cohort);

    const pageDirectory = path.join(runDirectory, pageId);
    const [page, provenance] = await Promise.all([
      readJson<CapturePage>(path.join(pageDirectory, "page.json")),
      readJson<CaptureProvenance>(path.join(pageDirectory, "provenance.json"))
    ]);
    const provenanceErrors = await validateCaptureProvenance(
      pageDirectory,
      provenance
    );
    if (provenanceErrors.length > 0) {
      throw new Error(`${pageId}: ${provenanceErrors.join("; ")}`);
    }
    if (
      provenance.pageId !== pageId ||
      provenance.sourceManifestSha256 !== sourceManifestSha256
    ) {
      throw new Error(`${pageId}: provenance does not match the depth manifest`);
    }
    if (page.target.hostname !== site.hostname) {
      throw new Error(`${pageId}: capture hostname differs from source manifest`);
    }
    collectorHashes.add(provenance.collectorSha256);
    const observation = requiredAsset(provenance, "observation.json");
    const annotation = requiredAsset(provenance, "annotation.png");
    const machineErrors = [
      page.pageId !== pageId && "page identity differs",
      page.blocked && "page is blocked",
      page.candidateCount < 8 && "fewer than eight candidate roots",
      page.observationTruncated && "observation is truncated",
      page.unresolvedObstructionCoverage > 0.2 &&
        "unresolved obstruction exceeds 20%",
      page.queryTokenCoverage < 1 && "query token coverage is incomplete",
      !page.mainScreenshotCaptured && "main screenshot is absent",
      !page.annotationScreenshotCaptured && "annotation screenshot is absent",
      page.candidateScreenshotsCaptured < 1 &&
        "all candidate screenshots are absent"
    ].filter((value): value is string => Boolean(value));
    if (machineErrors.length > 0) {
      throw new Error(`${pageId}: ${machineErrors.join("; ")}`);
    }
    if (existingObservationHashes.has(observation.sha256)) {
      throw new Error(`${pageId}: observation duplicates eligible evidence`);
    }
    existingObservationHashes.add(observation.sha256);

    reportCaptures.push({
      siteId: site.id,
      pageId,
      capturedAt: page.capturedAt,
      viewportProfile: result.viewport.profile,
      viewport: {
        width: page.viewport.width,
        height: page.viewport.height
      },
      httpStatus: page.httpStatus,
      privacyRedactions: page.redactionCount,
      candidateCount: page.candidateCount,
      candidateScreenshotsCaptured: page.candidateScreenshotsCaptured,
      observationNodeCount: page.observationNodeCount,
      observationTruncated: page.observationTruncated,
      dismissedObstructions: page.dismissedObstructions,
      unresolvedObstructionCoverage: page.unresolvedObstructionCoverage,
      queryTokenCoverage: page.queryTokenCoverage,
      observationSha256: observation.sha256,
      canonicalObservationSha256: page.observationSha256,
      annotationScreenshotSha256: annotation.sha256,
      provenanceAggregateSha256: provenance.aggregateSha256,
      machineValidation: "passed",
      visualValidation: "passed"
    });
    registryCaptures.push({
      siteId: site.id,
      cohort: promotion.cohort,
      pageId,
      captureTimestamp: page.capturedAt,
      observationSha256: observation.sha256,
      annotationScreenshotSha256: annotation.sha256,
      qualificationReport: promotion.qualificationReport,
      pilotReport,
      machineValidation: "passed" as const,
      visualValidation: "passed" as const
    });
  }
}

if (requestedCaptureAttempts !== spec.requestedCaptureAttempts) {
  throw new Error(
    `Spec declares ${spec.requestedCaptureAttempts} attempts but runs contain ${requestedCaptureAttempts}`
  );
}
if (acceptedPages.size > spec.requestedCaptureAttempts) {
  throw new Error("Accepted pages exceed requested capture attempts.");
}
for (const pageId of replacementState.replacementPageIds) {
  if (!acceptedPages.has(pageId)) {
    throw new Error(`${pageId}: replacement page was not accepted`);
  }
}
const acceptedSiteIds = [
  ...new Set(reportCaptures.map((capture) => capture.siteId))
];
const acceptedStrata = [
  ...new Set(acceptedSiteIds.map((siteId) => sites.get(siteId)!.stratum))
];
if (acceptedCohorts.size !== 1) {
  throw new Error("A capture pilot must contain exactly one promoted cohort.");
}
const cohort = [...acceptedCohorts][0]!;
const pilot = {
  version: 1,
  pilotId: spec.pilotId,
  decision: "capture-pipeline-pass-labels-pending",
  capturedAt: spec.capturedAt,
  source: {
    siteIds: acceptedSiteIds,
    cohort,
    strata: acceptedStrata,
    anonymousContext: true,
    sourceManifestSha256: [sourceManifestSha256],
    collectorSha256: [...collectorHashes]
  },
  runs: reportRuns,
  screening: {
    requestedCaptureAttempts: spec.requestedCaptureAttempts,
    successfulCaptureAttempts,
    acceptedPages: acceptedPages.size,
    rejectedPages: spec.requestedCaptureAttempts - acceptedPages.size,
    acceptanceRate: acceptedPages.size / spec.requestedCaptureAttempts,
    candidateCardRoots: reportCaptures.reduce(
      (total, capture) => total + capture.candidateCount,
      0
    ),
    samplingFinding: spec.samplingFinding,
    visualValidationFinding: spec.visualValidationFinding
  },
  captures: reportCaptures,
  replacements: pilotReplacements,
  eligibility: {
    pointerReady: false,
    dualReviewed: false,
    adjudicated: false,
    reason: "Independent human reviews and third-party adjudication are pending."
  }
};
const updatedRegistry: EligibleCaptureManifest = {
  version: 1,
  captures: [...retainedRegistryCaptures, ...registryCaptures]
};

await Promise.all([
  mkdir(path.dirname(outputPath), { recursive: true }),
  mkdir(path.dirname(registryPath), { recursive: true }),
  mkdir(path.dirname(retiredRegistryPath), { recursive: true })
]);
await writeFile(outputPath, `${JSON.stringify(pilot, null, 2)}\n`, "utf8");
await writeFile(
  registryPath,
  `${JSON.stringify(updatedRegistry, null, 2)}\n`,
  "utf8"
);
await writeFile(
  retiredRegistryPath,
  `${JSON.stringify(
    { version: 1, captures: replacementState.retiredCaptures },
    null,
    2
  )}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify(
    {
      valid: true,
      pilotId: spec.pilotId,
      requestedCaptureAttempts: spec.requestedCaptureAttempts,
      acceptedPages: acceptedPages.size,
      candidateCardRoots: pilot.screening.candidateCardRoots,
      eligibleCaptures: updatedRegistry.captures.length,
      retiredCaptures: replacementState.retiredCaptures.length,
      output: outputPath,
      registry: registryPath,
      retiredRegistry: retiredRegistryPath
    },
    null,
    2
  )}\n`
);

function requiredAsset(
  provenance: CaptureProvenance,
  assetPath: string
): CaptureProvenance["assets"][number] {
  const asset = provenance.assets.find((candidate) => candidate.path === assetPath);
  if (!asset) throw new Error(`${provenance.pageId}: missing ${assetPath}`);
  return asset;
}

function optionMap(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/promote-training-depth-captures.ts --spec spec.json --output pilot.json [--registry eligible-captures.json] [--retired-registry retired-captures.json] [--promotions promotions.json]"
      );
    }
    values.set(name, value);
  }
  return values;
}

function requiredPath(values: Map<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) throw new Error(`Required: ${name}`);
  return path.resolve(value);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
