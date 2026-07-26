import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EligibleCaptureEntry } from "./capture-eligibility-lib";
import {
  validateEvidenceReviewQueue,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueItem,
} from "./evidence-review-queue-lib";

interface EligibleCaptureManifest {
  version: 1;
  captures: Array<
    EligibleCaptureEntry & {
      annotationScreenshotSha256: string;
    }
  >;
}

interface WorkbenchEvidence {
  version: 1;
  queueId: string;
  browser: string;
  pagesLoaded: number;
  screenshotsLoaded: number;
  candidateCards: number;
  onlyFrozenCardRootOffered: boolean;
  directFrozenCardNavigation: string;
  nonCandidateAncestor: string;
  incompleteCoverage: string;
  consoleErrors: number;
  reviewFilesWritten: number;
}

const options = parseOptions(process.argv.slice(2));
const [queueA, queueB, eligible, workbench] = await Promise.all([
  readQueue(options.queueA),
  readQueue(options.queueB),
  readJson<EligibleCaptureManifest>(options.eligibleCaptures),
  readJson<WorkbenchEvidence>(options.workbenchEvidence),
]);
for (const queue of [queueA, queueB]) {
  const errors = validateEvidenceReviewQueue(queue);
  if (errors.length > 0) {
    throw new Error(`Invalid queue ${queue.queueId}: ${errors.join("; ")}`);
  }
}
if (
  queueA.reviewerId === queueB.reviewerId ||
  queueA.cohort !== queueB.cohort ||
  queueA.items.length !== queueB.items.length
) {
  throw new Error("Campaign queues must be paired across distinct reviewers.");
}

const itemsB = new Map(queueB.items.map((item) => [item.pageId, item]));
for (const itemA of queueA.items) {
  const itemB = itemsB.get(itemA.pageId);
  if (!itemB || !sameEvidence(itemA, itemB)) {
    throw new Error(`Campaign queue evidence differs: ${itemA.pageId}`);
  }
}

const eligibleByPage = new Map(
  eligible.captures.map((capture) => [capture.pageId, capture]),
);
const pages = queueA.items
  .map((item) => {
    const capture = eligibleByPage.get(item.pageId);
    if (
      !capture ||
      capture.cohort !== queueA.cohort ||
      capture.captureTimestamp !== item.source.captureTimestamp ||
      capture.observationSha256 !== item.source.observationSha256 ||
      capture.annotationScreenshotSha256 !== item.source.screenshotSha256
    ) {
      throw new Error(
        `Queue page is not exact eligible evidence: ${item.pageId}`,
      );
    }
    return {
      siteId: capture.siteId,
      pageId: item.pageId,
      captureTimestamp: capture.captureTimestamp,
      candidateCardCount: item.candidateCardNodeIds.length,
      observationSha256: capture.observationSha256,
      annotationScreenshotSha256: capture.annotationScreenshotSha256,
    };
  })
  .sort((left, right) => left.pageId.localeCompare(right.pageId));

const queueReports = await Promise.all([
  buildQueueReport(queueA, options.queueA, options.sourcesA),
  buildQueueReport(queueB, options.queueB, options.sourcesB),
]);
const candidateCards = pages.reduce(
  (total, page) => total + page.candidateCardCount,
  0,
);
if (
  workbench.queueId !== queueA.queueId ||
  workbench.pagesLoaded !== pages.length ||
  workbench.screenshotsLoaded !== pages.length ||
  workbench.candidateCards !== candidateCards ||
  !workbench.onlyFrozenCardRootOffered ||
  workbench.nonCandidateAncestor !== "rejected-404" ||
  workbench.incompleteCoverage !== "rejected-422" ||
  workbench.consoleErrors !== 0 ||
  workbench.reviewFilesWritten !== 0
) {
  throw new Error("Workbench evidence does not match the campaign.");
}

