import {
  mergeEvidenceReviewQueues,
  selectCapturedReviewPages,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueSource
} from "../../scripts/evidence-review-queue-lib";

describe("evidence review campaigns", () => {
  it("builds a campaign from one corrected capture run", () => {
    const campaign = mergeEvidenceReviewQueues(
      [source("page-a", "run-a")],
      "/repo/benchmark-data/review/campaign.json"
    );

    expect(campaign.items.map((item) => item.pageId)).toEqual(["page-a"]);
    expect(campaign.sourceQueues).toHaveLength(1);
  });

  it("merges, rebases, sorts, and hashes blinded queues deterministically", () => {
    const left = source("page-b", "run-b");
    const right = source("page-a", "run-a");
    const output = "/repo/benchmark-data/review/campaign.json";
    const first = mergeEvidenceReviewQueues([left, right], output);
    const second = mergeEvidenceReviewQueues([right, left], output);

    expect(second).toEqual(first);
    expect(first.queueId).toMatch(/^reviewer-a--campaign--[a-f0-9]{16}$/);
    expect(first.items.map((item) => item.pageId)).toEqual([
      "page-a",
      "page-b"
    ]);
    expect(first.items[0]!.observationPath).toBe(
      "../live/run-a/page-a/observation.json"
    );
    expect(first.sourceQueues).toHaveLength(2);
  });

  it("rejects mixed reviewer identities", () => {
    const left = source("page-a", "run-a");
    const right = source("page-b", "run-b");
    right.queue.reviewerId = "reviewer-b";
    right.queue.items[0]!.reviewTemplate.reviewerId = "reviewer-b";

    expect(() =>
      mergeEvidenceReviewQueues(
        [left, right],
        "/repo/benchmark-data/review/campaign.json"
      )
    ).toThrow("cannot mix reviewer identities");
  });

  it("rejects duplicate pages across source runs", () => {
    expect(() =>
      mergeEvidenceReviewQueues(
        [source("page-a", "run-a"), source("page-a", "run-b")],
        "/repo/benchmark-data/review/campaign.json"
      )
    ).toThrow("Duplicate campaign page");
  });

  it("rejects queues that do not freeze candidate card roots", () => {
    const invalid = source("page-a", "run-a");
    invalid.queue.items[0]!.candidateCardNodeIds = [];

    expect(() =>
      mergeEvidenceReviewQueues(
        [invalid, source("page-b", "run-b")],
        "/repo/benchmark-data/review/campaign.json"
      )
    ).toThrow("no candidate card roots");
  });

  it("rejects source metadata drift between the queue and template", () => {
    const invalid = source("page-a", "run-a");
    invalid.queue.items[0]!.source = {
      ...invalid.queue.items[0]!.source,
      registrableDomain: "drift.example"
    };

    expect(() =>
      mergeEvidenceReviewQueues(
        [invalid, source("page-b", "run-b")],
        "/repo/benchmark-data/review/campaign.json"
      )
    ).toThrow("queue item contract changed");
  });

  it("selects only explicitly requested captured pages", () => {
    const results = [
      { pageId: "page-a", status: "captured" as const },
      { pageId: "page-b", status: "blocked" as const },
      { pageId: "page-c", status: "captured" as const }
    ];

    expect(selectCapturedReviewPages(results, ["page-c"])).toEqual([
      results[2]
    ]);
    expect(selectCapturedReviewPages(results, [])).toEqual([
      results[0],
      results[2]
    ]);
    expect(() => selectCapturedReviewPages(results, ["page-b"])).toThrow(
      "not captured"
    );
    expect(() => selectCapturedReviewPages(results, ["missing"])).toThrow(
      "absent from the run"
    );
    expect(() =>
      selectCapturedReviewPages(results, ["page-a", "page-a"])
    ).toThrow("must be unique");
  });
});

function source(pageId: string, runId: string): EvidenceReviewQueueSource {
  const queue = queueFor(pageId, runId);
  return {
    filename: `/repo/benchmark-data/review/${runId}.json`,
    sha256: runId === "run-a" ? "a".repeat(64) : "b".repeat(64),
    queue
  };
}

function queueFor(pageId: string, runId: string): EvidenceReviewQueue {
  const source = {
    observationSha256: "c".repeat(64),
    screenshotSha256: "d".repeat(64),
    captureTimestamp: "2026-07-25T00:00:00.000Z",
    registrableDomain: "shop.example",
    cohort: "training" as const
  };
  return {
    version: 1,
    queueId: `reviewer-a--${runId}`,
    reviewerId: "reviewer-a",
    cohort: "training",
    labelVisibility: "no model or peer labels",
    sourceRunId: runId,
    sourceRunSha256: "e".repeat(64),
    items: [
      {
        pageId,
        source,
        observationPath: `../live/${runId}/${pageId}/observation.json`,
        screenshotPath: `../live/${runId}/${pageId}/annotation.png`,
        rootNodeId: "root",
        candidateCardNodeIds: ["card"],
        reviewTemplate: {
          version: 1,
          reviewId: `reviewer-a--${runId}--${pageId}`,
          pageId,
          phase: "independent",
          reviewerId: "reviewer-a",
          completedAt: null,
          coverage: "complete-main-region",
          preannotationVisibility: "hidden",
          source,
          products: []
        }
      }
    ]
  };
}
