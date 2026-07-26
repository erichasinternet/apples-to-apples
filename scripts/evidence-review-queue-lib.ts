import { createHash } from "node:crypto";
import path from "node:path";
import type { EvidencePointerReview } from "./evidence-review-lib";

type EvidenceReviewTemplate = Omit<EvidencePointerReview, "completedAt"> & {
  completedAt: string | null;
};

export interface EvidenceReviewQueueItem {
  pageId: string;
  source: EvidencePointerReview["source"];
  observationPath: string;
  screenshotPath: string;
  rootNodeId: string;
  candidateCardNodeIds: string[];
  reviewTemplate: EvidenceReviewTemplate;
}

export interface EvidenceReviewQueue {
  version: 1;
  queueId: string;
  reviewerId: string;
  cohort: EvidencePointerReview["source"]["cohort"];
  labelVisibility: "no model or peer labels";
  sourceRunId?: string;
  sourceRunSha256?: string;
  sourceQueues?: Array<{ queueId: string; sha256: string }>;
  items: EvidenceReviewQueueItem[];
}

export interface EvidenceReviewQueueSource {
  filename: string;
  sha256: string;
  queue: EvidenceReviewQueue;
}

export interface EvidenceReviewCaptureResult {
  pageId: string;
  status: "captured" | "blocked" | "error";
}

const SHA256 = /^[a-f0-9]{64}$/;

export function selectCapturedReviewPages<T extends EvidenceReviewCaptureResult>(
  results: T[],
  requestedPageIds: string[]
): T[] {
  const captured = results.filter((result) => result.status === "captured");
  if (requestedPageIds.length === 0) return captured;

  const requested = new Set(requestedPageIds);
  if (requested.size !== requestedPageIds.length) {
    throw new Error("Requested review pages must be unique.");
  }

  const byPageId = new Map(results.map((result) => [result.pageId, result]));
  for (const pageId of requestedPageIds) {
    const result = byPageId.get(pageId);
    if (!result) {
      throw new Error(`Requested review page is absent from the run: ${pageId}`);
    }
    if (result.status !== "captured") {
      throw new Error(`Requested review page is not captured: ${pageId}`);
    }
  }

  return captured.filter((result) => requested.has(result.pageId));
}

export function validateEvidenceReviewQueue(
  queue: EvidenceReviewQueue
): string[] {
  const errors: string[] = [];
  if (queue.version !== 1) errors.push("queue version must be 1");
  if (!queue.queueId?.trim()) errors.push("queueId is required");
  if (!queue.reviewerId?.trim()) errors.push("reviewerId is required");
  if (
    !["training", "validation", "selection", "final"].includes(queue.cohort)
  ) {
    errors.push("queue cohort is invalid");
  }
  if (queue.labelVisibility !== "no model or peer labels") {
    errors.push("queue is not blinded");
  }
  if (!Array.isArray(queue.items) || queue.items.length === 0) {
    errors.push("queue must contain at least one page");
    return errors;
  }

  const seenPages = new Set<string>();
  const seenReviews = new Set<string>();
  for (const item of queue.items) {
    if (seenPages.has(item.pageId)) {
      errors.push(`duplicate queue page: ${item.pageId}`);
    }
    seenPages.add(item.pageId);
    if (seenReviews.has(item.reviewTemplate.reviewId)) {
      errors.push(`duplicate queue review id: ${item.reviewTemplate.reviewId}`);
    }
    seenReviews.add(item.reviewTemplate.reviewId);

    const candidateIds = item.candidateCardNodeIds;
    if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
      errors.push(`queue page has no candidate card roots: ${item.pageId}`);
    } else {
      if (candidateIds.some((nodeId) => !nodeId?.trim())) {
        errors.push(`queue page has an invalid candidate card root: ${item.pageId}`);
      }
      if (new Set(candidateIds).size !== candidateIds.length) {
        errors.push(`queue page has duplicate candidate card roots: ${item.pageId}`);
      }
    }
    if (
      !SHA256.test(item.source.observationSha256) ||
      !SHA256.test(item.source.screenshotSha256)
    ) {
      errors.push(`queue page has invalid source hashes: ${item.pageId}`);
    }
    if (
      item.reviewTemplate.pageId !== item.pageId ||
      item.reviewTemplate.reviewerId !== queue.reviewerId ||
      item.reviewTemplate.source.cohort !== queue.cohort ||
      item.reviewTemplate.completedAt !== null ||
      item.reviewTemplate.phase !== "independent" ||
      item.reviewTemplate.coverage !== "complete-main-region" ||
      item.reviewTemplate.preannotationVisibility !== "hidden" ||
      item.reviewTemplate.products.length !== 0 ||
      !sameSource(item.source, item.reviewTemplate.source)
    ) {
      errors.push(`queue item contract changed: ${item.pageId}`);
    }
  }
  return errors;
}

