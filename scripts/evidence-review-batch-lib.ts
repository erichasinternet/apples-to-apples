import { createHash } from "node:crypto";
import path from "node:path";
import { validateCampaignPair } from "./evidence-review-campaign-lib";
import {
  validateEvidenceReviewQueue,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";

export interface EvidenceReviewBatchSource {
  filename: string;
  sha256: string;
  queue: EvidenceReviewQueue;
}

export interface EvidenceReviewBatchPair {
  batchNumber: number;
  pageIds: string[];
  candidateCards: number;
  queueA: EvidenceReviewQueue;
  queueB: EvidenceReviewQueue;
}

export function buildEvidenceReviewBatchPairs(input: {
  sourceA: EvidenceReviewBatchSource;
  sourceB: EvidenceReviewBatchSource;
  outputDirectory: string;
  pagesPerBatch: number;
}): EvidenceReviewBatchPair[] {
  const { sourceA, sourceB } = input;
  if (!Number.isInteger(input.pagesPerBatch) || input.pagesPerBatch <= 0) {
    throw new Error("pagesPerBatch must be a positive integer.");
  }
  for (const source of [sourceA, sourceB]) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) {
      throw new Error(`Invalid source queue hash: ${source.queue.queueId}`);
    }
  }
  const pairErrors = validateCampaignPair(sourceA.queue, sourceB.queue);
  if (pairErrors.length > 0) {
    throw new Error(`Invalid campaign pair: ${pairErrors.join("; ")}`);
  }

  const itemsA = new Map(sourceA.queue.items.map((item) => [item.pageId, item]));
  const itemsB = new Map(sourceB.queue.items.map((item) => [item.pageId, item]));
  const pageIds = [...itemsA.keys()].sort();
  const batches: EvidenceReviewBatchPair[] = [];
  for (
    let offset = 0;
    offset < pageIds.length;
    offset += input.pagesPerBatch
  ) {
    const batchPageIds = pageIds.slice(offset, offset + input.pagesPerBatch);
    const batchNumber = batches.length + 1;
    const queueA = buildBatchQueue(
      sourceA,
      batchPageIds,
      batchNumber,
      input.outputDirectory,
      itemsA
    );
    const queueB = buildBatchQueue(
      sourceB,
      batchPageIds,
      batchNumber,
      input.outputDirectory,
      itemsB
    );
    const batchErrors = validateCampaignPair(queueA, queueB);
    if (batchErrors.length > 0) {
      throw new Error(
        `Invalid generated batch ${batchNumber}: ${batchErrors.join("; ")}`
      );
    }
    batches.push({
      batchNumber,
      pageIds: batchPageIds,
      candidateCards: queueA.items.reduce(
        (total, item) => total + item.candidateCardNodeIds.length,
        0
      ),
      queueA,
      queueB
    });
  }
  return batches;
}

function buildBatchQueue(
  source: EvidenceReviewBatchSource,
  pageIds: string[],
  batchNumber: number,
  outputDirectory: string,
  itemByPage: Map<string, EvidenceReviewQueueItem>
): EvidenceReviewQueue {
  const sourceDirectory = path.dirname(path.resolve(source.filename));
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const items = pageIds.map((pageId) => {
    const item = itemByPage.get(pageId);
    if (!item) throw new Error(`Missing source page: ${pageId}`);
    return {
      ...item,
      observationPath: path.relative(
        resolvedOutputDirectory,
        path.resolve(sourceDirectory, item.observationPath)
      ),
      screenshotPath: path.relative(
        resolvedOutputDirectory,
        path.resolve(sourceDirectory, item.screenshotPath)
      )
    };
  });
  const digest = createHash("sha256")
    .update(source.sha256)
    .update("\0")
    .update(pageIds.join("\n"))
    .digest("hex")
    .slice(0, 16);
  const queue: EvidenceReviewQueue = {
    version: 1,
    queueId: `${source.queue.reviewerId}--campaign-batch-${String(batchNumber).padStart(2, "0")}--${digest}`,
    reviewerId: source.queue.reviewerId,
    cohort: source.queue.cohort,
    labelVisibility: "no model or peer labels",
    sourceQueues: [
      {
        queueId: source.queue.queueId,
        sha256: source.sha256
      }
    ],
    items
  };
  const errors = validateEvidenceReviewQueue(queue);
  if (errors.length > 0) {
    throw new Error(
      `Invalid generated queue ${queue.queueId}: ${errors.join("; ")}`
    );
  }
  return queue;
}
