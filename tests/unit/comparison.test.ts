import type { NormalizedPrice } from "../../src/core/types";
import { comparisonFamilyKey } from "../../src/core/comparison-family";
import {
  buildComparisonGroups,
  buildLowestSignals,
  findLowestProductIds,
  formatAccessibleUnitPrice,
  isMatchingNativeUnitPrice
} from "../../src/content/comparison";
import type { DomProduct } from "../../src/content/extractor";

describe("comparison presentation model", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("builds stable basis-specific groups", () => {
    const products = [
      product("mass-a", "mass:lb", 42),
      product("mass-b", "mass:lb", 21),
      product("volume-a", "volume:fl_oz", 12)
    ];

    expect(buildComparisonGroups(products)).toEqual([
      expect.objectContaining({
        compareKey: "mass:lb",
        count: 2,
        label: "per lb",
        sortLabel: "Unit price per lb: low to high"
      }),
      expect.objectContaining({
        compareKey: "volume:fl_oz",
        count: 1,
        label: "per fl oz"
      })
    ]);
  });

  it("recognizes detergent titles without the word laundry and ignores benefit claims", () => {
    expect(
      comparisonFamilyKey({
        title: "Purex Free & Clear Liquid Detergent, 150 fl oz"
      })
    ).toBe("laundry:detergent-liquid");
    expect(
      comparisonFamilyKey({
        title:
          "Tide PODs Laundry Detergent, 14 Count, 3-in-1 Stain Remover, Odor Fighter"
      })
    ).toBe("laundry:detergent-pod");
    expect(
      comparisonFamilyKey({
        title: "OxiClean Versatile Stain Remover Powder, 3 lb, 65 Loads"
      })
    ).toBe("laundry:stain-remover");
  });

  it("does not infer laundry detergent from unrelated spot removers or load counts", () => {
    expect(
      comparisonFamilyKey({
        title: "Folex Instant Carpet Spot Remover, 32 fl oz"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Cascade Dishwasher Detergent ActionPacs, 62 Count, 62 Loads"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Palmolive Ultra Strength Liquid Dish Detergent, 32.5 fl oz"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Nature's Miracle Pet Stain Remover, 32 fl oz"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Whink Rust Stain Remover, 10 fl oz"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Resolve Upholstery & Fabric Stain Remover, 22 fl oz"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title: "Clorox Splash-Less Bleach, 40 fl oz, 25 Loads"
      })
    ).toBe("laundry:bleach");
    expect(
      comparisonFamilyKey({
        title: "Laundry Detergent Pods Storage Containers, 2 Count"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title:
          "Xtra Tropical Passion Liquid Laundry Detergent with Fabric Softener, 67.5 fl oz"
      })
    ).toBe("laundry:detergent-liquid");
    expect(
      comparisonFamilyKey({
        title:
          "Tide Liquid Laundry Detergent, 92 fl oz + Bounce Dryer Sheets, 60 Count"
      })
    ).toBe("general");
    expect(
      comparisonFamilyKey({
        title:
          "Tide Liquid Laundry Detergent, 92 fl oz + Downy Fabric Softener, 48 fl oz"
      })
    ).toBe("general");
  });

  it("marks only exact minima in groups of at least three", () => {
    const grid = document.createElement("section");
    document.body.append(grid);
    const products = [
      product("high", "mass:lb", 45, grid),
      product("low", "mass:lb", 20, grid),
      product("middle", "mass:lb", 30, grid),
      product("unpaired", "volume:fl_oz", 5, grid)
    ];

    expect([...findLowestProductIds(products)]).toEqual(["low"]);
  });

  it("does not compare minima across separate product collections", () => {
    const primary = document.createElement("section");
    const secondary = document.createElement("section");
    document.body.append(primary, secondary);
    const products = [
      product("primary-high", "mass:lb", 45, primary),
      product("primary-low", "mass:lb", 20, primary),
      product("primary-middle", "mass:lb", 30, primary),
      product("secondary-low", "mass:lb", 1, secondary),
      product("secondary-high", "mass:lb", 60, secondary)
    ];

    expect([...findLowestProductIds(products)]).toEqual(["primary-low"]);
  });

  it("keeps equally measured laundry products in purpose-specific Lowest cohorts", () => {
    const grid = document.createElement("section");
    document.body.append(grid);
    const products = [
      product("Purex liquid laundry detergent, 150 fl oz", "volume:fl_oz", 6, grid),
      product("Gain liquid laundry detergent, 39 fl oz", "volume:fl_oz", 12.7, grid),
      product("Tide liquid laundry detergent, 34 fl oz", "volume:fl_oz", 14.6, grid),
      product("Shout laundry stain remover, 60 fl oz", "volume:fl_oz", 9.97, grid),
      product("Clorox laundry odor remover, 42 fl oz", "volume:fl_oz", 16.6, grid),
      product("all liquid fabric softener, 34 fl oz", "volume:fl_oz", 11, grid)
    ];

    expect([...buildLowestSignals(products)]).toEqual([
      ["Purex liquid laundry detergent, 150 fl oz", 3]
    ]);
  });

  it("suppresses only retailer values that already match the target basis and display", () => {
    const matching = product("matching", "mass:lb", 22.9);
    matching.nativeUnitPrice = {
      centsPerUnit: 22.9,
      unit: "lb",
      dimension: "mass",
      sourceText: "22.9 ¢/lb",
      index: 0
    };

    const converted = product("converted", "mass:lb", 22.4);
    converted.nativeUnitPrice = {
      centsPerUnit: 1.4,
      unit: "oz",
      dimension: "mass",
      sourceText: "1.4 ¢/oz",
      index: 0
    };

    expect(isMatchingNativeUnitPrice(matching)).toBe(true);
    expect(isMatchingNativeUnitPrice(converted)).toBe(false);
  });

  it("suppresses an ounce rate corrected to fluid ounces by package evidence", () => {
    const corrected = product("all Baby Liquid Laundry Detergent, 73 oz", "volume:fl_oz", 16.4);
    corrected.nativeUnitPrice = {
      centsPerUnit: 16.4,
      unit: "oz",
      dimension: "mass",
      sourceText: "16.4 ¢/oz",
      index: 0
    };
    corrected.packageQuantity = {
      value: 73,
      unit: "fl_oz",
      dimension: "volume",
      sourceText: "73 oz",
      index: 35,
      rank: 2
    };

    expect(isMatchingNativeUnitPrice(corrected)).toBe(true);
  });

  it("expands compact prices for assistive technology", () => {
    expect(formatAccessibleUnitPrice(33.6, "lb")).toBe("33.6 cents per pound");
    expect(formatAccessibleUnitPrice(103, "lb")).toBe("1 dollar and 3 cents per pound");
  });
});

function product(
  id: string,
  compareKey: "mass:lb" | "volume:fl_oz",
  centsPerUnit: number,
  parent = document.body
): DomProduct {
  const element = document.createElement("article");
  parent.append(element);

  const mass = compareKey === "mass:lb";
  const normalized: NormalizedPrice = {
    centsPerUnit,
    unit: mass ? "lb" : "fl_oz",
    dimension: mass ? "mass" : "volume",
    display: mass ? `${centsPerUnit}¢/lb` : `${centsPerUnit}¢/fl oz`,
    compareKey,
    explanation: "test",
    warnings: [],
    evidence: []
  };

  return {
    id,
    site: "test",
    pageType: "search",
    title: id,
    evidence: [],
    normalized,
    element,
    insertionTarget: element
  };
}
