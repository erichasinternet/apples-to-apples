import type { CorpusAnnotation } from "../../scripts/live-corpus-lib";
import { buildTrainingExample } from "../../scripts/training-export-lib";
import type { ObservedNode, PageObservation } from "../../src/learning/contracts";

describe("training corpus export", () => {
  it("builds an evidence-valid development example from adjudicated labels", () => {
    const observation = makeObservation();
    const annotation = makeAnnotation();

    const result = buildTrainingExample("shop", observation, annotation);

    expect(result.errors).toEqual([]);
    expect(result.example?.split).toBe("development");
    expect(result.example?.target.products[0]?.packageQuantity).toEqual(
      expect.objectContaining({ valuePerPackage: 48, packCount: 1, unit: "lb" })
    );
  });

  it("refuses incomplete coverage and single-review labels by default", () => {
    const annotation = makeAnnotation();
    annotation.coverage = "sampled";
    annotation.annotators = ["reviewer-a"];

    const result = buildTrainingExample("shop", makeObservation(), annotation);

    expect(result.example).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("complete-main-region"),
        expect.stringContaining("two annotators")
      ])
    );
  });

  it("refuses annotations without factored multipack evidence", () => {
    const annotation = makeAnnotation();
    delete annotation.products[0]!.packageQuantity;

    const result = buildTrainingExample("shop", makeObservation(), annotation);

    expect(result.example).toBeUndefined();
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("factored package quantity")])
    );
  });
});

function makeAnnotation(): CorpusAnnotation {
  return {
    version: 1,
    pageId: "shop--cat-litter",
    reviewStatus: "adjudicated",
    coverage: "complete-main-region",
    region: { x: 0, y: 0, width: 1280, height: 800 },
    annotators: ["reviewer-a", "reviewer-b"],
    products: [
      {
        nodeId: "card",
        scope: "primary-results",
        comparable: true,
        title: "Cat Litter, 48 lb",
        evidenceNodeIds: ["title", "price", "quantity"],
        fieldEvidence: {
          title: ["title"],
          currentPrice: ["price"],
          packageQuantity: ["quantity"]
        },
        currentPriceCents: 1098,
        packageQuantity: {
          valuePerPackage: 48,
          packCount: 1,
          unit: "lb",
          dimension: "mass"
        },
        expectedNormalized: {
          centsPerUnit: 22.875,
          unit: "lb",
          dimension: "mass"
        }
      }
    ]
  };
}

function makeObservation(): PageObservation {
  return {
    version: 1,
    pageId: "shop--cat-litter",
    url: "https://shop.example/search",
    title: "Cat litter",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: "card",
    nodes: [
      node("card"),
      node("title", "card", "Cat Litter, 48 lb"),
      node("price", "card", "$10.98"),
      node("quantity", "card", "48 lb")
    ],
    truncated: false
  };
}

function node(id: string, parentId?: string, text?: string): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag: parentId ? "span" : "article",
    ...(text ? { text } : {}),
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    intersectsViewport: true,
    interactive: false,
    style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
  };
}
