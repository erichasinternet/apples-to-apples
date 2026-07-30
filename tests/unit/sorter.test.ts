import { DEFAULT_PREFERENCES, type NormalizedPrice } from "../../src/core/types";
import type { DomProduct } from "../../src/content/extractor";
import {
  canSortByUnitPrice,
  resetUnitPriceSortState,
  sortByUnitPrice,
  toggleUnitPriceSort
} from "../../src/content/sorter";

describe("unit price page sorting", () => {
  beforeEach(() => {
    resetUnitPriceSortState();
    document.body.innerHTML = "";
  });

  it("sorts comparable products inside their existing slots", () => {
    const grid = document.createElement("div");
    const expensive = card("Expensive litter");
    const detergent = card("Detergent");
    const cheap = card("Cheap litter");

    grid.append(expensive, detergent, cheap);
    document.body.append(grid);

    const products = [
      product(expensive, "Expensive litter", "mass:lb", 70),
      product(detergent, "Detergent", "volume:fl_oz", 12),
      product(cheap, "Cheap litter", "mass:lb", 22.9)
    ];

    const result = toggleUnitPriceSort(products, DEFAULT_PREFERENCES);

    expect(result.state).toBe("sorted");
    expect([...grid.children].map((element) => element.textContent)).toEqual([
      "Cheap litter",
      "Detergent",
      "Expensive litter"
    ]);
  });

  it("restores retailer order after sorting", () => {
    const grid = document.createElement("div");
    const expensive = card("Expensive litter");
    const cheap = card("Cheap litter");
    grid.append(expensive, cheap);
    document.body.append(grid);

    const products = [
      product(expensive, "Expensive litter", "mass:lb", 70),
      product(cheap, "Cheap litter", "mass:lb", 22.9)
    ];

    toggleUnitPriceSort(products, DEFAULT_PREFERENCES);
    const result = toggleUnitPriceSort(products, DEFAULT_PREFERENCES);

    expect(result.state).toBe("restored");
    expect([...grid.children].map((element) => element.textContent)).toEqual(["Expensive litter", "Cheap litter"]);
  });

  it("sorts when detected product elements are nested inside sibling wrappers", () => {
    const grid = document.createElement("div");
    const expensiveWrapper = document.createElement("section");
    const cheapWrapper = document.createElement("section");
    const expensive = card("Expensive litter");
    const cheap = card("Cheap litter");

    expensiveWrapper.append(expensive);
    cheapWrapper.append(cheap);
    grid.append(expensiveWrapper, cheapWrapper);
    document.body.append(grid);

    const result = toggleUnitPriceSort(
      [product(expensive, "Expensive litter", "mass:lb", 70), product(cheap, "Cheap litter", "mass:lb", 22.9)],
      DEFAULT_PREFERENCES
    );

    expect(result.state).toBe("sorted");
    expect([...grid.children].map((element) => element.textContent)).toEqual(["Cheap litter", "Expensive litter"]);
  });

  it("does not sort when there is no comparable group", () => {
    const grid = document.createElement("div");
    const litter = card("Litter");
    const detergent = card("Detergent");
    grid.append(litter, detergent);
    document.body.append(grid);

    const result = toggleUnitPriceSort(
      [product(litter, "Litter", "mass:lb", 22.9), product(detergent, "Detergent", "volume:fl_oz", 12)],
      DEFAULT_PREFERENCES
    );

    expect(result.state).toBe("unavailable");
    expect([...grid.children].map((element) => element.textContent)).toEqual(["Litter", "Detergent"]);
  });

  it("rejects document-level reordering even when values are comparable", () => {
    const expensive = card("Expensive litter");
    const cheap = card("Cheap litter");
    document.body.append(expensive, cheap);
    const products = [
      product(expensive, "Expensive litter", "mass:lb", 70),
      product(cheap, "Cheap litter", "mass:lb", 22.9)
    ];

    expect(canSortByUnitPrice(products, "mass:lb")).toBe(false);
    expect(sortByUnitPrice(products, "mass:lb").state).toBe("unavailable");
    expect([...document.body.children].map((element) => element.textContent)).toEqual([
      "Expensive litter",
      "Cheap litter"
    ]);
  });

  it("discards stale sort state after a retailer replaces the product grid", () => {
    const firstGrid = document.createElement("div");
    const firstExpensive = card("First expensive");
    const firstCheap = card("First cheap");
    firstGrid.append(firstExpensive, firstCheap);
    document.body.append(firstGrid);

    sortByUnitPrice(
      [
        product(firstExpensive, "First expensive", "mass:lb", 70),
        product(firstCheap, "First cheap", "mass:lb", 20)
      ],
      DEFAULT_PREFERENCES
    );
    firstGrid.remove();

    const replacementGrid = document.createElement("div");
    const replacementExpensive = card("Replacement expensive");
    const replacementCheap = card("Replacement cheap");
    replacementGrid.append(replacementExpensive, replacementCheap);
    document.body.append(replacementGrid);

    const result = sortByUnitPrice(
      [
        product(replacementExpensive, "Replacement expensive", "mass:lb", 80),
        product(replacementCheap, "Replacement cheap", "mass:lb", 25)
      ],
      DEFAULT_PREFERENCES
    );

    expect(result.state).toBe("sorted");
    expect([...replacementGrid.children].map((element) => element.textContent)).toEqual([
      "Replacement cheap",
      "Replacement expensive"
    ]);
  });
});

function card(title: string): HTMLElement {
  const element = document.createElement("article");
  element.textContent = title;
  return element;
}

function product(element: HTMLElement, title: string, compareKey: string, centsPerUnit: number): DomProduct {
  const normalized: NormalizedPrice = {
    centsPerUnit,
    unit: compareKey.endsWith(":lb") ? "lb" : "fl_oz",
    dimension: compareKey.startsWith("mass") ? "mass" : "volume",
    display: `${centsPerUnit}`,
    compareKey,
    explanation: "test",
    warnings: [],
    evidence: []
  };

  return {
    id: title,
    site: "test",
    pageType: "search",
    title,
    evidence: [],
    normalized,
    element,
    insertionTarget: element
  };
}
