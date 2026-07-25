import type { CanonicalUnit, Dimension, Money, NativeUnitPrice, Quantity } from "./types";
import { getUnitRegexSource, parseUnit } from "./units";

const PRICE_WITH_DECIMAL =
  /\$\s*([0-9]{1,5})\s+([0-9]{2})\b|\$\s*([0-9]{1,5})(?:,([0-9]{3}))*(?:\.([0-9]{2}))?\b/g;

const UNIT_SOURCE = getUnitRegexSource();
const NATIVE_UNIT_PRICE_REGEX = new RegExp(
  `(?:\\$\\s*([0-9]+(?:[.,][0-9]+)?)|([0-9]+(?:[.,][0-9]+)?)\\s*(?:¢|cents?))\\s*(?:[([]\\s*)?(?:/|per\\s+)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);

const QUANTITY_X_REGEX = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);

const PACK_OF_COUNT_REGEX = new RegExp(
  `(\\d+)\\s*(?:pack|pk)\\s+of\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);

const QUANTITY_REGEX = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`, "gi");
const FACTORED_QUANTITY_PATTERNS = [
  new RegExp(
    `(\\d{1,3})\\s*(?:x|×)\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
    "gi"
  ),
  new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)\\s*(?:x|×)\\s*(\\d{1,3})\\s*(?:pack|pk)?\\b`,
    "gi"
  ),
  new RegExp(
    `(\\d{1,3})\\s*(?:pack|pk)\\s+of\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
    "gi"
  )
] as const;

export interface FactoredPackageQuantity {
  valuePerPackage: number;
  packCount: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  sourceText: string;
  index: number;
}

export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseMoneyValues(text: string): Money[] {
  const matches: Money[] = [];

  for (const match of text.matchAll(PRICE_WITH_DECIMAL)) {
    const wholeRaw = match[1] ?? match[3];
    const centsRaw = match[2] ?? match[5] ?? "00";

    if (!wholeRaw) {
      continue;
    }

    const thousands = match[4] ? `${wholeRaw}${match[4]}` : wholeRaw;
    const cents = Number.parseInt(thousands, 10) * 100 + Number.parseInt(centsRaw, 10);

    if (!Number.isFinite(cents) || cents <= 0 || cents > 500_000) {
      continue;
    }

    matches.push({
      cents,
      currency: "USD",
      sourceText: match[0],
      index: match.index ?? 0
    });
  }

  return matches;
}

export function findBestPrice(text: string): Money | undefined {
  const values = parseMoneyValues(text);

  if (values.length === 0) {
    return undefined;
  }

  const lower = text.toLowerCase();
  const scored = values.map((value) => {
    const context = lower.slice(Math.max(0, value.index - 28), value.index + value.sourceText.length + 28);
    let score = 0;

    if (/current price|now|sale|price/.test(context)) {
      score += 3;
    }

    if (/was|list price|reg\.|regular|save/.test(context)) {
      score -= 3;
    }

    return { value, score };
  });

  return scored.sort((left, right) => right.score - left.score || left.value.index - right.value.index)[0]?.value;
}

export function parseNativeUnitPrices(text: string): NativeUnitPrice[] {
  const prices: NativeUnitPrice[] = [];

  for (const match of text.matchAll(NATIVE_UNIT_PRICE_REGEX)) {
    const dollarAmount = match[1];
    const centAmount = match[2];
    const rawUnit = match[3];
    const unit = rawUnit ? parseUnit(rawUnit) : undefined;

    if (!unit) {
      continue;
    }

    const amount = Number.parseFloat((dollarAmount ?? centAmount ?? "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    prices.push({
      centsPerUnit: dollarAmount ? amount * 100 : amount,
      unit: unit.unit,
      dimension: unit.dimension,
      sourceText: match[0],
      index: match.index ?? 0
    });
  }

  return prices;
}

