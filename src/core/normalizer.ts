import type {
  CanonicalUnit,
  Evidence,
  NativeUnitPrice,
  NormalizedPrice,
  NormalizedProduct,
  ProductInput,
  Quantity,
  UserPreferences
} from "./types";
import { DEFAULT_PREFERENCES } from "./types";
import { comparisonFamilyKey } from "./comparison-family";
import { isLikelyPackageQuantity } from "./pricing";
import {
  convertPricePerUnit,
  convertQuantityToBase,
  getDefaultUnitForDimension,
  getUnitDefinition,
  getUnitLabel,
  unitsAreComparable
} from "./units";

export function normalizeProduct(
  product: ProductInput,
  preferences: UserPreferences = DEFAULT_PREFERENCES
): NormalizedProduct {
  const effectiveNativeUnitPrice =
    product.nativeUnitPrice?.unit === "oz" &&
    product.packageQuantity?.unit === "fl_oz"
      ? {
          ...product.nativeUnitPrice,
          unit: "fl_oz" as const,
          dimension: "volume" as const
        }
      : product.nativeUnitPrice;
  const nativeResult =
    effectiveNativeUnitPrice &&
    (isLikelyPackageQuantity(product.title, effectiveNativeUnitPrice) ||
      hasCorroboratingMultiCountPackage(product))
    ? fromNativeUnitPrice(effectiveNativeUnitPrice, product, preferences)
    : undefined;
  const packageResult =
    product.price &&
    product.packageQuantity &&
    isLikelyPackageQuantity(product.title, product.packageQuantity)
      ? fromPackageMath(product.price.cents, product.packageQuantity, product, preferences)
      : undefined;

  const hasUnresolvedProductUseMultipack = Boolean(
    product.packageQuantity &&
      packageMultiplier(product, product.packageQuantity) === undefined
  );

  if (
    hasUnresolvedProductUseMultipack &&
    nativeResult &&
    nativeResult.dimension !== "count"
  ) {
    return product;
  }

  if (!nativeResult && !packageResult) {
    return product;
  }

  if (nativeResult && packageResult) {
    if (
      nativeResult.unit === "each" &&
      ((product.packageQuantity?.dimension === "count" &&
        product.packageQuantity.value > 1 &&
        /\b(?:ct\.?|counts?|pieces?|items?)\b/i.test(
          product.packageQuantity.sourceText
        )) ||
        packageResult.dimension !== "count" ||
        packageResult.unit !== "each" ||
        /\/\s*(?:cs|case|pk|pack)\b/i.test(
          product.packageQuantity?.sourceText ?? ""
        ))
    ) {
      return { ...product, normalized: packageResult };
    }

    if (
      product.nativeUnitPrice?.unit === "oz" &&
      product.packageQuantity?.unit === "fl_oz"
    ) {
      if (
        !ratesAgree(
          product.nativeUnitPrice.centsPerUnit,
          packageResult.centsPerUnit
        )
      ) {
        return product;
      }
      return {
        ...product,
        normalized: {
          ...packageResult,
          explanation: `${packageResult.explanation}; retailer unit price omits the fluid marker.`,
          evidence: [
            ...packageResult.evidence,
            {
              kind: "native-unit-price",
              text: product.nativeUnitPrice.sourceText
            }
          ]
        }
      };
    }

    if (
      nativeResult.dimension !== packageResult.dimension &&
      product.packageQuantity?.dimension === "count" &&
      product.packageQuantity.unit !== "each"
    ) {
      return { ...product, normalized: packageResult };
    }

    if (
      nativeResult.dimension !== packageResult.dimension &&
      shouldPreferExplicitLiquidDetergentVolume(product, packageResult)
    ) {
      return { ...product, normalized: packageResult };
    }

    if (nativeResult.dimension !== packageResult.dimension) {
      return { ...product, normalized: nativeResult };
    }

    const divergence = Math.abs(nativeResult.centsPerUnit - packageResult.centsPerUnit) / nativeResult.centsPerUnit;

    if (Number.isFinite(divergence) && divergence <= 0.08) {
      return {
        ...product,
        normalized: {
          ...nativeResult,
          explanation: `${nativeResult.explanation}; package math agrees within ${Math.round(divergence * 100)}%.`,
          evidence: [
            ...nativeResult.evidence,
            {
              kind: "package-size",
              text: packageResult.explanation
            }
          ]
        }
      };
    }

    return product;
  }

  const normalized = nativeResult ?? packageResult;

  if (!normalized) {
    return product;
  }

  return {
    ...product,
    normalized
  };
}

