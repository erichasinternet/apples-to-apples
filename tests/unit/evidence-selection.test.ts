import type {
  ModelProductExtraction,
  ObservedNode,
  PageObservation,
} from "../../src/learning/contracts";
import {
  buildEvidenceSelectionPrompt,
  parseEvidenceSelection,
  resolveEvidenceSelection,
  serializeEvidenceSelection,
} from "../../src/learning/evidence-selection";

describe("compact evidence selection contract", () => {
  it("serializes and resolves a native unit price with local indexes", () => {
    const observation = makeObservation([
      node("dom-card-938"),
      node("dom-title-412", "dom-card-938", "Cat Litter, 17 lb"),
      node("dom-unit-729", "dom-card-938", "9.2 ¢/oz"),
    ]);
    const product: ModelProductExtraction = {
      cardNodeId: "dom-card-938",
      title: {
        value: "Cat Litter, 17 lb",
        evidenceNodeIds: ["dom-title-412"],
      },
      nativeUnitPrice: {
        centsPerUnit: 9.2,
        unit: "oz",
        dimension: "mass",
        evidenceNodeIds: ["dom-unit-729"],
      },
    };

    const target = serializeEvidenceSelection(product, observation);
    const resolved = resolveEvidenceSelection(
      target,
      observation,
      product.cardNodeId,
    );

    expect(target).toMatch(/^T01 P-- U[0-9A-Z]{2} Q-- K-- SC$/);
    expect(target).not.toContain("dom-");
    expect(resolved.valid).toBe(true);
    expect(resolved.validation?.products[0]?.normalized?.display).toBe(
      "$1.47/lb",
    );
  });

  it("round-trips price, quantity, and pack-count candidates", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Coffee Pods, 4 Pack of 25 count"),
      node("price", "card", "$20.00"),
      node("quantity", "card", "4 Pack of 25 count"),
    ]);
    const product: ModelProductExtraction = {
      cardNodeId: "card",
      title: {
        value: "Coffee Pods, 4 Pack of 25 count",
        evidenceNodeIds: ["title"],
      },
      currentPrice: {
        cents: 2000,
        currency: "USD",
        evidenceNodeIds: ["price"],
      },
      packageQuantity: {
        valuePerPackage: 25,
        packCount: 4,
        unit: "each",
        dimension: "count",
        evidenceNodeIds: ["quantity"],
      },
    };

    const target = serializeEvidenceSelection(product, observation);
    const resolved = resolveEvidenceSelection(target, observation, "card");

    expect(target).toMatch(
      /^T01 P[0-9A-Z]{2} U-- Q[0-9A-Z]{2} K[0-9A-Z]{2} SC$/,
    );
    expect(resolved.valid).toBe(true);
    expect(resolved.extraction?.products[0]?.packageQuantity).toMatchObject({
      valuePerPackage: 25,
      packCount: 4,
      unit: "each",
    });
  });

  it("round-trips a price paired with a separate per-foot title marker", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Double Braided Nylon Rope - Per Foot"),
      node("price", "card", "$0.52"),
    ]);
    const product: ModelProductExtraction = {
      cardNodeId: "card",
      title: {
        value: "Double Braided Nylon Rope - Per Foot",
        evidenceNodeIds: ["title"],
      },
      nativeUnitPrice: {
        centsPerUnit: 52,
        unit: "ft",
        dimension: "length",
        evidenceNodeIds: ["price", "title"],
      },
    };

    const target = serializeEvidenceSelection(product, observation);
    const resolved = resolveEvidenceSelection(target, observation, "card");

    expect(target).toMatch(/^T01 P-- U[0-9A-Z]{2} Q-- K-- SC$/);
    expect(resolved.valid).toBe(true);
    expect(
      resolved.extraction?.products[0]?.nativeUnitPrice?.evidenceNodeIds,
    ).toEqual(["price", "title"]);
  });

  it("uses a fixed abstention grammar", () => {
    expect(parseEvidenceSelection("T01 P-- U-- Q-- K-- SR")).toMatchObject({
      valid: true,
      selection: { status: "price-range" },
    });
    expect(parseEvidenceSelection("T01 P02 U-- Q-- K-- SR")).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "incompatible-status" })],
    });
    expect(parseEvidenceSelection("STATUS comparable").valid).toBe(false);
  });

  it("rejects a value index used for the wrong field kind", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Cat Litter, 20 lb"),
      node("price", "card", "$10.00"),
      node("quantity", "card", "20 lb"),
    ]);
    const validProduct: ModelProductExtraction = {
      cardNodeId: "card",
      title: {
        value: "Cat Litter, 20 lb",
        evidenceNodeIds: ["title"],
      },
      currentPrice: {
        cents: 1000,
        currency: "USD",
        evidenceNodeIds: ["price"],
      },
      packageQuantity: {
        valuePerPackage: 20,
        packCount: 1,
        unit: "lb",
        dimension: "mass",
        evidenceNodeIds: ["quantity"],
      },
    };
    const target = serializeEvidenceSelection(validProduct, observation);
    const priceCode = target.match(/ P([0-9A-Z]{2}) /)?.[1];
    const wrong = target.replace(/ Q[0-9A-Z]{2} /, ` Q${priceCode} `);

    expect(resolveEvidenceSelection(wrong, observation, "card")).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "invalid-pointer" })],
    });
  });

  it("builds a compact prompt without exposing source DOM IDs", () => {
    const observation = makeObservation([
      node("dom-card-938"),
      node("dom-title-412", "dom-card-938", "Cat Litter, 17 lb"),
      node("dom-unit-729", "dom-card-938", "9.2 ¢/oz"),
    ]);

    const prompt = buildEvidenceSelectionPrompt(observation, "dom-card-938");

    expect(prompt).toContain("OUTPUT T## P## U## Q## K## S#");
    expect(prompt).toContain("CARD 00");
    expect(prompt).not.toContain("dom-card-938");
    expect(prompt).not.toContain("dom-title-412");
    expect(prompt).not.toContain("dom-unit-729");
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
    style: {
      display: "block",
      position: "static",
      fontSize: 16,
      fontWeight: 400,
    },
  };
}

function makeObservation(nodes: ObservedNode[]): PageObservation {
  return {
    version: 1,
    pageId: "selection-page",
    url: "https://example.test/search",
    title: "Search",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: nodes[0]!.id,
    nodes,
    truncated: false,
  };
}