const report = {
  version: 1,
  campaignId: options.campaignId,
  createdAt: options.createdAt,
  cohort: queueA.cohort,
  decision: "workbench-pass-independent-human-reviews-pending",
  pages,
  queues: queueReports,
  blinding: {
    labelVisibility: "no model or peer labels",
    distinctReviewerIds: true,
    candidateCardRootsFrozenFromCapture: true,
    completeCandidateCoverageRequired: true,
  },
  workbenchValidation: workbench,
  eligibility: {
    pointerReady: false,
    dualReviewed: false,
    adjudicated: false,
    goldProducts: 0,
    reason:
      "Two independent human reviews and third-party adjudication are pending.",
  },
};
await mkdir(path.dirname(options.output), { recursive: true });
await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    campaignId: options.campaignId,
    pages: pages.length,
    candidateCards,
    output: options.output,
  })}\n`,
);

async function buildQueueReport(
  queue: EvidenceReviewQueue,
  queuePath: string,
  sourcePaths: string[],
): Promise<{
  reviewerId: string;
  queueId: string;
  campaignQueueSha256: string;
  sourceQueueSha256: string[];
  sourceQueuePageCounts: number[];
}> {
  const sources = await Promise.all(
    sourcePaths.map(async (filename) => {
      const value = await readFile(filename);
      const source = JSON.parse(value.toString("utf8")) as EvidenceReviewQueue;
      const errors = validateEvidenceReviewQueue(source);
      if (errors.length > 0 || source.reviewerId !== queue.reviewerId) {
        throw new Error(`Invalid source queue: ${filename}`);
      }
      return {
        queueId: source.queueId,
        sha256: sha256(value),
        pages: source.items.map((item) => item.pageId),
      };
    }),
  );
  const expectedSources = new Map(
    (queue.sourceQueues ?? []).map((source) => [source.queueId, source.sha256]),
  );
  for (const source of sources) {
    if (expectedSources.get(source.queueId) !== source.sha256) {
      throw new Error(`Queue source provenance differs: ${source.queueId}`);
    }
  }
  if (sources.length !== expectedSources.size) {
    throw new Error(`Queue source count differs: ${queue.queueId}`);
  }
  const sourcePages = sources.flatMap((source) => source.pages);
  if (
    sourcePages.length !== queue.items.length ||
    new Set(sourcePages).size !== sourcePages.length ||
    sourcePages.some(
      (pageId) => !queue.items.some((item) => item.pageId === pageId),
    )
  ) {
    throw new Error(`Queue source pages differ: ${queue.queueId}`);
  }
  return {
    reviewerId: queue.reviewerId,
    queueId: queue.queueId,
    campaignQueueSha256: sha256(await readFile(queuePath)),
    sourceQueueSha256: sources.map((source) => source.sha256),
    sourceQueuePageCounts: sources.map((source) => source.pages.length),
  };
}

function sameEvidence(
  left: EvidenceReviewQueueItem,
  right: EvidenceReviewQueueItem,
): boolean {
  return (
    left.pageId === right.pageId &&
    left.source.observationSha256 === right.source.observationSha256 &&
    left.source.screenshotSha256 === right.source.screenshotSha256 &&
    left.source.captureTimestamp === right.source.captureTimestamp &&
    left.source.registrableDomain === right.source.registrableDomain &&
    left.source.cohort === right.source.cohort &&
    JSON.stringify(left.candidateCardNodeIds) ===
      JSON.stringify(right.candidateCardNodeIds)
  );
}

function parseOptions(args: string[]): {
  campaignId: string;
  createdAt: string;
  queueA: string;
  queueB: string;
  sourcesA: string[];
  sourcesB: string[];
  eligibleCaptures: string;
  workbenchEvidence: string;
  output: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error("Campaign report options must be --name value pairs.");
    }
    values.set(name, value);
  }
  const required = [
    "--campaign-id",
    "--created-at",
    "--queue-a",
    "--queue-b",
    "--sources-a",
    "--sources-b",
    "--workbench-evidence",
    "--output",
  ];
  for (const name of required) {
    if (!values.get(name)) throw new Error(`Required: ${name}`);
  }
  const createdAt = values.get("--created-at")!;
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error("--created-at must be an ISO timestamp.");
  }
  return {
    campaignId: values.get("--campaign-id")!,
    createdAt,
    queueA: path.resolve(values.get("--queue-a")!),
    queueB: path.resolve(values.get("--queue-b")!),
    sourcesA: csvPaths(values.get("--sources-a")!),
    sourcesB: csvPaths(values.get("--sources-b")!),
    eligibleCaptures: path.resolve(
      values.get("--eligible-captures") ??
        "benchmarks/capture-pilots/eligible-captures.json",
    ),
    workbenchEvidence: path.resolve(values.get("--workbench-evidence")!),
    output: path.resolve(values.get("--output")!),
  };
}

function csvPaths(value: string): string[] {
  const paths = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (paths.length === 0)
    throw new Error("At least one source queue is required.");
  return paths;
}

async function readQueue(filename: string): Promise<EvidenceReviewQueue> {
  return readJson<EvidenceReviewQueue>(filename);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
