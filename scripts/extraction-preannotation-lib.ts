import {
  extractPackCount,
  parseMoneyValues,
  parseNativeUnitPrices,
  parseQuantities,
  selectPackageQuantity
} from "../src/core/pricing";
import {
  convertQuantityToBase,
  getUnitDefinition,
  getUnitRegexSource,
  parseUnit
} from "../src/core/units";
import type { CanonicalUnit, Dimension } from "../src/core/types";
import type {
  ModelAbstentionReason,
  ModelProductExtraction,
  ObservedNode,
  PageObservation
} from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";

export interface ExtractionQueueItem {
  id: string;
  pageId: string;
  siteId: string;
  cardNodeId: string;
  targetDimension?: Dimension;
}

export interface ExtractionPreannotation {
  id: string;
  pageId: string;
  siteId: string;
  cardNodeId: string;
  extraction: ModelProductExtraction;
  outcome: "comparable" | "abstained";
  method:
    | "native-unit-price"
    | "price-and-package"
    | "explicit-abstention";
  evidenceValidation: {
    valid: boolean;
    issues: string[];
  };
}

interface TextCandidate {
  nodeId: string;
  text: string;
  descendantCount: number;
}

interface PriceCandidate extends TextCandidate {
  cents: number;
  score: number;
}

interface NativeUnitCandidate extends TextCandidate {
  centsPerUnit: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  sourceText: string;
  evidenceNodeIds: string[];
}

export function preannotateExtraction(
  item: ExtractionQueueItem,
  observation: PageObservation
): ExtractionPreannotation {
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const card = nodeMap.get(item.cardNodeId);
  if (!card) throw new Error(`${item.id}: card node is missing`);
  const children = buildChildren(observation.nodes);
  const cardNodes = [card, ...collectDescendants(item.cardNodeId, children)];
  const textCandidates = cardNodes
    .map((node) => subtreeTextCandidate(node, children))
    .filter((candidate) => candidate.text);
  const selectedTitle = selectTitle(cardNodes);
  const title = selectedTitle ?? selectFallbackTitle(cardNodes);
  if (!title) {
    throw new Error(`${item.id}: reviewed card has no textual evidence`);
  }
  const fallbackTitle = !selectedTitle;

  const prices = selectPriceCandidates(textCandidates);
  const nativeUnitPrice =
    selectNativeUnitPrice(textCandidates) ??
    selectSplitNativeUnitPrice(
      textCandidates,
      prices,
      item.targetDimension
    );
  const preferredDimension =
    nativeUnitPrice?.dimension ?? item.targetDimension;
  const quantity = selectGroundedQuantity(
    title.text,
    preferredDimension,
    nativeUnitPrice?.unit
  );
  const currentPrice = selectUnambiguousPrice(
    prices,
    nativeUnitPrice,
    quantity
  );

  let extraction: ModelProductExtraction;
  let method: ExtractionPreannotation["method"];
  if (nativeUnitPrice && !fallbackTitle) {
    extraction = {
      cardNodeId: item.cardNodeId,
      title: {
        value: title.text,
        evidenceNodeIds: [title.nodeId]
      },
      ...(currentPrice
        ? {
            currentPrice: {
              cents: currentPrice.cents,
              currency: "USD" as const,
              evidenceNodeIds: [currentPrice.nodeId]
            }
          }
        : {}),
      nativeUnitPrice: {
        centsPerUnit: nativeUnitPrice.centsPerUnit,
        unit: nativeUnitPrice.unit,
        dimension: nativeUnitPrice.dimension,
        evidenceNodeIds: nativeUnitPrice.evidenceNodeIds
      },
      ...(quantity
        ? {
            packageQuantity: {
              valuePerPackage: quantity.valuePerPackage,
              packCount: quantity.packCount,
              unit: quantity.unit,
              dimension: quantity.dimension,
              evidenceNodeIds: [title.nodeId]
            }
          }
        : {})
    };
    method = "native-unit-price";
  } else if (currentPrice && quantity && !fallbackTitle) {
    extraction = {
      cardNodeId: item.cardNodeId,
      title: {
        value: title.text,
        evidenceNodeIds: [title.nodeId]
      },
      currentPrice: {
        cents: currentPrice.cents,
        currency: "USD",
        evidenceNodeIds: [currentPrice.nodeId]
      },
      packageQuantity: {
        valuePerPackage: quantity.valuePerPackage,
        packCount: quantity.packCount,
        unit: quantity.unit,
        dimension: quantity.dimension,
        evidenceNodeIds: [title.nodeId]
      }
    };
    method = "price-and-package";
  } else {
    extraction = {
      cardNodeId: item.cardNodeId,
      title: {
        value: title.text,
        evidenceNodeIds: [title.nodeId]
      },
      abstainReason: fallbackTitle
        ? "not-a-product"
        : abstentionReason(prices, quantity)
    };
    method = "explicit-abstention";
  }

  const validation = validateModelExtraction(
    {
      version: 1,
      pageId: item.pageId,
      products: [extraction]
    },
    observation
  );
  return {
    id: item.id,
    pageId: item.pageId,
    siteId: item.siteId,
    cardNodeId: item.cardNodeId,
    extraction,
    outcome: extraction.abstainReason ? "abstained" : "comparable",
    method,
    evidenceValidation: {
      valid: validation.valid,
      issues: validation.issues.map(
        (issue) => `${issue.code}/${issue.field}: ${issue.message}`
      )
    }
  };
}

