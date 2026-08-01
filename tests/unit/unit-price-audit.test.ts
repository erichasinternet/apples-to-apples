import { auditNormalizedProduct } from "../../src/core/unit-price-audit";
import type { NormalizedProduct } from "../../src/core/types";

describe("unit-price false-positive audit", () => {
  it("flags a laptop screen dimension emitted as unit pricing", () => {
    const findings = auditNormalizedProduct(
      product({ title: "Lenovo Legion 5 15.1 in Gaming Laptop", dimension: "length", unit: "in" }),
      "count"
    );

    expect(findings.map((finding) => finding.reason)).toEqual(
      expect.arrayContaining(["native-physical-dimension", "target-dimension-mismatch"])
    );
  });

  it("does not flag products genuinely sold by length", () => {
    const findings = auditNormalizedProduct(
      product({ title: "Commercial Aluminum Foil, 1000 ft Roll", dimension: "length", unit: "ft" }),
      "length"
    );

    expect(findings).toEqual([]);
  });

  it("treats a page-target mismatch as information rather than a proven error", () => {
    const findings = auditNormalizedProduct(product({}), "volume");

    expect(findings).toEqual([
      expect.objectContaining({ reason: "target-dimension-mismatch", severity: "info" })
    ]);
  });

  it("queues implausibly low count prices for review", () => {
    const value = product({ dimension: "count", unit: "each" });
    value.normalized!.centsPerUnit = 0.04;

    expect(auditNormalizedProduct(value)).toContainEqual(
      expect.objectContaining({
        reason: "implausibly-low-count-price",
        severity: "review"
      })
    );
  });
});

function product(
  overrides: Partial<{ title: string; dimension: "mass" | "volume" | "count" | "area" | "length"; unit: "lb" | "fl_oz" | "each" | "sq_ft" | "ft" | "in" }>
): NormalizedProduct {
  const title = overrides.title ?? "Cat Litter, 20 lb Bag";
  const dimension = overrides.dimension ?? "mass";
  const unit = overrides.unit ?? "lb";
  return {
    id: "product",
    site: "generic",
    pageType: "search",
    title,
    nativeUnitPrice: {
      centsPerUnit: 50,
      unit,
      dimension,
      sourceText: `50 cents/${unit}`,
      index: 0
    },
    evidence: [{ kind: "title", text: title }],
    normalized: {
      centsPerUnit: 50,
      unit,
      dimension,
      display: "50 cents/unit",
      compareKey: `${dimension}:${unit}`,
      explanation: "test",
      warnings: [],
      evidence: [{ kind: "native-unit-price", text: `50 cents/${unit}` }]
    }
  };
}
