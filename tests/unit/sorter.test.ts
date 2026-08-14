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

  it("sorts only within compatible laundry-product families", () => {
    const grid = document.createElement("div");
    const tide = card("Tide detergent");
    const shout = card("Shout stain remover");
    const purex = card("Purex detergent");
    grid.append(tide, shout, purex);
    document.body.append(grid);

    const result = sortByUnitPrice(
      [
        product(tide, "Tide liquid laundry detergent, 34 fl oz", "volume:fl_oz", 14.6),
        product(shout, "Shout laundry stain remover, 60 fl oz", "volume:fl_oz", 9.97),
        product(purex, "Purex liquid laundry detergent, 150 fl oz", "volume:fl_oz", 6)
      ],
      "volume:fl_oz"
    );

    expect(result.state).toBe("sorted");
    expect([...grid.children].map((element) => element.textContent)).toEqual([
      "Purex detergent",
      "Shout stain remover",
      "Tide detergent"
    ]);
  });

  it("does not offer a sort when same-basis products have different purposes", () => {
    const grid = document.createElement("div");
    const detergent = card("Detergent");
    const stainRemover = card("Stain remover");
    grid.append(detergent, stainRemover);
    document.body.append(grid);

    const products = [
      product(detergent, "Purex liquid laundry detergent, 150 fl oz", "volume:fl_oz", 6),
      product(stainRemover, "Shout laundry stain remover, 60 fl oz", "volume:fl_oz", 9.97)
    ];

    expect(canSortByUnitPrice(products, "volume:fl_oz")).toBe(false);
    expect(sortByUnitPrice(products, "volume:fl_oz").state).toBe("unavailable");
  });

  it("chooses the largest actually sortable family cohort by default", () => {
    const grid = document.createElement("div");
    const volumeCards = [
      card("Liquid detergent"),
      card("Stain remover"),
      card("Fabric softener"),
      card("Odor remover")
    ];
    const expensiveLitter = card("Expensive litter");
    const cheapLitter = card("Cheap litter");
    grid.append(...volumeCards, expensiveLitter, cheapLitter);
    document.body.append(grid);

    const result = sortByUnitPrice(
      [
        product(volumeCards[0]!, "Purex liquid laundry detergent, 150 fl oz", "volume:fl_oz", 6),
        product(volumeCards[1]!, "Shout laundry stain remover, 60 fl oz", "volume:fl_oz", 9.97),
        product(volumeCards[2]!, "all liquid fabric softener, 34 fl oz", "volume:fl_oz", 11),
        product(volumeCards[3]!, "Clorox laundry odor remover, 42 fl oz", "volume:fl_oz", 16.6),
        product(expensiveLitter, "Premium Cat Litter, 20 lb", "mass:lb", 70),
        product(cheapLitter, "Budget Cat Litter, 20 lb", "mass:lb", 20)
      ],
      DEFAULT_PREFERENCES
    );

    expect(result).toMatchObject({ state: "sorted", compareKey: "mass:lb" });
    expect([...grid.children].map((element) => element.textContent)).toEqual([
      "Liquid detergent",
      "Stain remover",
      "Fabric softener",
      "Odor remover",
      "Cheap litter",
      "Expensive litter"
    ]);
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
