import {
  createSyntheticPage,
  SYNTHETIC_GENERATOR_VERSION,
  syntheticStructuralFamily
} from "../../scripts/synthetic-training-lib";
import pointerDatasetCard from "../../benchmarks/synthetic-training/pointer-dataset-card.json";

describe("synthetic training corpus", () => {
  it("is deterministic and includes comparable and abstention examples", () => {
    const options = {
      seed: 20260724,
      domainIndex: 0,
      pageIndex: 0,
      productsPerPage: 14,
      siteId: "synthetic-shop-01"
    };
    const first = createSyntheticPage(options);
    const second = createSyntheticPage(options);

    expect(SYNTHETIC_GENERATOR_VERSION).toBe(2);
    expect(first).toEqual(second);
    expect(first.products).toHaveLength(14);
    expect(first.products.filter((product) => product.comparable)).toHaveLength(11);
    expect(first.products.filter((product) => product.abstainReason)).toHaveLength(3);
    expect(first.html).toContain('data-synth-card="p0"');
    expect(first.html).toContain("Seasonal savings");
  });

  it("labels challenge presentations and produces structural fingerprints", () => {
    const pages = Array.from({ length: 16 }, (_, domainIndex) =>
      createSyntheticPage({
        seed: 20260724,
        domainIndex,
        pageIndex: domainIndex % 5,
        productsPerPage: 20,
        siteId: `synthetic-shop-${domainIndex + 1}`
      })
    );
    const tags = new Set(
      pages.flatMap((page) =>
        page.products.flatMap((product) => product.challengeTags ?? [])
      )
    );
    const families = new Set(
      pages.flatMap((page) =>
        page.products.map((product) =>
          syntheticStructuralFamily(page.layout, product)
        )
      )
    );

    expect(tags).toEqual(
      new Set([
        "multipack",
        "split-price",
        "sale-vs-list",
        "decimal-quantity",
        "sponsored-or-recommendation",
        "conditional-price",
        "price-range",
        "unselected-variant",
        "unsupported-currency",
        "native-derived-conflict"
      ])
    );
    expect(families.size).toBeGreaterThan(100);
  });

  it("varies layout and quantity dimensions without known retailer names", () => {
    const pages = Array.from({ length: 8 }, (_, domainIndex) =>
      createSyntheticPage({
        seed: 20260724,
        domainIndex,
        pageIndex: 0,
        productsPerPage: 14,
        siteId: `synthetic-shop-${domainIndex + 1}`
      })
    );
    const dimensions = new Set(
      pages.flatMap((page) =>
        page.products.flatMap((product) =>
          product.quantity ? [product.quantity.dimension] : []
        )
      )
    );

    expect(new Set(pages.map((page) => page.layout)).size).toBe(8);
    expect(dimensions).toEqual(new Set(["mass", "volume", "count", "area", "length"]));
    expect(pages.map((page) => page.html).join(" ")).not.toMatch(
      /\b(?:amazon|walmart|target|costco)\b/i
    );
  });

  it("records a pointer corpus that clears every synthetic dataset gate", () => {
    expect(pointerDatasetCard).toMatchObject({
      generatorVersion: 2,
      targetFormat: "evidence-pointer",
      products: { total: 20_000 },
      validation: {
        pointerRecords: 20_000,
        invalidPointers: 0,
        passed: true
      }
    });
    expect(pointerDatasetCard.structuralFamilies).toBeGreaterThanOrEqual(
      pointerDatasetCard.validation.minimumStructuralFamilies
    );
    expect(
      Object.values(pointerDatasetCard.challengeTags).every(
        (count) =>
          count >= pointerDatasetCard.validation.minimumExamplesPerRarePattern
      )
    ).toBe(true);
  });
});