function sameSource(
  left: EvidencePointerReview["source"],
  right: EvidencePointerReview["source"]
): boolean {
  return (
    left.observationSha256 === right.observationSha256 &&
    left.screenshotSha256 === right.screenshotSha256 &&
    left.captureTimestamp === right.captureTimestamp &&
    left.registrableDomain === right.registrableDomain &&
    left.cohort === right.cohort
  );
}

export function mergeEvidenceReviewQueues(
  sources: readonly EvidenceReviewQueueSource[],
  outputFilename: string
): EvidenceReviewQueue {
  if (sources.length < 2) {
    throw new Error("A review campaign requires at least two source queues.");
  }
  const ordered = [...sources].sort((left, right) =>
    left.queue.queueId.localeCompare(right.queue.queueId)
  );
  const reviewerId = ordered[0]!.queue.reviewerId;
  const cohort = ordered[0]!.queue.cohort;
  const outputDirectory = path.dirname(path.resolve(outputFilename));
  const seenPages = new Set<string>();
  const seenReviews = new Set<string>();
  const items: EvidenceReviewQueueItem[] = [];

  for (const source of ordered) {
    validateQueueSource(source, reviewerId, cohort);
    const sourceDirectory = path.dirname(path.resolve(source.filename));
    for (const item of source.queue.items) {
      if (seenPages.has(item.pageId)) {
        throw new Error(`Duplicate campaign page: ${item.pageId}`);
      }
      if (seenReviews.has(item.reviewTemplate.reviewId)) {
        throw new Error(
          `Duplicate campaign review id: ${item.reviewTemplate.reviewId}`
        );
      }
      seenPages.add(item.pageId);
      seenReviews.add(item.reviewTemplate.reviewId);
      items.push({
        ...item,
        observationPath: path.relative(
          outputDirectory,
          path.resolve(sourceDirectory, item.observationPath)
        ),
        screenshotPath: path.relative(
          outputDirectory,
          path.resolve(sourceDirectory, item.screenshotPath)
        )
      });
    }
  }

  const sourceQueues = ordered.map((source) => ({
    queueId: source.queue.queueId,
    sha256: source.sha256
  }));
  const campaignHash = createHash("sha256")
    .update(
      sourceQueues
        .map((source) => `${source.queueId}\0${source.sha256}\n`)
        .join("")
    )
    .digest("hex")
    .slice(0, 16);
  return {
    version: 1,
    queueId: `${reviewerId}--campaign--${campaignHash}`,
    reviewerId,
    cohort,
    labelVisibility: "no model or peer labels",
    sourceQueues,
    items: items.sort((left, right) => left.pageId.localeCompare(right.pageId))
  };
}

function validateQueueSource(
  source: EvidenceReviewQueueSource,
  reviewerId: string,
  cohort: EvidenceReviewQueue["cohort"]
): void {
  const { queue } = source;
  if (!SHA256.test(source.sha256)) {
    throw new Error(`Invalid source queue hash: ${queue.queueId}`);
  }
  const queueErrors = validateEvidenceReviewQueue(queue);
  if (queueErrors.length > 0) {
    throw new Error(
      `Invalid source queue ${queue.queueId}: ${queueErrors.join("; ")}`
    );
  }
  if (queue.reviewerId !== reviewerId) {
    throw new Error("A campaign cannot mix reviewer identities.");
  }
  if (queue.cohort !== cohort) {
    throw new Error("A campaign cannot mix dataset cohorts.");
  }
}
