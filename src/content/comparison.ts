import type { CanonicalUnit, Dimension } from "../core/types";
import { comparisonFamilyKey } from "../core/comparison-family";
import { formatUnitPrice } from "../core/normalizer";
import { getUnitLabel } from "../core/units";
import type { DomProduct } from "./extractor";

export interface ComparisonGroup {
  compareKey: string;
  unit: CanonicalUnit;
  dimension: Dimension;
  count: number;
  label: string;
  sortLabel: string;
}

export function buildComparisonGroups(products: DomProduct[], minimumCount = 1): ComparisonGroup[] {
  const groups = new Map<string, ComparisonGroup>();

  for (const product of products) {
    const normalized = product.normalized;
    if (!normalized) {
      continue;
    }

    const existing = groups.get(normalized.compareKey);
    if (existing) {
      existing.count += 1;
      continue;
    }

    const label = `per ${getUnitLabel(normalized.unit)}`;
    groups.set(normalized.compareKey, {
      compareKey: normalized.compareKey,
      unit: normalized.unit,
      dimension: normalized.dimension,
      count: 1,
      label,
      sortLabel: `Unit price ${label}: low to high`
    });
  }

  return [...groups.values()]
    .filter((group) => group.count >= minimumCount)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function findLowestProductIds(products: DomProduct[], minimumCount = 3): Set<string> {
  return new Set(buildLowestSignals(products, minimumCount).keys());
}

export function buildLowestSignals(
  products: DomProduct[],
  minimumCount = 3
): Map<string, number> {
  const signals = new Map<string, number>();
  const byScope = new Map<HTMLElement, Map<string, DomProduct[]>>();

  for (const product of products) {
    if (!product.normalized) {
      continue;
    }

    const scope = findComparisonScope(product, products);
    if (!scope) {
      continue;
    }

    const scopeGroups = byScope.get(scope) ?? new Map<string, DomProduct[]>();
    const cohortKey = `${product.normalized.compareKey}:${comparisonFamilyKey(product)}`;
    const group = scopeGroups.get(cohortKey) ?? [];
    group.push(product);
    scopeGroups.set(cohortKey, group);
    byScope.set(scope, scopeGroups);
  }

  for (const scopeGroups of byScope.values()) {
    for (const group of scopeGroups.values()) {
      if (group.length < minimumCount) {
        continue;
      }

      const minimum = Math.min(...group.map((product) => product.normalized!.centsPerUnit));
      for (const product of group) {
        if (Math.abs(product.normalized!.centsPerUnit - minimum) <= 0.0001) {
          signals.set(product.id, group.length);
        }
      }
    }
  }

  return signals;
}

function findComparisonScope(
  product: DomProduct,
  products: DomProduct[]
): HTMLElement | undefined {
  let current: HTMLElement | null = product.element;

  while (
    current?.parentElement &&
    current.parentElement !== current.ownerDocument.body &&
    current.parentElement !== current.ownerDocument.documentElement
  ) {
    const siblingProductCount = Array.from(current.parentElement.children).filter(
      (sibling) => products.some((candidate) => sibling.contains(candidate.element))
    ).length;

    if (siblingProductCount >= 2) {
      return current.parentElement;
    }

    current = current.parentElement;
  }

  return undefined;
}

export function isMatchingNativeUnitPrice(product: DomProduct): boolean {
  const native = product.nativeUnitPrice;
  const normalized = product.normalized;

  const nativeUnit =
    native?.unit === "oz" && product.packageQuantity?.unit === "fl_oz"
      ? "fl_oz"
      : native?.unit;
  const nativeDimension = nativeUnit === "fl_oz" ? "volume" : native?.dimension;

  return Boolean(
    native &&
      normalized &&
      nativeDimension === normalized.dimension &&
      nativeUnit === normalized.unit &&
      formatUnitPrice(native.centsPerUnit, nativeUnit) === normalized.display
  );
}

export function formatAccessibleUnitPrice(centsPerUnit: number, unit: CanonicalUnit): string {
  const amount =
    centsPerUnit < 100
      ? `${trimDecimal(centsPerUnit)} ${pluralize(centsPerUnit, "cent")}`
      : formatAccessibleDollars(centsPerUnit);

  return `${amount} per ${ACCESSIBLE_UNIT_NAMES[unit]}`;
}

const ACCESSIBLE_UNIT_NAMES: Record<CanonicalUnit, string> = {
  oz: "ounce",
  lb: "pound",
  g: "gram",
  kg: "kilogram",
  fl_oz: "fluid ounce",
  ml: "milliliter",
  l: "liter",
  gal: "gallon",
  qt: "quart",
  pt: "pint",
  cup: "cup",
  each: "item",
  roll: "roll",
  sheet: "sheet",
  load: "load",
  pod: "pod",
  tablet: "tablet",
  capsule: "capsule",
  diaper: "diaper",
  bag: "bag",
  sq_ft: "square foot",
  sq_in: "square inch",
  yd: "yard",
  ft: "foot",
  in: "inch"
};

function formatAccessibleDollars(centsPerUnit: number): string {
  const roundedCents = Math.round(centsPerUnit);
  const dollars = Math.floor(roundedCents / 100);
  const cents = roundedCents % 100;
  const dollarText = `${dollars} ${pluralize(dollars, "dollar")}`;

  return cents === 0 ? dollarText : `${dollarText} and ${cents} ${pluralize(cents, "cent")}`;
}

function trimDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function pluralize(value: number, singular: string): string {
  return Math.abs(value - 1) < 0.0001 ? singular : `${singular}s`;
}