function selectTitle(
  nodes: ObservedNode[]
): { nodeId: string; text: string } | undefined {
  const candidates = nodes.flatMap((node) =>
    nodeStrings(node)
      .map((text) => cleanTitle(text))
      .filter((text): text is string => Boolean(text))
      .map((text) => ({
        nodeId: node.id,
        text,
        score: titleScore(node, text)
      }))
  );
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.text.length - left.text.length ||
      left.nodeId.localeCompare(right.nodeId)
  )[0];
}

function selectFallbackTitle(
  nodes: ObservedNode[]
): { nodeId: string; text: string } | undefined {
  return nodes
    .flatMap((node) =>
      nodeStrings(node).map((value) => ({
        nodeId: node.id,
        text: value.replace(/\s+/g, " ").trim()
      }))
    )
    .filter((candidate) => candidate.text.length > 0)
    .sort(
      (left, right) =>
        left.text.length - right.text.length ||
        left.nodeId.localeCompare(right.nodeId)
    )[0];
}

function cleanTitle(value: string): string | undefined {
  const title = value.replace(/\s+/g, " ").trim();
  if (
    title.length < 5 ||
    title.length > 260 ||
    /^(?:add|buy|subscribe|sign in|wish list|shopping lists|decrease|increase|average rating|read \d|sponsored|best seller|cash back|earn \$|current price|you pay)\b/i.test(
      title
    ) ||
    /^(?:[$€£]\s*)?\d+(?:[.,]\d+)?(?:\s*(?:¢|stars?|ratings?))?$/i.test(
      title
    ) ||
    /^(?:[$€£]\s*)?\d+(?:[.,]\d+)?\s*(?:¢|cents?)?\s*(?:\/|per\s+)\s*[a-z]/i.test(
      title
    ) ||
    /^\d+(?:\.\d+)?\s+out\s+of\s+\d+(?:\s+(?:stars?|total|\d+\s+reviews?))*$/i.test(
      title
    ) ||
    /^\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:fl\s*oz|oz|lb|g|kg|ml|l|ct|count|rolls?|sheets?|ft|inches?)$/i.test(
      title
    )
  ) {
    return undefined;
  }
  return title;
}

function titleScore(node: ObservedNode, text: string): number {
  return (
    Number(/^h[1-6]$/i.test(node.tag)) * 120 +
    Number(node.tag === "a") * 90 +
    Number(node.tag === "img" && Boolean(node.attributes?.alt)) * 40 +
    Number(/\b(?:oz|lb|ct|count|pack|roll|sheet|ml|liter|sq\s*ft)\b/i.test(text)) *
      20 +
    Math.min(20, text.split(/\s+/).length)
  );
}

function selectNativeUnitPrice(
  candidates: TextCandidate[]
): NativeUnitCandidate | undefined {
  const values = candidates.flatMap((candidate) =>
    parseNativeUnitPrices(normalizeUnitPriceText(candidate.text))
      .filter((value) => isComparableNativeSource(value.sourceText))
      .map((value) => ({
        ...candidate,
        centsPerUnit: value.centsPerUnit,
        unit: value.unit,
        dimension: value.dimension,
        sourceText: value.sourceText,
        evidenceNodeIds: [candidate.nodeId]
      }))
  );
  return values.sort(
    (left, right) =>
      left.descendantCount - right.descendantCount ||
      nativeUnitPreference(right) - nativeUnitPreference(left) ||
      left.nodeId.localeCompare(right.nodeId)
  )[0];
}

