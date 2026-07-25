import { auditExtractionPreannotation } from "../../scripts/extraction-quality-audit-lib";
import type { ExtractionPreannotation } from "../../scripts/extraction-preannotation-lib";

describe("extraction quality audit", () => {
  it("accepts a grounded package-math extraction", () => {
    const audit = auditExtractionPreannotation(
      record({
        currentPrice: {
          cents: 800,
          currency: "USD",
          evidenceNodeIds: ["price"]
        },
        packageQuantity: {
          valuePerPackage: 16,
          packCount: 1,
          unit: "oz",
          dimension: "mass",
          evidenceNodeIds: ["title"]
        }
      })
    );

    expect(audit).toMatchObject({
      eligibleForSilverTraining: true,
      reasons: []
    });
  });

  it("quarantines a physical product dimension used as quantity", () => {
    const audit = auditExtractionPreannotation(
      record(
        {
          title: {
            value: "Hardwood Handle Loop Action Hoe, 54 Inch",
            evidenceNodeIds: ["title"]
          },
          currentPrice: {
            cents: 1999,
            currency: "USD",
            evidenceNodeIds: ["price"]
          },
          packageQuantity: {
            valuePerPackage: 54,
            packCount: 1,
            unit: "in",
            dimension: "length",
            evidenceNodeIds: ["title"]
          }
        },
        "price-and-package"
      )
    );

    expect(audit.reasons).toContain("physical-dimension-as-quantity");
    expect(audit.eligibleForSilverTraining).toBe(false);
  });

  it("keeps consumable length such as foil eligible", () => {
    const audit = auditExtractionPreannotation(
      record(
        {
          title: {
            value: "Commercial Aluminum Foil, 1000 Feet",
            evidenceNodeIds: ["title"]
          },
          currentPrice: {
            cents: 3999,
            currency: "USD",
            evidenceNodeIds: ["price"]
          },
          packageQuantity: {
            valuePerPackage: 1000,
            packCount: 1,
            unit: "ft",
            dimension: "length",
            evidenceNodeIds: ["title"]
          }
        },
        "price-and-package"
      )
    );

    expect(audit.eligibleForSilverTraining).toBe(true);
  });

  it("quarantines image-description titles", () => {
    const audit = auditExtractionPreannotation(
      record({
        title: {
          value: "White plastic container of cat litter with a blue label",
          evidenceNodeIds: ["title"]
        }
      })
    );

    expect(audit.reasons).toContain("image-description-title");
  });
});

function record(
  extraction: Partial<ExtractionPreannotation["extraction"]>,
  method: ExtractionPreannotation["method"] = "price-and-package"
): ExtractionPreannotation {
  return {
    id: "shop--query:card",
    pageId: "shop--query",
    siteId: "shop",
    cardNodeId: "card",
    extraction: {
      cardNodeId: "card",
      title: {
        value: "Bath Salts, 16 oz",
        evidenceNodeIds: ["title"]
      },
      ...extraction
    },
    outcome: extraction.abstainReason ? "abstained" : "comparable",
    method,
    evidenceValidation: { valid: true, issues: [] }
  };
}