export function parseQuantities(text: string): Quantity[] {
  const quantities: Quantity[] = [];
  const consumedRanges: Array<[number, number]> = [];

  const addQuantity = (
    value: number,
    rawUnit: string,
    sourceText: string,
    index: number,
    rank: number
  ) => {
    const definition = parseUnit(rawUnit);

    if (!definition || !Number.isFinite(value) || value <= 0 || value > 100_000) {
      return;
    }

    quantities.push({
      value,
      unit: definition.unit,
      dimension: definition.dimension,
      sourceText,
      index,
      rank
    });
  };

  for (const match of text.matchAll(PACK_OF_COUNT_REGEX)) {
    const packCount = Number.parseFloat(match[1] ?? "");
    const count = Number.parseFloat(match[2] ?? "");
    const rawUnit = match[3] ?? "";
    const index = match.index ?? 0;

    if (Number.isFinite(packCount) && Number.isFinite(count)) {
      addQuantity(packCount * count, rawUnit, match[0], index, 2);
      consumedRanges.push([index, index + match[0].length]);
    }
  }

  for (const match of text.matchAll(QUANTITY_X_REGEX)) {
    const multiplier = Number.parseFloat(match[1] ?? "");
    const amount = Number.parseFloat(match[2] ?? "");
    const rawUnit = match[3] ?? "";
    const index = match.index ?? 0;

    if (Number.isFinite(multiplier) && Number.isFinite(amount)) {
      addQuantity(multiplier * amount, rawUnit, match[0], index, 3);
      consumedRanges.push([index, index + match[0].length]);
    }
  }

  for (const match of text.matchAll(QUANTITY_REGEX)) {
    const index = match.index ?? 0;

    if (isConsumed(index, consumedRanges) || looksLikeUnitPriceContext(text, index)) {
      continue;
    }

    const value = Number.parseFloat(match[1] ?? "");
    const rawUnit = match[2] ?? "";
    addQuantity(value, rawUnit, match[0], index, 2);
  }

  return dedupeQuantities(quantities);
}

export function extractPackCount(text: string): number | undefined {
  const patterns = [
    /\b(\d{1,3})\s*(?:pack|pk)\b/i,
    /\b(?:pack|pk)\s+of\s+(\d{1,3})\b/i,
    /\b(\d{1,3})\s*\/\s*(?:carton|case)\b/i,
    /\btotal\s+qty\s+(\d{1,3})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = Number.parseInt(match?.[1] ?? "", 10);
    if (Number.isFinite(value) && value > 1) {
      return value;
    }
  }
  return undefined;
}

export function parseFactoredPackageQuantities(text: string): FactoredPackageQuantity[] {
  const values: FactoredPackageQuantity[] = [];
  for (const [patternIndex, pattern] of FACTORED_QUANTITY_PATTERNS.entries()) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const reversed = patternIndex === 1;
      const valuePerPackage = Number.parseFloat(match[reversed ? 1 : 2] ?? "");
      const rawUnit = match[reversed ? 2 : 3] ?? "";
      const packCount = Number.parseInt(match[reversed ? 3 : 1] ?? "", 10);
      const definition = parseUnit(rawUnit);
      if (
        !definition ||
        !Number.isFinite(valuePerPackage) ||
        valuePerPackage <= 0 ||
        !Number.isInteger(packCount) ||
        packCount <= 1
      ) {
        continue;
      }
      values.push({
        valuePerPackage,
        packCount,
        unit: definition.unit,
        dimension: definition.dimension,
        sourceText: match[0],
        index: match.index ?? 0
      });
    }
  }
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.valuePerPackage}:${value.packCount}:${value.unit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectPackageQuantity(
  quantities: Quantity[],
  preferredDimension?: Quantity["dimension"]
): Quantity | undefined {
  if (quantities.length === 0) {
    return undefined;
  }

  const candidates = preferredDimension
    ? quantities.filter((quantity) => quantity.dimension === preferredDimension)
    : quantities;

  const pool = candidates.length > 0 ? candidates : quantities;

  return [...pool].sort((left, right) => {
    const dimensionScore = dimensionPreferenceScore(right) - dimensionPreferenceScore(left);
    if (dimensionScore !== 0) {
      return dimensionScore;
    }

    const rankScore = right.rank - left.rank;
    if (rankScore !== 0) {
      return rankScore;
    }

    return right.value - left.value;
  })[0];
}

function dimensionPreferenceScore(quantity: Quantity): number {
  if (quantity.dimension === "mass" || quantity.dimension === "volume" || quantity.dimension === "area") {
    return 3;
  }

  if (quantity.dimension === "length") {
    return 2;
  }

  return 1;
}

function looksLikeUnitPriceContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
  return /(?:\/|per\s+|¢\s*)$/.test(before);
}

function isConsumed(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function dedupeQuantities(quantities: Quantity[]): Quantity[] {
  const seen = new Set<string>();
  const deduped: Quantity[] = [];

  for (const quantity of quantities) {
    const key = `${quantity.value}:${quantity.unit}:${quantity.index}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(quantity);
  }

  return deduped;
}
