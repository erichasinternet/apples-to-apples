import {
  compileAdjudicatedCorpusAnnotation,
  compareIndependentEvidenceReviews,
  validateEvidenceAdjudication,
  validateEvidencePointerReview,
  type EvidencePointerReview
} from "../../scripts/evidence-review-lib";
import type {
  ObservedNode,
  PageObservation
} from "../../src/learning/contracts";

describe("evidence-pointer reviews", () => {
  it("validates an independent review against immutable evidence", () => {
    const result = validateEvidencePointerReview(review("review-a", "reviewer-a"), observation(), {
      observationSha256: "a".repeat(64),
      screenshotSha256: "b".repeat(64),
      expectedCardNodeIds: ["card"]
    });

    expect(result.valid).toBe(true);
    expect(result.resolvedProducts.get("card")?.valid).toBe(true);
  });

  it("rejects visible preannotations, source drift, and incomplete coverage", () => {
    const input = review("review-a", "reviewer-a");
    input.preannotationVisibility = "shown-after-submit";
    const result = validateEvidencePointerReview(input, observation(), {
      observationSha256: "c".repeat(64),
      expectedCardNodeIds: ["card", "missing"]
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "independent review must hide preannotations",
        "source observation hash does not match",
        "review omits expected cards: missing"
      ])
    );
  });

  it("reports field disagreement without treating it as accepted error", () => {
    const left = review("review-a", "reviewer-a");
    const right = review("review-b", "reviewer-b");
    right.products[0]!.target = target("price-b@p0");

    const agreement = compareIndependentEvidenceReviews(left, right, observation());

    expect(agreement.rootSetExact).toBe(true);
    expect(agreement.comparableKappa).toBe(1);
    expect(agreement.exactPriceAgreement).toBe(0);
    expect(agreement.exactPointerAgreement).toBe(0);
    expect(agreement.disagreements).toEqual([
      { cardNodeId: "card", fields: ["currentPrice"] }
    ]);
  });

  it("requires a distinct adjudicator and exactly the dual-reviewed card set", () => {
    const left = review("review-a", "reviewer-a");
    const right = review("review-b", "reviewer-b");
    const adjudication = review("adjudication", "reviewer-c");
    adjudication.phase = "adjudicated";
    adjudication.preannotationVisibility = "shown-after-submit";
    adjudication.sourceReviewIds = ["review-a", "review-b"];

    expect(
      validateEvidenceAdjudication(adjudication, left, right, observation()).valid
    ).toBe(true);

    adjudication.reviewerId = "reviewer-a";
    adjudication.products.push({
      cardNodeId: "new-card",
      scope: "primary-results",
      target: target("price@p0").replaceAll("card", "new-card")
    });
    const invalid = validateEvidenceAdjudication(
      adjudication,
      left,
      right,
      observation()
    );
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "adjudicator must differ from both independent reviewers",
        "adjudication adds cards lacking dual review: new-card"
      ])
    );
  });

  it("compiles only valid adjudication into deterministic corpus facts", () => {
    const left = review("review-a", "reviewer-a");
    const right = review("review-b", "reviewer-b");
    const adjudication = review("adjudication", "reviewer-c");
    adjudication.phase = "adjudicated";
    adjudication.preannotationVisibility = "shown-after-submit";
    adjudication.sourceReviewIds = ["review-a", "review-b"];

    const annotation = compileAdjudicatedCorpusAnnotation(
      adjudication,
      left,
      right,
      observation()
    );

    expect(annotation).toMatchObject({
      reviewStatus: "adjudicated",
      annotators: ["reviewer-a", "reviewer-b", "reviewer-c"],
      products: [
        {
          comparable: true,
          currentPriceCents: 1200,
          packageQuantity: {
            valuePerPackage: 12,
            packCount: 1,
            unit: "oz",
            dimension: "mass"
          },
          expectedNormalized: {
            centsPerUnit: 1600,
            unit: "lb",
            dimension: "mass"
          }
        }
      ]
    });
  });
});

function target(priceCandidate = "price@p0"): string {
  return [
    "CARD card",
    "TITLE title",
    `CURRENT_PRICE ${priceCandidate}`,
    "NATIVE_UNIT_PRICE NONE",
    "PACKAGE_QUANTITY quantity@q0",
    "PACK_COUNT NONE",
    "STATUS comparable"
  ].join("\n");
}

function review(reviewId: string, reviewerId: string): EvidencePointerReview {
  return {
    version: 1,
    reviewId,
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
        target: target()
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
      node("price-b", "card", "$13.00"),
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
