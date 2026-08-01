import { packageQuantityRejectionReason } from "./pricing";
import type { Dimension, NormalizedProduct } from "./types";

export type UnitPriceAuditReason =
  | "non-product-title"
  | "native-physical-dimension"
  | "native-equipment-capacity"
  | "native-material-weight"
  | "native-container-capacity"
  | "native-container-size"
  | "native-style-descriptor"
  | "native-ambiguous-paper-roll"
  | "native-single-each"
  | "native-durable-each"
  | "package-physical-dimension"
  | "package-equipment-capacity"
  | "package-material-weight"
  | "package-container-capacity"
  | "package-container-size"
  | "package-style-descriptor"
  | "package-ambiguous-paper-roll"
  | "package-single-each"
  | "package-durable-each"
  | "implausibly-low-count-price"
  | "target-dimension-mismatch"
  | "normalized-source-missing";

export interface UnitPriceAuditFinding {
  reason: UnitPriceAuditReason;
  severity: "error" | "review" | "info";
  detail: string;
}

export function auditNormalizedProduct(
  product: NormalizedProduct,
  targetDimension?: Dimension
): UnitPriceAuditFinding[] {
  const findings: UnitPriceAuditFinding[] = [];

  if (looksLikeNonProductTitle(product.title)) {
    findings.push({
      reason: "non-product-title",
      severity: "error",
      detail: "The extracted title looks like a control, rating, price, or other non-product text."
    });
  }

  const usesNative = product.normalized?.evidence.some(
    (evidence) => evidence.kind === "native-unit-price"
  );
  const usesPackage = product.normalized?.evidence.some(
    (evidence) => evidence.kind === "current-price"
  );

  if (product.nativeUnitPrice && usesNative) {
    const rejection = packageQuantityRejectionReason(
      product.title,
      product.nativeUnitPrice
    );
    const corroboratedCount =
      product.nativeUnitPrice.unit === "each" &&
      product.packageQuantity?.dimension === "count" &&
      product.packageQuantity.value > 1 &&
      !packageQuantityRejectionReason(product.title, product.packageQuantity);
    if (rejection && !corroboratedCount) {
      findings.push({
        reason: sourceReason("native", rejection),
        severity: "error",
        detail: `The native ${product.nativeUnitPrice.dimension} rate is not semantically applicable to this product title.`
      });
    }
  }

  if (product.packageQuantity && usesPackage) {
    const rejection = packageQuantityRejectionReason(
      product.title,
      product.packageQuantity
    );
    if (rejection) {
      findings.push({
        reason: sourceReason("package", rejection),
        severity: "error",
        detail: `The ${product.packageQuantity.dimension} value looks like a specification rather than package contents.`
      });
    }
  }

  if (
    product.normalized &&
    !product.nativeUnitPrice &&
    !(product.price && product.packageQuantity)
  ) {
    findings.push({
      reason: "normalized-source-missing",
      severity: "error",
      detail: "The normalized result is not backed by a native rate or price-plus-package evidence."
    });
  }

  if (
    product.normalized?.dimension === "count" &&
    product.normalized.centsPerUnit < 0.1
  ) {
    findings.push({
      reason: "implausibly-low-count-price",
      severity: "review",
      detail: "The normalized result is below one tenth of a cent per count and needs review."
    });
  }

  if (
    targetDimension &&
    product.normalized &&
    product.normalized.dimension !== targetDimension
  ) {
    findings.push({
      reason: "target-dimension-mismatch",
      severity: "info",
      detail: `The page targets ${targetDimension}, but this result is ${product.normalized.dimension}.`
    });
  }

  return findings;
}

function sourceReason(
  source: "native" | "package",
  rejection: NonNullable<ReturnType<typeof packageQuantityRejectionReason>>
): UnitPriceAuditReason {
  const suffix =
    rejection === "physical-dimension-as-quantity"
      ? "physical-dimension"
      : rejection === "equipment-capacity-as-quantity"
        ? "equipment-capacity"
        : rejection === "material-weight-as-quantity"
          ? "material-weight"
          : rejection === "container-capacity-as-quantity"
            ? "container-capacity"
            : rejection === "container-size-as-quantity"
              ? "container-size"
              : rejection === "style-descriptor-as-quantity"
                ? "style-descriptor"
                : rejection === "ambiguous-paper-roll-as-unit"
                  ? "ambiguous-paper-roll"
                  : rejection === "single-each-as-unit"
                    ? "single-each"
                    : "durable-each";
  return `${source}-${suffix}`;
}

function looksLikeNonProductTitle(title: string): boolean {
  return (
    title.trim().length < 5 ||
    /^\d+(?:\.\d+)?\s+out\s+of\s+\d+/i.test(title) ||
    /^(?:[$€£]\s*)?\d+(?:[.,]\d+)?\s*(?:¢|cents?)?\s*(?:\/|per\s+)\s*[a-z]/i.test(
      title
    ) ||
    /^(?:add|remove|buy|compare|subscribe|sign in|average rating|reviews?|ratings?|shipping|pickup|delivery|options|quick view)\b/i.test(
      title
    )
  );
}