function ratesAgree(left: number, right: number): boolean {
  const divergence = Math.abs(left - right) / left;
  return Number.isFinite(divergence) && divergence <= 0.08;
}

function shouldPreferExplicitLiquidDetergentVolume(
  product: ProductInput,
  packageResult: NormalizedPrice
): boolean {
  return (
    product.packageQuantity?.dimension === "volume" &&
    packageResult.dimension === "volume" &&
    comparisonFamilyKey({
      title: product.title,
      normalized: packageResult
    }) === "laundry:detergent-liquid"
  );
}

function hasCorroboratingMultiCountPackage(product: ProductInput): boolean {
  return Boolean(
    product.nativeUnitPrice?.unit === "each" &&
      product.packageQuantity?.dimension === "count" &&
      product.packageQuantity.value > 1 &&
      isLikelyPackageQuantity(product.title, product.packageQuantity)
  );
}

export function formatUnitPrice(centsPerUnit: number, unit: CanonicalUnit): string {
  const label = getUnitLabel(unit);

  if (centsPerUnit < 100) {
    const rounded = centsPerUnit >= 10 ? centsPerUnit.toFixed(1) : centsPerUnit.toFixed(2);
    return `${trimZeros(rounded)}¢/${label}`;
  }

  return `$${(centsPerUnit / 100).toFixed(2)}/${label}`;
}

function fromNativeUnitPrice(
  nativeUnitPrice: NativeUnitPrice,
  product: ProductInput,
  preferences: UserPreferences
): NormalizedPrice | undefined {
  const targetUnit = selectTargetUnit(nativeUnitPrice.unit, preferences);
  const centsPerUnit = convertPricePerUnit(nativeUnitPrice.centsPerUnit, nativeUnitPrice.unit, targetUnit);

  if (centsPerUnit === undefined) {
    return undefined;
  }

  const display = formatUnitPrice(centsPerUnit, targetUnit);
  const explanation =
    nativeUnitPrice.unit === targetUnit
      ? `Visible unit price ${nativeUnitPrice.sourceText}`
      : `Converted ${nativeUnitPrice.sourceText} to ${getUnitLabel(targetUnit)}`;

  return {
    centsPerUnit,
    unit: targetUnit,
    dimension: nativeUnitPrice.dimension,
    display,
    compareKey: compareKey(nativeUnitPrice.dimension, targetUnit),
    explanation,
    warnings: warningsFor(product, nativeUnitPrice.unit, targetUnit),
    evidence: [
      ...product.evidence,
      {
        kind: "native-unit-price",
        text: nativeUnitPrice.sourceText
      }
    ]
  };
}

function fromPackageMath(
  priceCents: number,
  quantity: Quantity,
  product: ProductInput,
  preferences: UserPreferences
): NormalizedPrice | undefined {
  const targetUnit = selectTargetUnit(quantity.unit, preferences);

  if (!unitsAreComparable(quantity.unit, targetUnit)) {
    return undefined;
  }

  const packCount = packageMultiplier(product, quantity);
  if (packCount === undefined) {
    return undefined;
  }
  const effectiveQuantity = quantity.value * packCount;
  const totalBaseUnits = convertQuantityToBase(effectiveQuantity, quantity.unit);
  if (!Number.isFinite(totalBaseUnits) || totalBaseUnits <= 0) {
    return undefined;
  }

  const target = getUnitDefinition(targetUnit);
  const centsPerUnit = (priceCents / totalBaseUnits) * target.toBase;
  const display = formatUnitPrice(centsPerUnit, targetUnit);
  const explanation = `$${(priceCents / 100).toFixed(2)} / ${trimZeros(String(effectiveQuantity))} ${getUnitLabel(
    quantity.unit
  )}`;

  return {
    centsPerUnit,
    unit: targetUnit,
    dimension: quantity.dimension,
    display,
    compareKey: compareKey(quantity.dimension, targetUnit),
    explanation,
    warnings: warningsFor(product, quantity.unit, targetUnit),
    evidence: [
      ...product.evidence,
      {
        kind: "current-price",
        text: product.price?.sourceText ?? "visible price"
      },
      {
        kind: "package-size",
        text: quantity.sourceText
      }
    ]
  };
}