function selectSplitNativeUnitPrice(
  candidates: TextCandidate[],
  prices: PriceCandidate[],
  targetDimension?: Dimension
): NativeUnitCandidate | undefined {
  const eligiblePrices = prices.filter((candidate) => candidate.score >= 0);
  if (
    (targetDimension !== "area" && targetDimension !== "length") ||
    eligiblePrices.length !== 1
  ) {
    return undefined;
  }

  const units = candidates
    .flatMap((candidate) =>
      parsePerUnitLabels(candidate.text).map((unit) => ({
        ...candidate,
        ...unit
      }))
    )
    .filter(
      (candidate) =>
        candidate.dimension === targetDimension &&
        candidate.nodeId !== eligiblePrices[0]!.nodeId
    )
    .sort(
      (left, right) =>
        left.descendantCount - right.descendantCount ||
        left.nodeId.localeCompare(right.nodeId)
    );
  const unit = units[0];
  const price = eligiblePrices[0];
  if (!unit || !price) return undefined;

  return {
    ...unit,
    centsPerUnit: price.cents,
    sourceText: `${price.text} ${unit.sourceText}`,
    evidenceNodeIds: [price.nodeId, unit.nodeId]
  };
}

function parsePerUnitLabels(
  text: string
): Array<{
  unit: CanonicalUnit;
  dimension: Dimension;
  sourceText: string;
}> {
  const pattern = new RegExp(
    `(?:/|\\bper\\s+)\\s*(${getUnitRegexSource()})(?=\\b|\\W)`,
    "gi"
  );
  return [...text.matchAll(pattern)].flatMap((match) => {
    const definition = match[1] ? parseUnit(match[1]) : undefined;
    return definition
      ? [
          {
            unit: definition.unit,
            dimension: definition.dimension,
            sourceText: match[0]
          }
        ]
      : [];
  });
}

function normalizeUnitPriceText(value: string): string {
  return value
    .replace(/\(\s*\/\s*/g, "/")
    .replace(/\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isComparableNativeSource(sourceText: string): boolean {
  return !/(?:\/|\bper\s+)\s*(?:ea|each)\b/i.test(sourceText);
}

function nativeUnitPreference(value: NativeUnitCandidate): number {
  if (value.dimension === "mass" || value.dimension === "volume") return 3;
  if (value.dimension === "area" || value.dimension === "length") return 2;
  return 1;
}

function selectGroundedQuantity(
  title: string,
  preferredDimension?: Dimension,
  preferredUnit?: CanonicalUnit
):
  | {
      valuePerPackage: number;
      packCount: number;
      unit: CanonicalUnit;
      dimension: Dimension;
    }
  | undefined {
  const dimensionalRanges: Array<[number, number]> = [
    ...title.matchAll(
      /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:inch(?:es)?|in\.?)(?=\W|$)/gi
    )
  ].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length
  ]);
  const quantities = parseQuantities(title).filter(
    (quantity) =>
      !/\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?\s*(?:inch(?:es)?|in\.?)(?=\W|$)/i.test(
        quantity.sourceText
      ) &&
      !dimensionalRanges.some(
        ([start, end]) => quantity.index >= start && quantity.index < end
      )
  );
  const exactUnitQuantities = preferredUnit
    ? quantities.filter((quantity) => quantity.unit === preferredUnit)
    : [];
  const dimensionQuantities = preferredDimension
    ? quantities.filter((quantity) => quantity.dimension === preferredDimension)
    : quantities;
  if (preferredDimension && dimensionQuantities.length === 0) {
    return undefined;
  }
  const selected = selectPackageQuantity(
    exactUnitQuantities.length > 0 ? exactUnitQuantities : dimensionQuantities,
    preferredDimension
  );
  if (!selected) return undefined;
  const multiplied = selected.sourceText.match(
    /^(\d+(?:\.\d+)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?)\s+/i
  );
  if (multiplied?.[1] && multiplied[2]) {
    return {
      valuePerPackage: Number.parseFloat(multiplied[2]),
      packCount: Number.parseInt(multiplied[1], 10),
      unit: selected.unit,
      dimension: selected.dimension
    };
  }
  const packCount = extractPackCount(title) ?? 1;
  return {
    valuePerPackage: selected.value,
    packCount,
    unit: selected.unit,
    dimension: selected.dimension
  };
}

