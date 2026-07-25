import type {
  ModelProductExtraction,
  ObservedNode,
  PageObservation
} from "../../src/learning/contracts";
import {
  parseEvidencePointer,
  resolveEvidencePointer,
  scoreEvidencePointer,
  serializeEvidencePointer
} from "../../src/learning/evidence-pointer";

describe("evidence pointer contract", () => {
  it("strictly parses and resolves split price and factored multipack evidence", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Coffee Pods, 4 Pack of 25 count"),
      node("price", "card"),
      node("currency", "price", "$"),
      node("whole", "price", "20"),
      node("cents", "price", "00"),
      node("quantity", "card", "4 Pack of 25 count")
    ]);
    const output = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE price@p0",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY quantity@q0",
      "PACK_COUNT quantity@k0",
      "STATUS comparable"
    ].join("\n");

    const result = resolveEvidencePointer(output, observation);

    expect(result.valid).toBe(true);
    expect(result.extraction?.products[0]).toMatchObject({
      currentPrice: { cents: 2000 },
      packageQuantity: {
        valuePerPackage: 25,
        packCount: 4,
        unit: "each",
        dimension: "count"
      }
    });
    expect(result.validation?.products[0]?.normalized?.centsPerUnit).toBe(20);
  });

  it("uses a selected retailer-native unit price without generating numbers", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Cat Litter, 17 lb"),
      node("unit", "card", "9.2 ¢/oz")
    ]);
    const output = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE NONE",
      "NATIVE_UNIT_PRICE unit@u0",
      "PACKAGE_QUANTITY NONE",
      "PACK_COUNT NONE",
      "STATUS comparable"
    ].join("\n");

    const result = resolveEvidencePointer(output, observation);

    expect(result.valid).toBe(true);
    expect(result.extraction?.products[0]?.nativeUnitPrice).toMatchObject({
      centsPerUnit: 9.2,
      unit: "oz",
      dimension: "mass"
    });
    expect(result.validation?.products[0]?.normalized?.display).toBe("$1.47/lb");
  });

  it("selects the intended quantity when one title contains count and capacity", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Trash Bags, 120 count, 13 gal"),
      node("price", "card", "$24.00")
    ]);
    const output = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE price@p0",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY title@q0",
      "PACK_COUNT NONE",
      "STATUS comparable"
    ].join("\n");

    const result = resolveEvidencePointer(output, observation);

    expect(result.valid).toBe(true);
    expect(result.extraction?.products[0]?.packageQuantity).toMatchObject({
      valuePerPackage: 120,
      unit: "each",
      dimension: "count"
    });
    expect(result.validation?.products[0]?.normalized?.centsPerUnit).toBe(20);
  });

  it("rejects Markdown, reordered fields, generated values, and extra lines", () => {
    const invalid = [
      "```",
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE $10.98",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY quantity",
      "PACK_COUNT NONE",
      "STATUS comparable",
      "```"
    ].join("\n");

    expect(parseEvidencePointer(invalid).valid).toBe(false);
    expect(parseEvidencePointer(invalid).issues[0]?.code).toBe("invalid-line-count");
  });

  it("rejects evidence outside the selected card", () => {
    const observation = makeObservation([
      node("card-a"),
      node("title-a", "card-a", "Product A, 10 lb"),
      node("quantity-a", "card-a", "10 lb"),
      node("card-b"),
      node("price-b", "card-b", "$5.00")
    ]);
    const output = [
      "CARD card-a",
      "TITLE title-a",
      "CURRENT_PRICE price-b@p0",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY quantity-a@q0",
      "PACK_COUNT NONE",
      "STATUS comparable"
    ].join("\n");

    const result = resolveEvidencePointer(output, observation);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "evidence-outside-card",
          field: "CURRENT_PRICE"
        })
      ])
    );
  });

  it("requires abstentions to omit all value pointers", () => {
    const output = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE price@p0",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY NONE",
      "PACK_COUNT NONE",
      "STATUS price-range"
    ].join("\n");

    expect(parseEvidencePointer(output)).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: "incompatible-status" })]
    });
  });

  it("serializes existing grounded targets without values", () => {
    const product: ModelProductExtraction = {
      cardNodeId: "card",
      title: { value: "Cat Litter", evidenceNodeIds: ["title"] },
      currentPrice: {
        cents: 1098,
        currency: "USD",
        evidenceNodeIds: ["currency", "whole", "cents"]
      },
      packageQuantity: {
        valuePerPackage: 48,
        packCount: 1,
        unit: "lb",
        dimension: "mass",
        evidenceNodeIds: ["quantity"]
      }
    };

    const observation = makeObservation([
      node("card"),
      node("title", "card", "Cat Litter, 48 lb"),
      node("price", "card"),
      node("currency", "price", "$"),
      node("whole", "price", "10"),
      node("cents", "price", "98"),
      node("quantity", "card", "48 lb")
    ]);
    const serialized = serializeEvidencePointer(product, observation);

    expect(serialized).not.toContain("1098");
    expect(serialized).not.toContain("48");
    expect(serialized).toContain("CURRENT_PRICE price@p0");
    expect(serialized).toContain("PACK_COUNT NONE");
  });

  it("scores wrong accepted prices as errors and abstentions as lost coverage", () => {
    const observation = makeObservation([
      node("card"),
      node("title", "card", "Cat Litter, 20 lb"),
      node("price", "card", "$10.00"),
      node("other-price", "card", "$20.00"),
      node("quantity", "card", "20 lb")
    ]);
    const target = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE price@p0",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY quantity@q0",
      "PACK_COUNT NONE",
      "STATUS comparable"
    ].join("\n");
    const wrong = target.replace("CURRENT_PRICE price@p0", "CURRENT_PRICE other-price@p0");
    const abstained = [
      "CARD card",
      "TITLE title",
      "CURRENT_PRICE NONE",
      "NATIVE_UNIT_PRICE NONE",
      "PACKAGE_QUANTITY NONE",
      "PACK_COUNT NONE",
      "STATUS insufficient-evidence"
    ].join("\n");

    expect(scoreEvidencePointer(wrong, target, observation)).toMatchObject({
      syntaxValid: true,
      evidenceAccepted: true,
      acceptedCorrect: false,
      acceptedIncorrect: true
    });
    expect(scoreEvidencePointer(abstained, target, observation)).toMatchObject({
      syntaxValid: true,
      evidenceAccepted: true,
      acceptedCorrect: false,
      acceptedIncorrect: false,
      abstentionClassMatch: false
    });
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
      fontWeight: 400
    }
  };
}

function makeObservation(nodes: ObservedNode[]): PageObservation {
  return {
    version: 1,
    pageId: "pointer-page",
    url: "https://example.test/search",
    title: "Search",
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: nodes[0]!.id,
    nodes,
    truncated: false
  };
}
