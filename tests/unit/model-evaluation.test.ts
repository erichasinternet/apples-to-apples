import type { AnnotatedProduct } from "../../scripts/live-corpus-lib";
import { evaluateValidatedModelPage } from "../../scripts/model-evaluation-lib";
import type {
  ModelProductExtraction,
  ValidatedPageExtraction,
  ValidatedProductExtraction
} from "../../src/learning/contracts";

describe("model corpus evaluation", () => {
  it("measures exact card discovery separately from normalized accuracy", () => {
    const label = comparableLabel("card-a", 25, "lb", "mass");
    const validation = validatedPage([
      prediction("card-a", "accepted", 25, "lb", "mass"),
      prediction("card-b", "accepted", 10, "lb", "mass")
    ]);

    const result = evaluateValidatedModelPage([label], validation);

    expect(result.truePositiveCards).toBe(1);
    expect(result.predictedCards).toBe(2);
    expect(result.falsePositiveCardIds).toEqual(["card-b"]);
    expect(result.falsePositiveDisplayedCardIds).toEqual(["card-b"]);
    expect(result.products[0]?.correctDecision).toBe(true);
  });

  it("counts a validated price on an abstention case as an incorrect display", () => {
    const label: AnnotatedProduct = {
      nodeId: "card-a",
      scope: "primary-results",
      comparable: false,
      title: "Choose a variant",
      evidenceNodeIds: ["title-a"],
      exclusionReason: "unselected variant"
    };
    const validation = validatedPage([
      prediction("card-a", "accepted", 25, "lb", "mass")
    ]);

    const result = evaluateValidatedModelPage([label], validation);

    expect(result.products[0]?.correctDecision).toBe(false);
    expect(result.products[0]?.incorrectDisplayedPrice).toBe(true);
  });

  it("records evidence rejection without treating it as a displayed wrong price", () => {
    const label = comparableLabel("card-a", 25, "lb", "mass");
    const validation = validatedPage([
      prediction("card-a", "rejected")
    ]);

    const result = evaluateValidatedModelPage([label], validation);

    expect(result.rejectedPredictions).toBe(1);
    expect(result.products[0]?.correctDecision).toBe(false);
    expect(result.products[0]?.incorrectDisplayedPrice).toBe(false);
  });
});

function comparableLabel(
  nodeId: string,
  centsPerUnit: number,
  unit: "lb",
  dimension: "mass"
): AnnotatedProduct {
  return {
    nodeId,
    scope: "primary-results",
    comparable: true,
    title: "Product",
    evidenceNodeIds: [`title-${nodeId}`],
    expectedNormalized: { centsPerUnit, unit, dimension }
  };
}

function prediction(
  cardNodeId: string,
  status: ValidatedProductExtraction["status"],
  centsPerUnit?: number,
  unit?: "lb",
  dimension?: "mass"
): ValidatedProductExtraction {
  const extraction: ModelProductExtraction = {
    cardNodeId,
    title: { value: "Product", evidenceNodeIds: [`title-${cardNodeId}`] },
    ...(status === "abstained" ? { abstainReason: "insufficient-evidence" } : {})
  };
  return {
    status,
    extraction,
    issues: [],
    ...(status === "accepted" && centsPerUnit && unit && dimension
      ? {
          normalized: {
            centsPerUnit,
            unit,
            dimension,
            display: `${centsPerUnit}¢/lb`,
            compareKey: "mass:lb",
            explanation: "test",
            warnings: [],
            evidence: []
          }
        }
      : {})
  };
}

function validatedPage(products: ValidatedProductExtraction[]): ValidatedPageExtraction {
  return {
    valid: products.every((product) => product.status !== "rejected"),
    pageId: "page",
    issues: [],
    products
  };
}
