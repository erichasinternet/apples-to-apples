import type { NormalizedPrice } from "../../src/core/types";
import {
  buildComparisonGroups,
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
