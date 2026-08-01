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
  `(\\d+(?:\\.\\d+)?)\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:-\\s*)?(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);

const WIDTH_BY_LENGTH_REGEX = new RegExp(
  `\\d+(?:\\.\\d+)?\\s*(?:"|inches?|in\\.?)\\s*(?:x|×|by)\\s*(\\d+(?:\\.\\d+)?)\\s*(ft|feet|foot|yd\\.?|yards?)(?=\\b|\\W)`,
  "gi"
);

const PACK_OF_COUNT_REGEX = new RegExp(
  `(\\d+)\\s*(?:pack|pk)\\s+of\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);

const QUANTITY_REGEX = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(?:-\\s*)?(${UNIT_SOURCE})(?=\\b|\\W)`,
  "gi"
);
const CASE_COUNT_REGEX = /\b(\d{2,6})\s*\/\s*(?:cs|case|pk|pack)\b/gi;
const FACTORED_QUANTITY_PATTERNS = [
  new RegExp(
    `(\\d{1,3})\\s*(?:x|×)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:-\\s*)?(${UNIT_SOURCE})(?=\\b|\\W)`,
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
    const immediatePrefix = lower.slice(Math.max(0, value.index - 8), value.index);
    let score = 0;

    if (/current price|now|sale|price/.test(context)) {
      score += 3;
    }

    if (/was|list price|reg\.|regular|save/.test(context)) {
      score -= 3;
    }

    if (/\b1\s*\/\s*$/.test(immediatePrefix)) {
      score += 8;
    } else if (/\b(?:[2-9]|\d{2,})\s*\/\s*$/.test(immediatePrefix)) {
      score -= 4;
    }

    return { value, score };
  });

  return scored.sort((left, right) => right.score - left.score || left.value.index - right.value.index)[0]?.value;
}

export function specializePackageQuantity(
  title: string,
  quantity: Quantity
): Quantity {
  if (
    quantity.unit === "oz" &&
    /\b(?:liquid|soap|shampoo|conditioner|body\s+wash|oil|juice|beverage|drink)\b/i.test(
      title
    )
  ) {
    return { ...quantity, unit: "fl_oz", dimension: "volume" };
  }

  if (
    quantity.unit === "each" &&
    quantity.value >= 25 &&
    /\b(?:paper\s+towels?|toilet\s+paper|bath(?:room)?\s+tissue|facial\s+tissues?)\b/i.test(
      title
    )
  ) {
    return { ...quantity, unit: "sheet", dimension: "count" };
  }

  if (
    quantity.unit === "each" &&
    quantity.value > 1 &&
    looksLikeSizedBagOrLiner(title)
  ) {
    return { ...quantity, unit: "bag", dimension: "count" };
  }

  return quantity;
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
      centsPerUnit: roundUnitPrice(dollarAmount ? amount * 100 : amount),
      unit: unit.unit,
      dimension: unit.dimension,
      sourceText: match[0],
      index: match.index ?? 0
    });
  }

  return prices;
}

