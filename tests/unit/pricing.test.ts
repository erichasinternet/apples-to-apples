import {
  extractPackCount,
  findBestPrice,
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
});

describe("quantity parsing", () => {
  it.each([
    ["Purina Tidy Cats 17 lb Pail", 17, "lb"],
    ["12 x 16.9 fl oz bottles", 202.8, "fl_oz"],
    ["4 Pack of 25 count wipes", 100, "each"],
    ["Paper Towels 612 sq ft", 612, "sq_ft"],
    ["Coffee Pods 72 ct", 72, "each"],
    ["Trash Bags 120 count 13 gal", 13, "gal"]
  ])("extracts package size from %s", (text, value, unit) => {
    const selected = selectPackageQuantity(parseQuantities(text));
    expect(selected?.value).toBeCloseTo(value);
    expect(selected?.unit).toBe(unit);
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
});

describe("normalization", () => {
  it("converts cents per ounce to dollars per pound", () => {
    const product = makeProduct("Tidy Cats LightWeight 17 lb Pail", "$24.97 9.2 ¢/oz");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("$1.47/lb");
  });

  it("uses package math when native unit price is missing", () => {
    const product = makeProduct("Special Kitty Cat Litter 20 lbs Jug", "$7.86");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("39.3¢/lb");
  });

  it("does not compare unlike count units", () => {
    const product = makeProduct("Paper Towels 12 rolls", "$18.00");
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
