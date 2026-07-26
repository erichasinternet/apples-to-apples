import {
  buildEvidenceReviewBatchPairs,
  type EvidenceReviewBatchSource
} from "../../scripts/evidence-review-batch-lib";
import type { EvidenceReviewQueue } from "../../scripts/evidence-review-queue-lib";

describe("evidence review campaign batching", () => {
  it("creates deterministic paired batches and rebases evidence paths", () => {
    const batches = buildEvidenceReviewBatchPairs({
      sourceA: source("reviewer-a"),
      sourceB: source("reviewer-b"),
      outputDirectory: "/repo/benchmark-data/review/batches",
      pagesPerBatch: 2
    });

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.pageIds)).toEqual([
      ["page-a", "page-b"],
      ["page-c"]
    ]);
    expect(batches.map((batch) => batch.candidateCards)).toEqual([4, 2]);
    expect(batches[0]!.queueA.items[0]).toMatchObject({
      pageId: "page-a",
      observationPath: "../../live/run/page-a/observation.json",
      screenshotPath: "../../live/run/page-a/annotation.png",
      reviewTemplate: {
        reviewId: "reviewer-a--page-a"
      }
    });
    expect(batches[0]!.queueB.items[0]!.reviewTemplate.reviewId).toBe(
      "reviewer-b--page-a"
    );
    expect(batches[0]!.queueA.sourceQueues).toEqual([
      {
        queueId: "reviewer-a--campaign--source",
        sha256: "a".repeat(64)
      }
    ]);
  });

  it("rejects mismatched paired evidence", () => {
    const sourceB = source("reviewer-b");
    sourceB.queue.items[0]!.candidateCardNodeIds = ["different-card"];

    expect(() =>
      buildEvidenceReviewBatchPairs({
        sourceA: source("reviewer-a"),
        sourceB,
        outputDirectory: "/repo/benchmark-data/review/batches",
        pagesPerBatch: 2
      })
    ).toThrow("campaign evidence contract differs: page-c");
  });

  it("rejects invalid batch sizes", () => {
    expect(() =>
      buildEvidenceReviewBatchPairs({
        sourceA: source("reviewer-a"),
        sourceB: source("reviewer-b"),
        outputDirectory: "/repo/benchmark-data/review/batches",
        pagesPerBatch: 0
      })
    ).toThrow("pagesPerBatch must be a positive integer");
  });
});

function source(reviewerId: string): EvidenceReviewBatchSource {
  return {
    filename: `/repo/benchmark-data/review/${reviewerId}.json`,
    sha256: reviewerId === "reviewer-a" ? "a".repeat(64) : "b".repeat(64),
    queue: queue(reviewerId)
  };
}

function queue(reviewerId: string): EvidenceReviewQueue {
  return {
    version: 1,
    queueId: `${reviewerId}--campaign--source`,
    reviewerId,
    cohort: "training",
    labelVisibility: "no model or peer labels",
    items: ["page-c", "page-a", "page-b"].map((pageId) => ({
      pageId,
      source: {
        observationSha256: "1".repeat(64),
        screenshotSha256: "2".repeat(64),
        captureTimestamp: "2026-07-26T00:00:00.000Z",
        registrableDomain: "example.com",
        cohort: "training"
      },
      observationPath: `../live/run/${pageId}/observation.json`,
      screenshotPath: `../live/run/${pageId}/annotation.png`,
      rootNodeId: "n0",
      candidateCardNodeIds: ["n1", "n2"],
      reviewTemplate: {
        version: 1,
        reviewId: `${reviewerId}--${pageId}`,
        pageId,
        phase: "independent",
        reviewerId,
        completedAt: null,
        coverage: "complete-main-region",
        preannotationVisibility: "hidden",
        source: {
          observationSha256: "1".repeat(64),
          screenshotSha256: "2".repeat(64),
          captureTimestamp: "2026-07-26T00:00:00.000Z",
          registrableDomain: "example.com",
          cohort: "training"
        },
        products: []
      }
    }))
  };
}