function roundUnitPrice(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
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

    if (
      !definition ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > 100_000 ||
      (definition.unit === "each" &&
        value >= 10_000 &&
        /^\d{5,}(?:ct\.?|count|each|ea)$/i.test(sourceText))
    ) {
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

  for (const match of text.matchAll(WIDTH_BY_LENGTH_REGEX)) {
    const amount = Number.parseFloat(match[1] ?? "");
    const rawUnit = match[2] ?? "";
    const index = match.index ?? 0;
    addQuantity(amount, rawUnit, match[0], index, 3);
    consumedRanges.push([index, index + match[0].length]);
  }

  for (const match of text.matchAll(CASE_COUNT_REGEX)) {
    const value = Number.parseFloat(match[1] ?? "");
    const index = match.index ?? 0;
    addQuantity(value, "each", match[0], index, 2);
    consumedRanges.push([index, index + match[0].length]);
  }

  for (const match of text.matchAll(QUANTITY_REGEX)) {
    const index = match.index ?? 0;

    if (
      isConsumed(index, consumedRanges) ||
      /[A-Za-z0-9]/.test(text[index - 1] ?? "") ||
      looksLikeUnitPriceContext(text, index) ||
      looksLikeMoneyContext(text, index)
    ) {
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
    /\b(?:case|carton|box)\s+of\s+(\d{1,3})\b/i,
    /\b(\d{1,3})\s+per\s+(?:case|carton|box)\b/i,
    /\b(\d{1,3})\s+(?:rolls?|reams?|packs?|bags?|bottles?)\s*\/\s*(?:case|carton|box)\b/i,
    /\b(\d{1,3})\s+(?:cartons?|cases?)\b/i,
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

export function isLikelyPackageQuantity(
  title: string,
  quantity: Pick<Quantity, "dimension"> &
    Partial<Pick<Quantity, "sourceText" | "unit" | "value">>
): boolean {
  return packageQuantityRejectionReason(title, quantity) === undefined;
}

export type PackageQuantityRejectionReason =
  | "physical-dimension-as-quantity"
  | "equipment-capacity-as-quantity"
  | "material-weight-as-quantity"
  | "container-capacity-as-quantity"
  | "container-size-as-quantity"
  | "style-descriptor-as-quantity"
  | "ambiguous-paper-roll-as-unit"
  | "single-each-as-unit"
  | "durable-each-as-unit";

export function packageQuantityRejectionReason(
  title: string,
  quantity: Pick<Quantity, "dimension"> &
    Partial<Pick<Quantity, "sourceText" | "unit" | "value">>
): PackageQuantityRejectionReason | undefined {
  if (quantity.dimension === "length") {
    if (looksLikeDiscreteLengthSpecification(title)) {
      return "physical-dimension-as-quantity";
    }
    if (looksLikeSizedBagOrLiner(title)) {
      return "physical-dimension-as-quantity";
    }
    if (
      quantity.sourceText &&
      new RegExp(
        `${escapeRegex(quantity.sourceText)}\\s*(?:wide|width)\\b`,
        "i"
      ).test(title)
    ) {
      return "physical-dimension-as-quantity";
    }
    return looksLikeProductSoldByLength(title)
      ? undefined
      : "physical-dimension-as-quantity";
  }

  if (
    quantity.dimension === "mass" &&
    looksLikeMaterialWeightSpecification(title)
  ) {
    return "material-weight-as-quantity";
  }


  if (
    quantity.dimension === "mass" &&
    looksLikeGaugeOrItemWeightSpecification(title, quantity)
  ) {
    return "equipment-capacity-as-quantity";
  }

  if (
    quantity.dimension === "volume" &&
    looksLikeContainerCapacitySpecification(title)
  ) {
    return "container-capacity-as-quantity";
  }

  if (
    (quantity.dimension === "mass" || quantity.dimension === "volume") &&
    looksLikeEmptyContainerOrDispenser(title)
  ) {
    return "container-size-as-quantity";
  }

  if (
    quantity.dimension === "count" &&
    (quantity.unit === "each" || quantity.unit === "roll") &&
    /\b(?:paper\s+towels?|toilet\s+paper|bath(?:room)?\s+tissue)\b/i.test(title)
  ) {
    return "ambiguous-paper-roll-as-unit";
  }

  if (
    quantity.dimension === "count" &&
    quantity.unit === "each" &&
    looksLikeStylePieceDescriptor(title, quantity)
  ) {
    return "style-descriptor-as-quantity";
  }

  if (
    quantity.dimension === "count" &&
    quantity.unit === "each" &&
    (quantity.value ?? 1) <= 1
  ) {
    return "single-each-as-unit";
  }

  if (
    quantity.dimension === "count" &&
    quantity.unit === "each" &&
    (looksLikeDiscreteDurableProduct(title) ||
      (looksLikeEmptyContainerOrDispenser(title) &&
        (quantity.value ?? 1) <= 1) ||
      (looksLikeSizedBagOrLiner(title) && (quantity.value ?? 1) <= 1))
  ) {
    return "durable-each-as-unit";
  }

  if (
    (quantity.dimension === "mass" || quantity.dimension === "volume") &&
    (looksLikeDurableEquipment(title) || looksLikeEquipmentCapacity(title))
  ) {
    return "equipment-capacity-as-quantity";
  }

  return undefined;
}

function looksLikeDiscreteLengthSpecification(title: string): boolean {
  if (/\b(?:notebooks?|journals?|planners?|couplers?|cuffs?|vacuum\s+heads?)\b/i.test(title)) {
    return true;
  }
  return (
    looksLikeDurableEquipment(title) &&
    !/\b(?:cable|wire|hose|tubing)\b/i.test(title)
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function looksLikeProductSoldByLength(title: string): boolean {
  if (
    /\b(?:pans?|containers?|lids?|pieces?|sheets?)\b/i.test(title) &&
    !/\brolls?\b/i.test(title)
  ) {
    return false;
  }
  return /\b(?:foil|wrap|rope|cord|cable|wire|tape|ribbon|webbing|thread|yarn|fabric|textile|cotton|linen|flannel|terry\s+cloth|canvas|denim|fleece|polyester|spandex|silk|chain|hose|tubing|film|paper|sheeting)\b/i.test(
    title
  );
}

function looksLikeStylePieceDescriptor(
  title: string,
  quantity: Pick<Quantity, "dimension"> &
    Partial<Pick<Quantity, "sourceText" | "unit" | "value">>
): boolean {
  return (
    (quantity.value ?? 0) <= 2 &&
    /\b[12]\s*-\s*pieces?\b/i.test(quantity.sourceText ?? "") &&
    /\b(?:ostomy|urostomy|colostomy|pouches?)\b/i.test(title)
  );
}

function looksLikeMaterialWeightSpecification(title: string): boolean {
  if (
    /\b(?:paper|notebooks?|journals?)\b/i.test(title) &&
    /\bbasis\s+weight\b/i.test(title)
  ) {
    return true;
  }
  const material =
    /\b(?:fabric|textile|cotton|linen|flannel|terry\s+cloth|canvas|denim|fleece|polyester|spandex|silk)\b/i.test(
      title
    );
  const specification =
    /\b(?:gsm|grams?\s+per\s+square|oz\s*\/\s*yd|ounces?\s+per\s+yard|\d+(?:\.\d+)?\s*(?:inches?|in\.)\s+wide)\b/i.test(
      title
    ) || /\b\d+(?:\.\d+)?\s*oz\b.*\b(?:inches?|gsm|yards?|yd\b|per\s+yard|roll)\b/i.test(title);
  return material && specification;
}

function looksLikeContainerCapacitySpecification(title: string): boolean {
  return /\b(?:trash|garbage|waste|lawn\s+and\s+leaf)\s+(?:bags?\b|ba\s*(?:\.{3}|…))|\b(?:trash|garbage|can)\s+liners?\b/i.test(
    title
  );
}

function looksLikeSizedBagOrLiner(title: string): boolean {
  return /\b(?:trash|garbage|waste|can)\s+(?:(?:bags?|liners?)\b|ba\s*(?:\.{3}|…))|\b(?:trash|garbage|waste)\s+can\s+liners?\b/i.test(
    title
  );
}

function looksLikeEmptyContainerOrDispenser(title: string): boolean {
  const strongContainer =
    /\b(?:soap|sanitizer|towel|napkin|glove|cup|bag|foam|lotion|pump)\s+dispensers?\b|\bdispensers?\s+(?:for|with)\b|\b(?:sharps|storage|deli|food|soup|salad|portion|takeout|take\s+out|to-go|hinged|plastic|paper|foam|round|rectangular|tamper-resistant|blender)\s+containers?\b|\blids?\s+for\b[^,;]{0,40}\bcontainers?\b|\b(?:trash|garbage|waste)\s+(?:cans?|bins?)\b|\b(?:empty|replacement)\b[^,;]{0,40}\b(?:bottles?|jars?|buckets?|pails?|containers?)\b/i.test(
      title
    );
  if (strongContainer) return true;

  const packagingContainer =
    /\b(?:pet|hdpe|pp|pla|polypropylene|polyethylene|plastic|glass|kraft|aluminum|tamper-resistant)\b/i.test(
      title
    ) &&
    /\b(?:bottles?|jars?|containers?|cups?|bowls?)\b/i.test(title) &&
    !hasConsumableContents(title);
  if (packagingContainer) return true;

  if (
    /\b(?:bottles?|containers?)\s*(?:&|and|with)\s*(?:sprayers?|caps?|lids?|droppers?|pumps?|atomizers?)\b/i.test(
      title
    ) &&
    !hasConsumableContents(title)
  ) {
    return true;
  }

  const casePackedContainer =
    /\b(?:bottles?|jars?|containers?|cups?|bowls?|lids?)\b/i.test(title) &&
    /\b(?:\d+\s*(?:ct|count|pcs?)|\d+\s*\/\s*(?:cs|case)|per\s+case)\b/i.test(title);
  if (casePackedContainer) return true;

  const bucketOrPail = /\b(?:buckets?|pails?)\b/i.test(title);
  return bucketOrPail && !hasConsumableContents(title);
}

function hasConsumableContents(title: string): boolean {
  return /\b(?:shock|chlorine|cleaner|cleanser|coating|soap|detergent|litter|tidy\s+cats|powder|supplement|protein|coffee|tea|herb|chemical|solution|oil|dressing|tuna|food|rice|flour|degreaser|algaecide|stainfree|beverage|water|juice|milk|drink|saline|alcohol|wax|seasoning|shampoo)\b/i.test(
    title
  );
}

function looksLikeGaugeOrItemWeightSpecification(
  title: string,
  quantity: Pick<Quantity, "dimension"> &
    Partial<Pick<Quantity, "sourceText" | "unit" | "value">>
): boolean {
  if (quantity.unit !== "g") return false;
  if (/\b(?:needles?|lancets?|syringes?)\b/i.test(title)) return true;
  return /\bgloves?\b/i.test(title) && /\b(?:count|case|\d+\s*\/\s*(?:cs|case))\b/i.test(title);
}

function looksLikeDiscreteDurableProduct(title: string): boolean {
  return (
    looksLikeDurableEquipment(title) ||
    /\b(?:soap|sanitizer|towel|napkin|glove|cup|bag|foam|lotion|pump)\s+dispensers?\b/i.test(
      title
    ) ||
    /\b(?:notebooks?|journals?|planners?|holders?|securers?|couplers?|cuffs?|vacuum\s+heads?)\b/i.test(
      title
    )
  );
}

function looksLikeDurableEquipment(title: string): boolean {
  return /\b(?:laptop|notebook|chromebook|desktop\s+computer|computer\s+monitor|monitor|television|smartphone|printer|camera|refrigerator|freezer|washer|dryer|vacuum)\b/i.test(
    title
  );
}

function looksLikeEquipmentCapacity(title: string): boolean {
  const equipment =
    /\b(?:capacity|dredges?|shakers?|sifters?|mixers?|flour bins?|syringes?|measuring cups?|dispensers?|tanks?)\b/i.test(
      title
    );
  const consumable =
    /\b(?:food|flour(?!\s+(?:bin|sifter|shield|dredge))|rice|oil|detergent|cleaner|soap|litter|powder|supplement|protein|coffee|tea|herb|chemical|solution|juice|milk|drink|deodorizer)\b/i.test(
      title
    );
  return equipment && !consumable;
}

function looksLikeUnitPriceContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 12), index).toLowerCase();
  return /(?:\/|per\s+|¢\s*)$/.test(before);
}

function looksLikeMoneyContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 4), index);
  return /[$€£]\s*$/.test(before);
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
