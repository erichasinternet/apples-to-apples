import { preannotateExtraction } from "../../scripts/extraction-preannotation-lib";
import type { ObservedNode, PageObservation } from "../../src/learning/contracts";

describe("extraction preannotation", () => {
  it("grounds a split native unit price and package quantity", () => {
    const observation = page([
      node("card", undefined, "li"),
      node(
        "title",
        "card",
        "h2",
        "Coffee Pods, 24 ct"
      ),
      node("price-group", "card", "div"),
      node("unit-price", "price-group", "span", "$0.39"),
      node("unit-label", "price-group", "span", "( /ct.)")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.outcome).toBe("comparable");
    expect(result.method).toBe("native-unit-price");
    expect(result.extraction.nativeUnitPrice).toMatchObject({
      centsPerUnit: 39,
      unit: "each",
      dimension: "count"
    });
    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 24,
      packCount: 1,
      unit: "each"
    });
    expect(result.evidenceValidation).toEqual({ valid: true, issues: [] });
  });

  it("grounds a split square-foot unit price", () => {
    const observation = page([
      node("card", undefined, "li"),
      node("title", "card", "h2", "Carpet Tile 24x24 Inches"),
      node("price-group", "card", "div"),
      node("unit-price", "price-group", "span", "$1.84"),
      node("unit-label", "price-group", "span", "/sqft")
    ]);

    const result = preannotateExtraction(item("area"), observation);

    expect(result.outcome).toBe("comparable");
    expect(result.extraction.nativeUnitPrice).toMatchObject({
      centsPerUnit: 184,
      unit: "sq_ft",
      dimension: "area"
    });
    expect(result.evidenceValidation).toEqual({ valid: true, issues: [] });
  });

  it("grounds a current price whose title marks it per foot", () => {
    const observation = page([
      node("card", undefined, "li"),
      node(
        "title",
        "card",
        "h2",
        "Double Braided Nylon Rope - Per Foot"
      ),
      node("price", "card", "span", "$0.52")
    ]);

    const result = preannotateExtraction(item("length"), observation);

    expect(result.outcome).toBe("comparable");
    expect(result.extraction.nativeUnitPrice).toMatchObject({
      centsPerUnit: 52,
      unit: "ft",
      dimension: "length",
      evidenceNodeIds: ["price", "title"]
    });
    expect(result.evidenceValidation).toEqual({ valid: true, issues: [] });
  });

  it("uses the campaign target dimension to avoid capacity-as-quantity labels", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "title",
        "card",
        "h3",
        "Heavy Duty Trash Bags, 30 gal, 25 Bags/Roll, 8 Rolls/Box"
      ),
      node("price", "card", "span", "$82.52")
    ]);
    const result = preannotateExtraction(item("count"), observation);

    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 25,
      packCount: 8,
      unit: "bag",
      dimension: "count"
    });
  });

  it("abstains when a card only exposes a different physical dimension", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("title", "card", "h3", "Disposable Tuberculin Syringe, 10 mL"),
      node("price", "card", "span", "$0.57")
    ]);
    const result = preannotateExtraction(item("count"), observation);

    expect(result.outcome).toBe("abstained");
    expect(result.extraction.packageQuantity).toBeUndefined();
  });

  it("uses an unambiguous current price and title quantity", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("title", "card", "h3", "Bath Salts, 16 oz"),
      node("price", "card", "span", "Current price $8.00")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.method).toBe("price-and-package");
    expect(result.extraction.currentPrice?.cents).toBe(800);
    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 16,
      unit: "oz",
      dimension: "mass"
    });
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("reconciles current price when native and package units differ", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "title",
        "card",
        "h3",
        "Special Kitty Cat Litter, 48 lb Bag"
      ),
      node("price", "card", "span", "Current price $10.98"),
      node("unit", "card", "span", "1.4 cents/oz")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.currentPrice?.cents).toBe(1098);
    expect(result.extraction.nativeUnitPrice).toMatchObject({
      centsPerUnit: 1.4,
      unit: "oz"
    });
    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 48,
      unit: "lb"
    });
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("abstains when price evidence is ambiguous", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("title", "card", "h3", "Bath Salts, 16 oz"),
      node("prices", "card", "div", "$8.00 or $10.00")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.method).toBe("explicit-abstention");
    expect(result.extraction.abstainReason).toBe("insufficient-evidence");
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("keeps multiplicative package factors grounded", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("title", "card", "h3", "Rice Cups, 4 x 2.3 oz"),
      node("price", "card", "span", "Current price $2.49")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 2.3,
      packCount: 4,
      unit: "oz"
    });
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("does not mistake physical dimensions for package quantity", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "title",
        "card",
        "h3",
        "500 Count 12 x 10.75 Inch Pre-Cut Foil Sheets"
      ),
      node("prices", "card", "span", "$24.99")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 500,
      unit: "each"
    });
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("preserves a trailing pack-of multiplier", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "title",
        "card",
        "h3",
        "Liquid Hand Soap, 7.5 oz, Pack of 6 Bottles"
      ),
      node("unit", "card", "span", "$0.32/oz")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.packageQuantity).toMatchObject({
      valuePerPackage: 7.5,
      packCount: 6,
      unit: "oz"
    });
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("omits a package quantity from the wrong native-price dimension", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "title",
        "card",
        "h3",
        "Liquid Hand Soap, 11.25 (332.7 mL) oz., Pack of 6"
      ),
      node("unit", "card", "span", "$0.25/oz")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.nativeUnitPrice?.unit).toBe("oz");
    expect(result.extraction.packageQuantity).toBeUndefined();
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("does not use rating text as a title", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("rating", "card", "h3", "4.5 out of 5"),
      node("title", "card", "span", "Fortifying Shampoo for Dry Hair"),
      node("unit", "card", "span", "$0.36/oz")
    ]);

    const result = preannotateExtraction(item(), observation);

    expect(result.extraction.title.value).toBe(
      "Fortifying Shampoo for Dry Hair"
    );
    expect(result.evidenceValidation.valid).toBe(true);
  });

  it("isolates a root with no product title as a grounded abstention", () => {
    const observation = page([
      node("card", undefined, "article"),
      node("unit", "card", "span", "$7.42 / sq ft")
    ]);

    const result = preannotateExtraction(item("area"), observation);

    expect(result.outcome).toBe("abstained");
    expect(result.method).toBe("explicit-abstention");
    expect(result.extraction).toEqual({
      cardNodeId: "card",
      title: {
        value: "$7.42 / sq ft",
        evidenceNodeIds: ["unit"]
      },
      abstainReason: "not-a-product"
    });
    expect(result.evidenceValidation).toEqual({ valid: true, issues: [] });
  });

  it("prefers a product link over promotional and descriptive image text", () => {
    const observation = page([
      node("card", undefined, "article"),
      node(
        "product-link",
        "card",
        "a",
        "Pale Robins Egg Blue Cotton/Silk Lawn 55W"
      ),
      node(
        "product-image",
        "card",
        "img",
        "A close-up of dark olive green fabric arranged in a spiral."
      ),
      node("sale-image", "card", "img", "65% Off!"),
      node("unit", "card", "span", "$14.00 per yard")
    ]);

    const result = preannotateExtraction(item("length"), observation);

    expect(result.extraction.title.value).toBe(
      "Pale Robins Egg Blue Cotton/Silk Lawn 55W"
    );
    expect(result.evidenceValidation.valid).toBe(true);
  });
});

function item(targetDimension?: "mass" | "volume" | "count" | "length" | "area") {
  return {
    id: "shop--query:card",
    pageId: "shop--query",
    siteId: "shop",
    cardNodeId: "card",
    ...(targetDimension ? { targetDimension } : {})
  };
}

function page(nodes: ObservedNode[]): PageObservation {
  return {
    version: 1,
    pageId: "shop--query",
    url: "https://shop.example/search",
    title: "Products",
    viewport: { width: 1200, height: 900, scrollX: 0, scrollY: 0 },
    rootNodeId: "card",
    nodes,
    truncated: false
  };
}

function node(
  id: string,
  parentId: string | undefined,
  tag: string,
  text?: string
): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag,
    ...(text ? { text } : {}),
    bounds: { x: 0, y: 0, width: 300, height: 300 },
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
