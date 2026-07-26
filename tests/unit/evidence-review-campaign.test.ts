import {
  auditEvidenceReviewCampaign,
  validateCampaignPair
} from "../../scripts/evidence-review-campaign-lib";
import {
  buildEvidenceAdjudicationQueue,
  validateEvidenceAdjudicationQueue,
  type BuildEvidenceAdjudicationQueueInput
} from "../../scripts/evidence-adjudication-queue-lib";
import { compileEvidenceAdjudicationCampaign } from "../../scripts/evidence-adjudication-campaign-lib";
import type { EvidencePointerReview } from "../../scripts/evidence-review-lib";
import type { EvidenceReviewQueue } from "../../scripts/evidence-review-queue-lib";
import type {
  ObservedNode,
  PageObservation
} from "../../src/learning/contracts";

describe("evidence review campaign intake", () => {
  it("reports an untouched campaign as valid but not ready", () => {
    const report = auditEvidenceReviewCampaign({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [],
      submissionsB: [],
      observations: new Map([["page", observation()]])
    });

    expect(report).toMatchObject({
      valid: true,
      pages: 1,
      candidateCards: 1,
      pairedPages: 0,
      pendingPages: ["page"],
      readyForAdjudication: false,
      reviewers: [
        { reviewerId: "reviewer-a", expected: 1, valid: 0 },
        { reviewerId: "reviewer-b", expected: 1, valid: 0 }
      ]
    });
  });

  it("pairs complete submissions and computes weighted agreement", () => {
    const report = auditEvidenceReviewCampaign({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [
        { filename: "a.json", review: review("reviewer-a") }
      ],
      submissionsB: [
        { filename: "b.json", review: review("reviewer-b") }
      ],
      observations: new Map([["page", observation()]])
    });

    expect(report).toMatchObject({
      valid: true,
      pairedPages: 1,
      pendingPages: [],
      readyForAdjudication: true,
      agreement: {
        pages: 1,
        cards: 1,
        disagreements: 0,
        comparableKappa: 1,
        exactPointerAgreement: 1,
        developmentGatePassed: true
      }
    });
  });

  it("quarantines malformed, duplicate, and unexpected submissions", () => {
    const expected = review("reviewer-a");
    const duplicate = structuredClone(expected);
    const report = auditEvidenceReviewCampaign({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [
        { filename: "broken.json", parseError: "invalid JSON" },
        {
          filename: "wrong-shape.json",
          review: {
            reviewId: "reviewer-a--page"
          } as EvidencePointerReview
        },
        { filename: "a.json", review: expected },
        { filename: "duplicate.json", review: duplicate },
        {
          filename: "unexpected.json",
          review: { ...expected, reviewId: "other-review" }
        }
      ],
      submissionsB: [],
      observations: new Map([["page", observation()]])
    });

    expect(report.valid).toBe(false);
    expect(report.reviewers[0].unexpectedReviewIds).toEqual([
      "other-review"
    ]);
    expect(report.reviewers[0].invalid).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "broken.json" }),
        expect.objectContaining({ filename: "wrong-shape.json" }),
        expect.objectContaining({ filename: "duplicate.json" })
      ])
    );
  });

  it("rejects reviewer identity drift and incomplete card coverage", () => {
    const drifted = review("reviewer-a");
    drifted.reviewerId = "somebody-else";
    drifted.products = [];
    const report = auditEvidenceReviewCampaign({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [{ filename: "a.json", review: drifted }],
      submissionsB: [],
      observations: new Map([["page", observation()]])
    });

    expect(report.valid).toBe(false);
    expect(report.reviewers[0].invalid[0]?.errors).toEqual(
      expect.arrayContaining([
        "review omits expected cards: card",
        "review identity or blinding contract changed"
      ])
    );
    expect(report.reviewers[0].missingReviewIds).toEqual([
      "reviewer-a--page"
    ]);
  });

  it("rejects mismatched frozen evidence contracts", () => {
    const left = queue("reviewer-a");
    const right = queue("reviewer-b");
    right.items[0]!.candidateCardNodeIds = ["other-card"];

    expect(validateCampaignPair(left, right)).toContain(
      "campaign evidence contract differs: page"
    );
  });

  it("fails campaign integrity when immutable observations are absent", () => {
    const report = auditEvidenceReviewCampaign({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [],
      submissionsB: [],
      observations: new Map()
    });

    expect(report.valid).toBe(false);
    expect(report.integrityErrors).toEqual([
      "missing immutable observation: page"
    ]);
  });

  it("builds a deterministic queue only after dual review", () => {
    const observations = new Map([["page", observation()]]);
    const adjudicationQueue = buildEvidenceAdjudicationQueue({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [
        { filename: "a.json", review: review("reviewer-a") }
      ],
      submissionsB: [
        { filename: "b.json", review: review("reviewer-b") }
      ],
      observations,
      adjudicatorId: "reviewer-c",
      queueAPath: "/repo/benchmark-data/review/reviewer-a.json",
      outputPath: "/repo/benchmark-data/review/adjudication.json"
    });

    expect(adjudicationQueue).toMatchObject({
      queueType: "adjudication",
      reviewerId: "reviewer-c",
      labelVisibility: "independent reviews and disagreements visible",
      sourceQueueIds: [
        "reviewer-a--campaign--0000000000000000",
        "reviewer-b--campaign--0000000000000000"
      ],
      items: [
        {
          pageId: "page",
          observationPath: "observation.json",
          screenshotPath: "screenshot.png",
          reviewTemplate: {
            phase: "adjudicated",
            reviewerId: "reviewer-c",
            sourceReviewIds: ["reviewer-a--page", "reviewer-b--page"]
          }
        }
      ]
    });
    expect(
      validateEvidenceAdjudicationQueue(adjudicationQueue, observations)
    ).toEqual([]);
  });

  it("refuses premature or non-independent adjudication", () => {
    const input: BuildEvidenceAdjudicationQueueInput = {
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [
        { filename: "a.json", review: review("reviewer-a") }
      ],
      submissionsB: [],
      observations: new Map([["page", observation()]]),
      adjudicatorId: "reviewer-c",
      queueAPath: "/repo/benchmark-data/review/reviewer-a.json",
      outputPath: "/repo/benchmark-data/review/adjudication.json"
    };
    expect(() => buildEvidenceAdjudicationQueue(input)).toThrow(
      "0/1 paired pages"
    );

    input.submissionsB = [
      { filename: "b.json", review: review("reviewer-b") }
    ];
    input.adjudicatorId = "reviewer-a";
    expect(() => buildEvidenceAdjudicationQueue(input)).toThrow(
      "Adjudicator must have a non-empty identity distinct from both reviewers."
    );
  });

  it("detects embedded agreement drift", () => {
    const observations = new Map([["page", observation()]]);
    const adjudicationQueue = buildEvidenceAdjudicationQueue({
      queueA: queue("reviewer-a"),
      queueB: queue("reviewer-b"),
      submissionsA: [
        { filename: "a.json", review: review("reviewer-a") }
      ],
      submissionsB: [
        { filename: "b.json", review: review("reviewer-b") }
      ],
      observations,
      adjudicatorId: "reviewer-c",
      queueAPath: "/repo/benchmark-data/review/reviewer-a.json",
      outputPath: "/repo/benchmark-data/review/adjudication.json"
    });
    adjudicationQueue.items[0]!.agreement.exactPointerAgreement = 0;

    expect(
      validateEvidenceAdjudicationQueue(adjudicationQueue, observations)
    ).toContain("adjudication agreement drift: page");
  });

  it("compiles a complete third-party campaign into gold annotations", () => {
    const observations = new Map([["page", observation()]]);
    const adjudicationQueue = adjudicationQueueFixture(observations);
    const adjudication = {
      ...adjudicationQueue.items[0]!.reviewTemplate,
      completedAt: "2026-07-24T21:00:00.000Z",
      products: review("reviewer-a").products
    };

    const result = compileEvidenceAdjudicationCampaign(
      adjudicationQueue,
      [{ filename: "adjudication.json", review: adjudication }],
      observations
    );

    expect(result).toMatchObject({
      valid: true,
      expected: 1,
      submitted: 1,
      compiled: 1,
      missingReviewIds: [],
      unexpectedReviewIds: []
    });
    expect(result.entries[0]?.annotation).toMatchObject({
      reviewStatus: "adjudicated",
      coverage: "complete-main-region",
      annotators: ["reviewer-a", "reviewer-b", "reviewer-c"],
      products: [
        {
          nodeId: "card",
          comparable: true,
          currentPriceCents: 1200
        }
      ]
    });
  });

  it("refuses incomplete or identity-drifted adjudication campaigns", () => {
    const observations = new Map([["page", observation()]]);
    const adjudicationQueue = adjudicationQueueFixture(observations);
    const missing = compileEvidenceAdjudicationCampaign(
      adjudicationQueue,
      [],
      observations
    );
    expect(missing).toMatchObject({
      valid: false,
      compiled: 0,
      missingReviewIds: ["reviewer-c--page"]
    });

    const drifted = {
      ...adjudicationQueue.items[0]!.reviewTemplate,
      completedAt: "2026-07-24T21:00:00.000Z",
      reviewerId: "reviewer-d",
      products: review("reviewer-a").products
    };
    const invalid = compileEvidenceAdjudicationCampaign(
      adjudicationQueue,
      [{ filename: "drifted.json", review: drifted }],
      observations
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toContainEqual(
      expect.objectContaining({
        message: "adjudication identity or source-review contract changed"
      })
    );
  });
});