function selectPriceCandidates(candidates: TextCandidate[]): PriceCandidate[] {
  const values = candidates.flatMap((candidate) =>
    parseMoneyValues(candidate.text).map((price) => ({
      ...candidate,
      cents: price.cents,
      score: priceContextScore(candidate.text, price.index, price.sourceText)
    }))
  );
  const bestByValue = new Map<number, PriceCandidate>();
  for (const value of values) {
    const prior = bestByValue.get(value.cents);
    if (
      !prior ||
      value.score > prior.score ||
      (value.score === prior.score &&
        value.descendantCount < prior.descendantCount)
    ) {
      bestByValue.set(value.cents, value);
    }
  }
  return [...bestByValue.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.descendantCount - right.descendantCount ||
      left.cents - right.cents
  );
}

function priceContextScore(
  text: string,
  index: number,
  sourceText: string
): number {
  const context = text
    .slice(Math.max(0, index - 40), index + sourceText.length + 50)
    .toLowerCase();
  return (
    Number(/\b(?:current price|now|sale price|you pay)\b/.test(context)) * 8 -
    Number(
      /\b(?:was|list|reg\.?|regular|save|coupon|more buying choices|free delivery|orders? over)\b/.test(
        context
      )
    ) *
      8 -
    Number(/(?:\/|\bper\s+)\s*(?:oz|lb|kg|g|ml|l|ct|count|ea|each|sq\s*ft)\b/.test(context)) *
      10
  );
}

function selectUnambiguousPrice(
  candidates: PriceCandidate[],
  nativeUnitPrice: NativeUnitCandidate | undefined,
  quantity:
    | {
        valuePerPackage: number;
        packCount: number;
        unit: CanonicalUnit;
        dimension: Dimension;
      }
    | undefined
): PriceCandidate | undefined {
  const eligible = candidates.filter((candidate) => candidate.score >= 0);
  if (eligible.length === 0) return undefined;
  if (nativeUnitPrice) {
    if (!quantity || nativeUnitPrice.dimension !== quantity.dimension) {
      return undefined;
    }
    const totalBaseQuantity =
      convertQuantityToBase(quantity.valuePerPackage, quantity.unit) *
      quantity.packCount;
    const sourceUnitSize = getUnitDefinition(nativeUnitPrice.unit).toBase;
    const expected =
      nativeUnitPrice.centsPerUnit *
      (totalBaseQuantity / sourceUnitSize);
    const ranked = eligible
      .map((candidate) => ({
        candidate,
        divergence: Math.abs(candidate.cents - expected) / expected
      }))
      .sort(
        (left, right) =>
          left.divergence - right.divergence ||
          right.candidate.score - left.candidate.score
      );
    if (ranked[0] && ranked[0].divergence <= 0.2) {
      return ranked[0].candidate;
    }
    return undefined;
  }
  if (eligible.length === 1) return eligible[0];
  const [first, second] = eligible;
  if (
    first &&
    second &&
    first.score >= second.score + 8
  ) {
    return first;
  }
  return undefined;
}

function abstentionReason(
  prices: PriceCandidate[],
  quantity: ReturnType<typeof selectGroundedQuantity>
): ModelAbstentionReason {
  if (!quantity) return "ambiguous-quantity";
  if (prices.some((price) => price.score < 0)) return "conditional-price";
  return "insufficient-evidence";
}

function subtreeTextCandidate(
  node: ObservedNode,
  children: Map<string, ObservedNode[]>
): TextCandidate {
  const descendants = collectDescendants(node.id, children);
  const text = [node, ...descendants]
    .flatMap(nodeStrings)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    nodeId: node.id,
    text,
    descendantCount: descendants.length
  };
}

function nodeStrings(node: ObservedNode): string[] {
  return [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title
  ].filter((value): value is string => Boolean(value?.trim()));
}

function buildChildren(nodes: ObservedNode[]): Map<string, ObservedNode[]> {
  const children = new Map<string, ObservedNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const values = children.get(node.parentId) ?? [];
    values.push(node);
    children.set(node.parentId, values);
  }
  return children;
}

function collectDescendants(
  rootId: string,
  children: Map<string, ObservedNode[]>
): ObservedNode[] {
  const descendants: ObservedNode[] = [];
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length > 0) {
    const node = pending.shift()!;
    descendants.push(node);
    pending.push(...(children.get(node.id) ?? []));
  }
  return descendants;
}
