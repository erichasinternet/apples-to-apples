import {
  extractPackCount,
  findBestPrice,
  isLikelyPackageQuantity,
  parseFactoredPackageQuantities,
  parseMoneyValues,
  parseNativeUnitPrices,
  parseQuantities,
  selectPackageQuantity
} from "../../src/core/pricing";
import { normalizeProduct } from "../../src/core/normalizer";
import { DEFAULT_PREFERENCES, type ProductInput } from "../../src/core/types";

describe("price parsing", () => {
  it("parses ordinary dollar prices and Walmart split cents", () => {
    expect(parseMoneyValues("current price $14.83")[0]?.cents).toBe(1483);
    expect(parseMoneyValues("$14 83")[0]?.cents).toBe(1483);
    expect(parseMoneyValues("Now $1,249.99")[0]?.cents).toBe(124999);
  });

  it("prefers current sale price over was price", () => {
    expect(findBestPrice("current price Now $17.83, Was $19.97")?.cents).toBe(1783);
  });

  it("prefers a single-item price over a multi-buy offer total", () => {
    expect(
      findBestPrice("Current sale price is 2/$15.00 or 1/$8.99")?.cents
    ).toBe(899);
  });
});

describe("unit price parsing", () => {
  it.each([
    ["67.4 ¢/lb", 67.4, "lb"],
    ["9.2¢/oz", 9.2, "oz"],
    ["$1.76/lb", 176, "lb"],
    ["$0.12/fl oz", 12, "fl_oz"],
    ["44.0 cents/count", 44, "each"]
  ])("parses %s", (text, cents, unit) => {
    const parsed = parseNativeUnitPrices(text)[0];
    expect(parsed?.centsPerUnit).toBeCloseTo(cents);
    expect(parsed?.unit).toBe(unit);
  });

  it("keeps fluid ounces separate from weight ounces", () => {
    expect(parseNativeUnitPrices("$0.12/fl oz")[0]?.dimension).toBe("volume");
    expect(parseNativeUnitPrices("9.2 ¢/oz")[0]?.dimension).toBe("mass");
  });

  it("parses unit pricing split by retailer grouping punctuation", () => {
    expect(parseNativeUnitPrices("$0.39 ( /ct.)")[0]).toMatchObject({
      centsPerUnit: 39,
      unit: "each",
      dimension: "count"
    });
  });

  it("parses common area and length unit-price spellings", () => {
    expect(parseNativeUnitPrices("$1.84/sqft")[0]).toMatchObject({
      centsPerUnit: 184,
      unit: "sq_ft",
      dimension: "area"
    });
    expect(parseNativeUnitPrices("$0.65 per yard")[0]).toMatchObject({
      centsPerUnit: 65,
      unit: "yd",
      dimension: "length"
    });
    expect(parseNativeUnitPrices("$9.80 per yard")[0]?.centsPerUnit).toBe(980);
  });
});