function adjudicationQueueFixture(
  observations: Map<string, PageObservation>
) {
  return buildEvidenceAdjudicationQueue({
    queueA: queue("reviewer-a"),
    queueB: queue("reviewer-b"),
    submissionsA: [
      { filename: "a.json", review: review("reviewer-a") }
    ],
    submissionsB: [
      { filename: "b.json", review: review("reviewer-b") }
    ],
    observations,
    adjudicatorId: "reviewer-c",
    queueAPath: "/repo/benchmark-data/review/reviewer-a.json",
    outputPath: "/repo/benchmark-data/review/adjudication.json"
  });
}

function queue(reviewerId: string): EvidenceReviewQueue {
  const source = {
    observationSha256: "a".repeat(64),
    screenshotSha256: "b".repeat(64),
    captureTimestamp: "2026-07-24T19:00:00.000Z",
    registrableDomain: "example.com",
    cohort: "training" as const
  };
  return {
    version: 1,
    queueId: `${reviewerId}--campaign--0000000000000000`,
    reviewerId,
    cohort: "training",
    labelVisibility: "no model or peer labels",
    items: [
      {
        pageId: "page",
        source,
        observationPath: "observation.json",
        screenshotPath: "screenshot.png",
        rootNodeId: "root",
        candidateCardNodeIds: ["card"],
        reviewTemplate: {
          version: 1,
          reviewId: `${reviewerId}--page`,
          pageId: "page",
          phase: "independent",
          reviewerId,
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

function review(reviewerId: string): EvidencePointerReview {
  return {
    version: 1,
    reviewId: `${reviewerId}--page`,
    pageId: "page",
    phase: "independent",
    reviewerId,
    completedAt: "2026-07-24T20:00:00.000Z",
    coverage: "complete-main-region",
    preannotationVisibility: "hidden",
    source: {
      observationSha256: "a".repeat(64),
      screenshotSha256: "b".repeat(64),
      captureTimestamp: "2026-07-24T19:00:00.000Z",
      registrableDomain: "example.com",
      cohort: "training"
    },
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: [
          "CARD card",
          "TITLE title",
          "CURRENT_PRICE price@p0",
          "NATIVE_UNIT_PRICE NONE",
          "PACKAGE_QUANTITY quantity@q0",
          "PACK_COUNT NONE",
          "STATUS comparable"
        ].join("\n")
      }
    ]
  };
}

function observation(): PageObservation {
  return {
    version: 1,
    pageId: "page",
    url: "https://example.com/search",
    title: "Search",
    viewport: { width: 1200, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: "root",
    nodes: [
      node("root"),
      node("card", "root"),
      node("title", "card", "Coffee, 12 oz"),
      node("price", "card", "$12.00"),
      node("quantity", "card", "12 oz")
    ],
    truncated: false
  };
}

function node(id: string, parentId?: string, text?: string): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag: parentId ? "span" : "main",
    ...(text ? { text } : {}),
    bounds: { x: 0, y: 0, width: 200, height: 40 },
    intersectsViewport: true,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 16,
      fontWeight: 400
    }
  };
}
