import {
  createSyntheticPage,
  SYNTHETIC_GENERATOR_VERSION
} from "../../scripts/synthetic-training-lib";

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

    expect(SYNTHETIC_GENERATOR_VERSION).toBe(1);
    expect(first).toEqual(second);
    expect(first.products).toHaveLength(14);
    expect(first.products.filter((product) => product.comparable)).toHaveLength(11);
    expect(first.products.filter((product) => product.abstainReason)).toHaveLength(3);
    expect(first.html).toContain('data-synth-card="p0"');
    expect(first.html).toContain("Seasonal savings");
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
});