describe("quantity parsing", () => {
  it.each([
    ["Purina Tidy Cats 17 lb Pail", 17, "lb"],
    ["12 x 16.9 fl oz bottles", 202.8, "fl_oz"],
    ["4 Pack of 25 count wipes", 100, "each"],
    ["Paper Towels 612 sq ft", 612, "sq_ft"],
    ["Coffee Pods 72 ct", 72, "each"],
    ["Trash Bags 120 count 13 gal", 13, "gal"],
    ["Aluminum Foil, 12\"x1000 ft Roll", 1000, "ft"]
  ])("extracts package size from %s", (text, value, unit) => {
    const selected = selectPackageQuantity(parseQuantities(text));
    expect(selected?.value).toBeCloseTo(value);
    expect(selected?.unit).toBe(unit);
  });

  it("parses compact quantities without treating attached product codes as count", () => {
    expect(parseQuantities("Nutrabio Multi Collagen 1lb")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 1, unit: "lb" })
      ])
    );
    expect(
      parseQuantities("Trash Bags 100 Box (CLO 78526CT)").some(
        (quantity) => quantity.value === 78526
      )
    ).toBe(false);
    expect(parseQuantities("Softsoap Pumps CPCUS04964CT")).toEqual([]);
    expect(parseQuantities("$137.12 CT Add to Cart")).toEqual([]);
    expect(parseQuantities("Napkins, 8000/Cs")).toContainEqual(
      expect.objectContaining({ value: 8000, unit: "each" })
    );
  });

  it("captures multipack count separately", () => {
    expect(extractPackCount("Fresh scent refill, 4 Pack")).toBe(4);
    expect(extractPackCount("Hand soap, 7.5 oz, Pack of 6 bottles")).toBe(6);
    expect(extractPackCount("Hand soap, 7.5 fl oz, 6/Carton")).toBe(6);
    expect(extractPackCount("Hand soap, 11.25 oz, Total Qty 6")).toBe(6);
    expect(extractPackCount("100 Count -- 8 Per Case")).toBe(8);
    expect(extractPackCount("25 Bags/Roll, 8 Rolls/Box")).toBe(8);
    expect(extractPackCount("1600 mL Refills, Case of 4")).toBe(4);
    expect(extractPackCount("150 oz Bottle 4 Carton")).toBe(4);
  });

  it.each([
    ["2 x 12 oz bottles", 12, 2, "oz"],
    ["90 each x 6 pack", 90, 6, "each"],
    ["4 Pack of 25 count wipes", 25, 4, "each"]
  ])("keeps factored package quantities for %s", (text, value, packs, unit) => {
    expect(parseFactoredPackageQuantities(text)[0]).toMatchObject({
      valuePerPackage: value,
      packCount: packs,
      unit
    });
  });

  it.each([
    ["Lenovo 15.1 in Gaming Laptop", "15.1 in", false],
    ["Lenovo Gaming Laptop, 4.19 lb", "4.19 lb", false],
    ["Casebound Notebooks, 24 lb Basis Weight Paper", "24 lb", false],
    ["USB-C Laptop Cable, 10 ft", "10 ft", true],
    ["Aluminum Foil, 75 ft", "75 ft", true],
    ["50-Pack Aluminum Foil Pans, 8x8x2 Inch", "2 Inch", false],
    ["Pre-Cut Aluminum Foil Sheets, 14 x 10.25 Inches, 50 Sheets", "10.25 Inches", false],
    ["Trash Liner, 38 x 58 in, 200 per case", "38 x 58 in", false],
    ["Automatic Soap Dispenser, 1200 mL", "1200 mL", false],
    ["3 mL Luer-Lok Syringes, 100 Count", "3 mL", false],
    ["Clear Deli Container, 32 oz, 240 per case", "32 oz", false],
    ["32 oz Amber Glass Bottle with Cap", "32 oz", false],
    ["Olive Oil, 1 Gallon PET Plastic Bottle", "1 Gallon", true],
    ["Pool Shock, 25 lb Bucket", "25 lb", true],
    ["Commercial Vacuum Cleaner, 1 Each", "1 Each", false],
    ["ActiveLife 1-Piece Drainable Ostomy Bag", "1-Piece", false],
    ["Cat Litter, 20 lb", "20 lb", true]
  ])("classifies sale quantity semantics for %s", (title, quantityText, expected) => {
    const quantity = parseQuantities(quantityText)[0];
    expect(quantity).toBeDefined();
    expect(isLikelyPackageQuantity(title, quantity!)).toBe(expected);
  });
});