function packageMultiplier(
  product: ProductInput,
  quantity: Quantity
): number | undefined {
  const packCount = product.packCount ?? 1;
  if (packCount <= 1) return 1;
  if (quantity.dimension === "area") return 1;

  const productUseCount = isProductUseCount(product.title, quantity);
  if (productUseCount) {
    if (hasExplicitTotalCount(product.title, quantity)) return 1;
    if (hasExplicitPerPackCount(product.title, quantity)) return packCount;
  }

  if (
    !productUseCount &&
    quantity.dimension === "count" &&
    quantity.value === packCount
  ) {
    return 1;
  }

  if (
    !productUseCount &&
    quantity.dimension === "count" &&
    [...product.title.matchAll(/\(\s*(\d+(?:\.\d+)?)\s*(?:ct\.?|count)\s*\)/gi)].some(
      (match) => Number.parseFloat(match[1] ?? "") === quantity.value
    )
  ) {
    return 1;
  }

  const sourceIncludesPack =
    new RegExp(`\\b${packCount}\\s*(?:pack|pk)\\b`, "i").test(quantity.sourceText) ||
    new RegExp(`\\b(?:pack|pk)\\s+of\\s+${packCount}\\b`, "i").test(quantity.sourceText) ||
    /\b\d{2,6}\s*\/\s*(?:cs|case|pk|pack)\b/i.test(quantity.sourceText);
  if (sourceIncludesPack) return 1;

  if (productUseCount) return undefined;

  return packCount;
}

function isProductUseCount(title: string, quantity: Quantity): boolean {
  if (quantity.dimension !== "count") return false;
  if (["pod", "tablet", "capsule", "diaper"].includes(quantity.unit)) {
    return true;
  }
  return (
    quantity.unit === "sheet" &&
    /\b(?:laundry\s+detergent|detergent|dryer|dye[-\s]?trapping|color\s+catcher)\s+sheets?\b/i.test(
      title
    )
  );
}

function hasExplicitTotalCount(title: string, quantity: Quantity): boolean {
  const value = escapeRegex(String(quantity.value));
  const unit = semanticCountLabelPattern(quantity.unit);
  const valueAndUnit = `${value}\\s*${unit}`;
  return new RegExp(
    `(?:\\btotal(?:\\s+of)?\\s+${valueAndUnit}\\b|\\b${valueAndUnit}\\s+total\\b|\\b${value}\\s+total\\s+${unit}\\b)`,
    "i"
  ).test(title);
}

function hasExplicitPerPackCount(title: string, quantity: Quantity): boolean {
  const value = escapeRegex(String(quantity.value));
  const unit = semanticCountLabelPattern(quantity.unit);
  return new RegExp(
    `\\b${value}\\s*${unit}\\s*(?:per|in\\s+each)\\s+(?:pack|pk)\\b`,
    "i"
  ).test(title);
}

function semanticCountLabelPattern(unit: CanonicalUnit): string {
  switch (unit) {
    case "pod":
      return "(?:ct\\.?|counts?|pods?|pacs?|flings?)";
    case "tablet":
      return "(?:ct\\.?|counts?|tablets?)";
    case "capsule":
      return "(?:ct\\.?|counts?|capsules?)";
    case "diaper":
      return "(?:ct\\.?|counts?|diapers?)";
    case "sheet":
      return "(?:ct\\.?|counts?|sheets?)";
    default:
      return "(?:ct\\.?|counts?)";
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectTargetUnit(sourceUnit: CanonicalUnit, preferences: UserPreferences): CanonicalUnit {
  const sourceDefinition = getUnitDefinition(sourceUnit);
  const preferred = preferences.preferredUnits[sourceDefinition.dimension] ?? getDefaultUnitForDimension(sourceDefinition.dimension);

  if (unitsAreComparable(sourceUnit, preferred)) {
    return preferred;
  }

  return sourceUnit;
}

function warningsFor(product: ProductInput, sourceUnit: CanonicalUnit, targetUnit: CanonicalUnit): string[] {
  const warnings: string[] = [];

  if (product.packCount && product.packCount > 1) {
    warnings.push(`Multi-pack detected: ${product.packCount} pack.`);
  }

  if (sourceUnit !== targetUnit) {
    warnings.push(`Converted from ${getUnitLabel(sourceUnit)}.`);
  }

  if (/lightweight|concentrated|mega|ultra|double roll/i.test(product.title)) {
    warnings.push("Product terms may affect real-world value beyond unit price.");
  }

  return warnings;
}

function compareKey(dimension: string, unit: CanonicalUnit): string {
  return `${dimension}:${unit}`;
}

function trimZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
