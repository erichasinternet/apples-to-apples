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
  const nativeResult = product.nativeUnitPrice
    ? fromNativeUnitPrice(product.nativeUnitPrice, product, preferences)
    : undefined;
  const packageResult =
    product.price && product.packageQuantity
      ? fromPackageMath(product.price.cents, product.packageQuantity, product, preferences)
      : undefined;

  if (!nativeResult && !packageResult) {
    return product;
  }

  if (nativeResult && packageResult) {
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

    return {
      ...product,
      normalized: {
        ...nativeResult,
        warnings: [...nativeResult.warnings, "Visible unit price differs from package math."],
        evidence: [
          ...nativeResult.evidence,
          {
            kind: "warning",
            text: "Visible unit price differs from package math."
          }
        ]
      }
    };
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

  const totalBaseUnits = convertQuantityToBase(quantity.value, quantity.unit);
  if (!Number.isFinite(totalBaseUnits) || totalBaseUnits <= 0) {
    return undefined;
  }

  const target = getUnitDefinition(targetUnit);
  const centsPerUnit = (priceCents / totalBaseUnits) * target.toBase;
  const display = formatUnitPrice(centsPerUnit, targetUnit);
  const explanation = `$${(priceCents / 100).toFixed(2)} / ${trimZeros(String(quantity.value))} ${getUnitLabel(
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
