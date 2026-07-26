import type { ModelPageExtraction, ObservedNode, PageObservation } from "../../src/learning/contracts";
import { validateModelExtraction } from "../../src/learning/evidence-validator";

describe("model evidence validator", () => {
  it("accepts grounded facts and performs package arithmetic deterministically", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Special Kitty Cat Litter, 48 lb Bag"),
      node("price", "card", "current price $10.98"),
      node("quantity", "card", "48 lb bag")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: "Special Kitty Cat Litter, 48 lb Bag", evidenceNodeIds: ["title"] },
      currentPrice: { cents: 1098, currency: "USD", evidenceNodeIds: ["price"] },
      packageQuantity: {
        valuePerPackage: 48,
        unit: "lb",
        dimension: "mass",
        packCount: 1,
        evidenceNodeIds: ["quantity"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(true);
    expect(result.products[0]?.status).toBe("accepted");
    expect(result.products[0]?.normalized?.unit).toBe("lb");
    expect(result.products[0]?.normalized?.centsPerUnit).toBeCloseTo(22.875);
  });

  it("accepts a package price followed by a slash and numeric quantity", () => {
    const text = '1" Nylon Webbing @ $93.50 / 100 YARD ROLL';
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", text)
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: text, evidenceNodeIds: ["title"] },
      currentPrice: {
        cents: 9350,
        currency: "USD",
        evidenceNodeIds: ["title"]
      },
      packageQuantity: {
        valuePerPackage: 100,
        unit: "yd",
        dimension: "length",
        packCount: 1,
        evidenceNodeIds: ["title"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(true);
    expect(result.products[0]?.normalized?.centsPerUnit).toBeCloseTo(
      9350 / 300
    );
  });

  it("accepts a compact package quantity cited in the title", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Nutrabio Multi Collagen 1lb"),
      node("price", "card", "$34.99")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: {
        value: "Nutrabio Multi Collagen 1lb",
        evidenceNodeIds: ["title"]
      },
      currentPrice: {
        cents: 3499,
        currency: "USD",
        evidenceNodeIds: ["price"]
      },
      packageQuantity: {
        valuePerPackage: 1,
        unit: "lb",
        dimension: "mass",
        packCount: 1,
        evidenceNodeIds: ["title"]
      }
    });

    expect(validateModelExtraction(output, observation).valid).toBe(true);
  });

  it("multiplies a grounded reversed multipack without asking the model for the total", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Floss Picks, 90 each x 6 pack"),
      node("price", "card", "$6.88"),
      node("quantity", "card", "90 each x 6 pack")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: "Floss Picks, 90 each x 6 pack", evidenceNodeIds: ["title"] },
      currentPrice: { cents: 688, currency: "USD", evidenceNodeIds: ["price"] },
      packageQuantity: {
        valuePerPackage: 90,
        unit: "each",
        dimension: "count",
        packCount: 6,
        evidenceNodeIds: ["quantity"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(true);
    expect(result.products[0]?.normalized?.centsPerUnit).toBeCloseTo(688 / 540);
  });

  it("rejects a number that is not present in the cited evidence", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Cat Litter, 20 lb"),
      node("price", "card", "$11.97"),
      node("quantity", "card", "20 lb")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: "Cat Litter, 20 lb", evidenceNodeIds: ["title"] },
      currentPrice: { cents: 997, currency: "USD", evidenceNodeIds: ["price"] },
      packageQuantity: {
        valuePerPackage: 20,
        unit: "lb",
        dimension: "mass",
        packCount: 1,
        evidenceNodeIds: ["quantity"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ungrounded-number", field: "currentPrice.cents" })
      ])
    );
    expect(result.products[0]?.status).toBe("rejected");
  });

  it("rejects evidence borrowed from another product card", () => {
    const observation = makeObservation([
      node("card-a", undefined),
      node("title-a", "card-a", "Product A, 10 lb"),
      node("quantity-a", "card-a", "10 lb"),
      node("card-b", undefined),
      node("price-b", "card-b", "$5.00")
    ]);
    const output = extraction({
      cardNodeId: "card-a",
      title: { value: "Product A, 10 lb", evidenceNodeIds: ["title-a"] },
      currentPrice: { cents: 500, currency: "USD", evidenceNodeIds: ["price-b"] },
      packageQuantity: {
        valuePerPackage: 10,
        unit: "lb",
        dimension: "mass",
        packCount: 1,
        evidenceNodeIds: ["quantity-a"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "evidence-outside-card" })])
    );
  });

  it("accepts an explicit abstention without exposing confidence", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Paper Towels, Choose a Size")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: "Paper Towels, Choose a Size", evidenceNodeIds: ["title"] },
      abstainReason: "unselected-variant"
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(true);
    expect(result.products[0]?.status).toBe("abstained");
    expect(JSON.stringify(output)).not.toContain("confidence");
  });

  it("accepts a retailer-provided unit price without recalculating it in the model", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Lightweight Cat Litter, 8.5 lb"),
      node("unit-price", "card", "$1.76/lb")
    ]);
    const output = extraction({
      cardNodeId: "card",
      title: { value: "Lightweight Cat Litter, 8.5 lb", evidenceNodeIds: ["title"] },
      nativeUnitPrice: {
        centsPerUnit: 176,
        unit: "lb",
        dimension: "mass",
        evidenceNodeIds: ["unit-price"]
      }
    });

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(true);
    expect(result.products[0]?.normalized?.centsPerUnit).toBe(176);
    expect(result.products[0]?.normalized?.display).toBe("$1.76/lb");
  });

  it("rejects unknown output fields instead of silently accepting them", () => {
    const observation = makeObservation([
      node("card", undefined),
      node("title", "card", "Paper Towels")
    ]);
    const output = {
      ...extraction({
        cardNodeId: "card",
        title: { value: "Paper Towels", evidenceNodeIds: ["title"] },
        abstainReason: "insufficient-evidence"
      }),
      confidence: 0.98
    };

    const result = validateModelExtraction(output, observation);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "invalid-schema" })])
    );
  });
});

function node(id: string, parentId?: string, text?: string): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag: parentId ? "span" : "article",
    ...(text ? { text } : {}),
    bounds: { x: 0, y: 0, width: 200, height: 40 },
    intersectsViewport: true,
    interactive: false,
    style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
  };
}

function makeObservation(nodes: ObservedNode[]): PageObservation {
  return {
    version: 1,
    pageId: "test-page",
    url: "https://example.test/search",
    title: "Search",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: nodes[0]!.id,
    nodes,
    truncated: false
  };
}

function extraction(product: ModelPageExtraction["products"][number]): ModelPageExtraction {
  return {
    version: 1,
    pageId: "test-page",
    products: [product]
  };
}