describe("normalization", () => {
  it("converts cents per ounce to dollars per pound", () => {
    const product = makeProduct("Tidy Cats LightWeight 17 lb Pail", "$24.97 9.2 ¢/oz");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("$1.47/lb");
  });

  it("converts a per-yard price to the preferred per-foot unit", () => {
    const product = makeProduct("Marine fabric sold by the yard", "$0.65 per yard");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.unit).toBe("ft");
    expect(normalized?.centsPerUnit).toBeCloseTo(65 / 3);
    expect(normalized?.display).toBe("21.7¢/ft");
  });

  it("uses package math when native unit price is missing", () => {
    const product = makeProduct("Special Kitty Cat Litter 20 lbs Jug", "$7.86");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("39.3¢/lb");
  });

  it("does not compare unlike count units", () => {
    const product = makeProduct("Gift Wrap 12 rolls", "$18.00");
    const normalized = normalizeProduct(product, {
      ...DEFAULT_PREFERENCES,
      preferredUnits: {
        ...DEFAULT_PREFERENCES.preferredUnits,
        count: "each"
      }
    }).normalized;
    expect(normalized?.unit).toBe("roll");
    expect(normalized?.display).toBe("$1.50/roll");
  });

  it("normalizes detergent by fluid ounce from package math", () => {
    const product = makeProduct("FreshWash Concentrated Laundry Detergent, 154 fl oz, 107 loads", "$18.48");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.compareKey).toBe("volume:fl_oz");
    expect(normalized?.display).toBe("12¢/fl oz");
  });

  it("normalizes paper towels by area when square footage is visible", () => {
    const product = makeProduct("Kitchen Roll Paper Towels, 12 rolls, 840 sheets, 612 sq ft", "$22.99");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.compareKey).toBe("area:sq_ft");
    expect(normalized?.display).toBe("3.76¢/sq ft");
  });

  it("includes a separately stated pack count in package math", () => {
    const product = makeProduct(
      "Bounty Paper Towels, 108 sheets per roll, 4 pack",
      "$5.49"
    );

    expect(product.packCount).toBe(4);
    expect(normalizeProduct(product).normalized?.display).toBe("1.27¢/sheet");
  });

  it("does not multiply a factored package quantity twice", () => {
    const product = makeProduct("Cat Food, 4 pack of 12 oz cans", "$12.00");

    expect(normalizeProduct(product).normalized?.display).toBe("$4.00/lb");
  });

  it("does not multiply a slash-case total twice", () => {
    const product = makeProduct(
      "Clear Deli Container, 500/Case",
      "$100.00"
    );

    expect(product.packCount).toBe(500);
    expect(normalizeProduct(product).normalized?.display).toBe("20¢/count");
  });

  it("does not multiply duplicate each and per-box counts", () => {
    const product = makeProduct(
      "Toilet Seat Covers, 250 EA/BX, Quantity: 250 per Box",
      "$4.56"
    );

    expect(product.packCount).toBe(250);
    expect(normalizeProduct(product).normalized?.display).toBe("1.82¢/count");
  });

  it("prefers a specific package count over a native per-each rate", () => {
    const product = makeProduct(
      "Bounty Paper Towels, 108 sheets per roll, 4 pack",
      "$5.49 $1.37 / ea"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("1.27¢/sheet");
  });

  it("treats a native per-item price as the case price when a piece count is explicit", () => {
    const product = makeProduct(
      "Flat Dry Wax Deli Paper, 3x1000-Piece Pack",
      "$55.99 / item"
    );

    expect(product.packageQuantity?.value).toBe(3000);
    expect(normalizeProduct(product).normalized?.display).toBe("1.87¢/count");
  });

  it("abstains when a retailer per-item price conflicts with an ambiguous each count", () => {
    const product = makeProduct(
      "Scott Paper Towels, Choose a Sheet - 6 ea",
      "$5.00 $5.00 / item"
    );

    expect(product.packageQuantity?.sourceText).toBe("6 ea");
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("prefers meaningful package length over a native per-each rate", () => {
    const product = makeProduct(
      "Commercial Vacuum Hose, 50 ft",
      "$100.00 $100.00 / ea"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("$2.00/ft");
  });

  it("rejects container capacity as package contents", () => {
    const title = "55 Gallon Trash Bags, Heavy Duty, 60 Count";
    const quantity = selectPackageQuantity(
      parseQuantities(title).filter((candidate) =>
        isLikelyPackageQuantity(title, candidate)
      )
    );
    const product: ProductInput = {
      id: title,
      site: "test",
      pageType: "search",
      title,
      price: { cents: 1800, currency: "USD", sourceText: "$18.00", index: 0 },
      evidence: [],
      ...(quantity ? { packageQuantity: quantity } : {})
    };

    expect(quantity?.unit).toBe("each");
    expect(normalizeProduct(product).normalized?.display).toBe("30¢/count");
  });

  it("does not produce a normalized result without a usable quantity or native unit price", () => {
    const product = makeProduct("Snack variety box, family size", "$12.99");
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });
});

function makeProduct(title: string, text: string): ProductInput {
  const nativeUnitPrice = parseNativeUnitPrices(text)[0];
  const quantities = parseQuantities(`${title} ${text}`);
  const price = findBestPrice(text);
  const packageQuantity = selectPackageQuantity(quantities, nativeUnitPrice?.dimension);
  const packCount = extractPackCount(title);

  return {
    id: title,
    site: "test",
    pageType: "search",
    title,
    evidence: [],
    ...(price ? { price } : {}),
    ...(nativeUnitPrice ? { nativeUnitPrice } : {}),
    ...(packageQuantity ? { packageQuantity } : {}),
    ...(packCount ? { packCount } : {})
  };
}
