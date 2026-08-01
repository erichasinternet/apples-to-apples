import {
  isLikelyPackageQuantity,
  packageQuantityRejectionReason
} from "../src/core/pricing";
import { convertQuantityToBase, getUnitDefinition } from "../src/core/units";
import type { ExtractionPreannotation } from "./extraction-preannotation-lib";

export type ExtractionAuditReason =
  | "invalid-evidence"
  | "non-product-title"
  | "image-description-title"
  | "dimension-mismatch"
  | "native-price-math-disagreement"
  | "physical-dimension-as-quantity"
  | "equipment-capacity-as-quantity"
  | "material-weight-as-quantity"
  | "container-capacity-as-quantity"
  | "container-size-as-quantity"
  | "style-descriptor-as-quantity"
  | "ambiguous-paper-roll-as-unit"
  | "single-each-as-unit"
  | "durable-each-as-unit"
  | "ambiguous-decimal-quantity";

export interface ExtractionQualityAudit {
  id: string;
  siteId: string;
  outcome: ExtractionPreannotation["outcome"];
  eligibleForSilverTraining: boolean;
  reasons: ExtractionAuditReason[];
}

export function canPromoteSilverTraining(
  sourceReviewStatus: "adjudicated" | "unreviewed-capture",
  audits: ExtractionQualityAudit[]
): boolean {
  return (
    sourceReviewStatus === "adjudicated" &&
    audits.some((audit) => audit.eligibleForSilverTraining)
  );
}

export function auditExtractionPreannotation(
  preannotation: ExtractionPreannotation
): ExtractionQualityAudit {
  const reasons: ExtractionAuditReason[] = [];
  const extraction = preannotation.extraction;
  const title = extraction.title.value.trim();

  if (!preannotation.evidenceValidation.valid) {
    reasons.push("invalid-evidence");
  }
  if (looksLikeNonProductTitle(title)) {
    reasons.push("non-product-title");
  }
  if (looksLikeImageDescription(title)) {
    reasons.push("image-description-title");
  }

  const native = extraction.nativeUnitPrice;
  const quantity = extraction.packageQuantity;
  const price = extraction.currentPrice;
  if (native && quantity && native.dimension !== quantity.dimension) {
    reasons.push("dimension-mismatch");
  }
  if (
    preannotation.method === "price-and-package" &&
    quantity &&
    !isLikelyPackageQuantity(title, quantity)
  ) {
    const rejection = packageQuantityRejectionReason(title, quantity);
    if (rejection) reasons.push(rejection);
  }
  if (
    quantity &&
    /\b\d{1,4}\s+\d\s*(?:fl\s*oz|oz|lb|kg|g|ml|l)\b/i.test(title)
  ) {
    reasons.push("ambiguous-decimal-quantity");
  }
  if (native && quantity && price && native.dimension === quantity.dimension) {
    const unit = getUnitDefinition(quantity.unit);
    const totalBaseUnits =
      convertQuantityToBase(quantity.valuePerPackage, quantity.unit) *
      quantity.packCount;
    const nativeBaseCents = native.centsPerUnit / getUnitDefinition(native.unit).toBase;
    const expectedPrice = nativeBaseCents * totalBaseUnits;
    const divergence = Math.abs(price.cents - expectedPrice) / expectedPrice;
    if (!Number.isFinite(divergence) || divergence > 0.2 || unit.dimension !== native.dimension) {
      reasons.push("native-price-math-disagreement");
    }
  }

  return {
    id: preannotation.id,
    siteId: preannotation.siteId,
    outcome: preannotation.outcome,
    eligibleForSilverTraining: reasons.length === 0,
    reasons
  };
}

function looksLikeNonProductTitle(title: string): boolean {
  return (
    title.length < 5 ||
    /^\d+(?:\.\d+)?\s+out\s+of\s+\d+/i.test(title) ||
    /^(?:[$€£]\s*)?\d+(?:[.,]\d+)?\s*(?:¢|cents?)?\s*(?:\/|per\s+)\s*[a-z]/i.test(
      title
    ) ||
    /^(?:add|buy|subscribe|sign in|average rating|reviews?|ratings?)\b/i.test(
      title
    )
  );
}

function looksLikeImageDescription(title: string): boolean {
  return /^(?:image|photo|picture)\s+(?:of|shows)\b|^(?:white|black|blue|red|green|clear)\s+(?:plastic\s+)?(?:container|bottle|bag|box)\s+of\b/i.test(
    title
  );
}
