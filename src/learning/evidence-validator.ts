import { normalizeProduct } from "../core/normalizer";
import { parseQuantities } from "../core/pricing";
import type {
  CanonicalUnit,
  Evidence,
  NativeUnitPrice,
  ProductInput,
  Quantity,
  UserPreferences
} from "../core/types";
import { DEFAULT_PREFERENCES } from "../core/types";
import { getUnitDefinition, getUnitRegexSource } from "../core/units";
import {
  MODEL_EXTRACTION_VERSION,
  type EvidenceIssue,
  type ModelPageExtraction,
  type ModelProductExtraction,
  type ObservedNode,
  type PageObservation,
  type ValidatedPageExtraction,
  type ValidatedProductExtraction
} from "./contracts";

export function validateModelExtraction(
  input: unknown,
  observation: PageObservation,
  preferences: UserPreferences = DEFAULT_PREFERENCES
): ValidatedPageExtraction {
  const schemaIssues = validatePageShape(input, observation.pageId);
  const validShape = isModelPageExtraction(input);
  if (!validShape) {
    schemaIssues.push(issue("invalid-schema", "page", "Model output does not match the extraction contract."));
  }
  if (schemaIssues.length > 0 || !validShape) {
    return {
      valid: false,
      pageId: observation.pageId,
      issues: schemaIssues,
      products: []
    };
  }

  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const children = buildChildren(observation.nodes);
  const seenCards = new Set<string>();
  const pageIssues: EvidenceIssue[] = [];
  const products = input.products.map((product, productIndex) => {
    const issues = validateProduct(product, productIndex, nodeMap, children, seenCards);
    pageIssues.push(...issues);

    if (issues.length > 0) {
      return {
        status: "rejected",
        extraction: product,
        issues
      } satisfies ValidatedProductExtraction;
    }

    if (product.abstainReason) {
      return {
        status: "abstained",
        extraction: product,
        issues: []
      } satisfies ValidatedProductExtraction;
    }

    const normalized = normalizeVerifiedProduct(product, nodeMap, children, preferences);
    if (!normalized) {
      const issue: EvidenceIssue = {
        code: "incomplete-comparison",
        productIndex,
        field: "product",
        message: "The grounded fields do not produce a comparable normalized unit price."
      };
      pageIssues.push(issue);
      return {
        status: "rejected",
        extraction: product,
        issues: [issue]
      } satisfies ValidatedProductExtraction;
    }

    return {
      status: "accepted",
      extraction: product,
      issues: [],
      normalized
    } satisfies ValidatedProductExtraction;
  });

  return {
    valid: pageIssues.length === 0,
    pageId: observation.pageId,
    issues: pageIssues,
    products
  };
}

function validatePageShape(input: unknown, expectedPageId: string): EvidenceIssue[] {
  if (!isRecord(input)) {
    return [issue("invalid-schema", "page", "Model output must be an object.")];
  }

  const issues: EvidenceIssue[] = [];
  if (input.version !== MODEL_EXTRACTION_VERSION) {
    issues.push(issue("invalid-schema", "version", `Expected model extraction version ${MODEL_EXTRACTION_VERSION}.`));
  }
  if (input.pageId !== expectedPageId) {
    issues.push(issue("page-mismatch", "pageId", `Expected pageId ${expectedPageId}.`));
  }
  if (!Array.isArray(input.products)) {
    issues.push(issue("invalid-schema", "products", "products must be an array."));
  }
  return issues;
}

function validateProduct(
  product: ModelProductExtraction,
  productIndex: number,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  children: ReadonlyMap<string, readonly string[]>,
  seenCards: Set<string>
): EvidenceIssue[] {
  const issues: EvidenceIssue[] = [];
  const card = nodeMap.get(product.cardNodeId);
  if (!card) {
    issues.push(productIssue("unknown-card-node", productIndex, "cardNodeId", `Unknown card node ${product.cardNodeId}.`));
    return issues;
  }
  if (seenCards.has(product.cardNodeId)) {
    issues.push(productIssue("duplicate-card", productIndex, "cardNodeId", `Card ${product.cardNodeId} was emitted twice.`));
  }
  seenCards.add(product.cardNodeId);

  validateEvidenceNodes(product.title.evidenceNodeIds, "title", productIndex, product.cardNodeId, nodeMap, issues);
  const titleText = evidenceText(product.title.evidenceNodeIds, nodeMap, children);
  if (!containsNormalized(titleText, product.title.value)) {
    issues.push(productIssue("ungrounded-title", productIndex, "title", "The cited evidence does not contain the emitted title."));
  }

  if (product.abstainReason) {
    if (product.currentPrice || product.nativeUnitPrice || product.packageQuantity) {
      issues.push(
        productIssue(
          "abstention-with-values",
          productIndex,
          "abstainReason",
          "An abstention must not also emit price or quantity values."
        )
      );
    }
    return issues;
  }

  if (product.currentPrice) {
    validateEvidenceNodes(
      product.currentPrice.evidenceNodeIds,
      "currentPrice",
      productIndex,
      product.cardNodeId,
      nodeMap,
      issues
    );
    if (!Number.isInteger(product.currentPrice.cents) || product.currentPrice.cents <= 0) {
      issues.push(productIssue("invalid-value", productIndex, "currentPrice.cents", "Price cents must be a positive integer."));
    } else {
      const text = evidenceText(product.currentPrice.evidenceNodeIds, nodeMap, children);
      if (!moneyCentsInText(text).some((value) => value === product.currentPrice!.cents)) {
        issues.push(
          productIssue("ungrounded-number", productIndex, "currentPrice.cents", "The cited evidence does not contain this price.")
        );
      }
    }
  }

  if (product.nativeUnitPrice) {
    validateEvidenceNodes(
      product.nativeUnitPrice.evidenceNodeIds,
      "nativeUnitPrice",
      productIndex,
      product.cardNodeId,
      nodeMap,
      issues
    );
    validateUnitDimension(
      product.nativeUnitPrice.unit,
      product.nativeUnitPrice.dimension,
      "nativeUnitPrice",
      productIndex,
      issues
    );
    const text = evidenceText(product.nativeUnitPrice.evidenceNodeIds, nodeMap, children);
    if (
      !Number.isFinite(product.nativeUnitPrice.centsPerUnit) ||
      product.nativeUnitPrice.centsPerUnit <= 0 ||
      !unitPriceCentsInText(text, product.nativeUnitPrice.unit).some((value) =>
        approximatelyEqual(value, product.nativeUnitPrice!.centsPerUnit)
      )
    ) {
      issues.push(
        productIssue(
          "ungrounded-number",
          productIndex,
          "nativeUnitPrice.centsPerUnit",
          "The cited evidence does not contain this native unit price."
        )
      );
    }
    if (!unitInText(text, product.nativeUnitPrice.unit)) {
      issues.push(
        productIssue("ungrounded-unit", productIndex, "nativeUnitPrice.unit", "The cited evidence does not contain this unit.")
      );
    }
  }

  if (product.packageQuantity) {
    validateEvidenceNodes(
      product.packageQuantity.evidenceNodeIds,
      "packageQuantity",
      productIndex,
      product.cardNodeId,
      nodeMap,
      issues
    );
    validateUnitDimension(
      product.packageQuantity.unit,
      product.packageQuantity.dimension,
      "packageQuantity",
      productIndex,
      issues
    );
    const text = evidenceText(product.packageQuantity.evidenceNodeIds, nodeMap, children);
    if (
      !Number.isFinite(product.packageQuantity.valuePerPackage) ||
      product.packageQuantity.valuePerPackage <= 0 ||
      !quantityValueInText(
        text,
        product.packageQuantity.valuePerPackage,
        product.packageQuantity.unit
      )
    ) {
      issues.push(
        productIssue(
          "ungrounded-number",
          productIndex,
          "packageQuantity.valuePerPackage",
          "The cited evidence does not contain this package quantity."
        )
      );
    }
    if (
      !Number.isInteger(product.packageQuantity.packCount) ||
      product.packageQuantity.packCount <= 0 ||
      (product.packageQuantity.packCount > 1 &&
        !numbersInText(text).some((value) => value === product.packageQuantity!.packCount))
    ) {
      issues.push(
        productIssue(
          "ungrounded-number",
          productIndex,
          "packageQuantity.packCount",
          "A multipack count must be a positive integer present in the cited evidence."
        )
      );
    }
    if (!unitInText(text, product.packageQuantity.unit)) {
      issues.push(
        productIssue("ungrounded-unit", productIndex, "packageQuantity.unit", "The cited evidence does not contain this unit.")
      );
    }
  }

  if (!product.nativeUnitPrice && !(product.currentPrice && product.packageQuantity)) {
    issues.push(
      productIssue(
        "incomplete-comparison",
        productIndex,
        "product",
        "Emit a native unit price, grounded current price and package quantity, or an abstention."
      )
    );
  }

  return issues;
}

function validateEvidenceNodes(
  nodeIds: readonly string[],
  field: string,
  productIndex: number,
  cardNodeId: string,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  issues: EvidenceIssue[]
): void {
  if (nodeIds.length === 0) {
    issues.push(productIssue("unknown-evidence-node", productIndex, field, "At least one evidence node is required."));
    return;
  }

  for (const nodeId of new Set(nodeIds)) {
    if (!nodeMap.has(nodeId)) {
      issues.push(productIssue("unknown-evidence-node", productIndex, field, `Unknown evidence node ${nodeId}.`));
    } else if (!isWithinCard(nodeId, cardNodeId, nodeMap)) {
      issues.push(
        productIssue("evidence-outside-card", productIndex, field, `Evidence node ${nodeId} is outside card ${cardNodeId}.`)
      );
    }
  }
}

function validateUnitDimension(
  unit: CanonicalUnit,
  dimension: string,
  field: string,
  productIndex: number,
  issues: EvidenceIssue[]
): void {
  try {
    if (getUnitDefinition(unit).dimension !== dimension) {
      issues.push(
        productIssue("invalid-dimension", productIndex, `${field}.dimension`, `${unit} does not belong to ${dimension}.`)
      );
    }
  } catch {
    issues.push(productIssue("ungrounded-unit", productIndex, `${field}.unit`, `Unknown canonical unit ${unit}.`));
  }
}

function normalizeVerifiedProduct(
  product: ModelProductExtraction,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  children: ReadonlyMap<string, readonly string[]>,
  preferences: UserPreferences
) {
  const evidence: Evidence[] = [
    {
      kind: "title",
      text: evidenceText(product.title.evidenceNodeIds, nodeMap, children)
    }
  ];
  const input: ProductInput = {
    id: product.cardNodeId,
    site: "model",
    pageType: "unknown",
    title: product.title.value,
    evidence,
    ...(product.currentPrice
      ? {
          price: {
            cents: product.currentPrice.cents,
            currency: product.currentPrice.currency,
            sourceText: evidenceText(product.currentPrice.evidenceNodeIds, nodeMap, children),
            index: 0
          }
        }
      : {}),
    ...(product.nativeUnitPrice
      ? {
          nativeUnitPrice: {
            centsPerUnit: product.nativeUnitPrice.centsPerUnit,
            unit: product.nativeUnitPrice.unit,
            dimension: product.nativeUnitPrice.dimension,
            sourceText: evidenceText(product.nativeUnitPrice.evidenceNodeIds, nodeMap, children),
            index: 0
          } satisfies NativeUnitPrice
        }
      : {}),
    ...(product.packageQuantity
      ? {
          packageQuantity: {
            value: product.packageQuantity.valuePerPackage * product.packageQuantity.packCount,
            unit: product.packageQuantity.unit,
            dimension: product.packageQuantity.dimension,
            sourceText: evidenceText(product.packageQuantity.evidenceNodeIds, nodeMap, children),
            index: 0,
            rank: 0
          } satisfies Quantity,
          ...(product.packageQuantity.packCount > 1 ? { packCount: product.packageQuantity.packCount } : {})
        }
      : {})
  };

  return normalizeProduct(input, preferences).normalized;
}

function evidenceText(
  nodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, ObservedNode>,
  children: ReadonlyMap<string, readonly string[]>
): string {
  const visited = new Set<string>();
  const parts: string[] = [];

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return;
    if (node.text) parts.push(node.text);
    if (node.accessibleName) parts.push(node.accessibleName);
    if (node.attributes) {
      parts.push(
        ...[
          node.attributes.ariaLabel,
          node.attributes.alt,
          node.attributes.title,
          node.attributes.placeholder
        ].filter((value): value is string => Boolean(value))
      );
    }
    for (const childId of children.get(nodeId) ?? []) {
      visit(childId);
    }
  };

  for (const nodeId of nodeIds) visit(nodeId);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function buildChildren(nodes: readonly ObservedNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const values = children.get(node.parentId) ?? [];
    values.push(node.id);
    children.set(node.parentId, values);
  }
  return children;
}

function isWithinCard(
  nodeId: string,
  cardNodeId: string,
  nodeMap: ReadonlyMap<string, ObservedNode>
): boolean {
  let current: ObservedNode | undefined = nodeMap.get(nodeId);
  while (current) {
    if (current.id === cardNodeId) return true;
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
  }
  return false;
}

function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function numbersInText(text: string): number[] {
  return [...text.matchAll(/(?:^|[^\p{L}\d]|[x×])(\d+(?:[.,]\d+)?)(?=$|[^\p{L}\d])/gu)]
    .map((match) => Number.parseFloat(match[1]!.replace(",", ".")))
    .filter(Number.isFinite);
}

function quantityValueInText(
  text: string,
  value: number,
  unit: CanonicalUnit
): boolean {
  return (
    numbersInText(text).some((candidate) =>
      approximatelyEqual(candidate, value)
    ) ||
    parseQuantities(text).some(
      (candidate) =>
        candidate.unit === unit && approximatelyEqual(candidate.value, value)
    )
  );
}

function moneyCentsInText(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/\$\s*(\d{1,6})(?:[.,](\d{1,2}))?(?![\d.,])/g)) {
    const trailingText = text.slice((match.index ?? 0) + match[0].length);
    if (isDirectUnitPriceSuffix(trailingText)) {
      continue;
    }
    const dollars = Number.parseInt(match[1]!, 10);
    const cents = Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10);
    values.push(dollars * 100 + cents);
  }

  for (const match of text.matchAll(/\$\s*(\d{1,5})\s+(\d{2})(?=\D|$)/g)) {
    const trailingText = text.slice((match.index ?? 0) + match[0].length);
    if (isDirectUnitPriceSuffix(trailingText)) {
      continue;
    }
    values.push(Number.parseInt(match[1]!, 10) * 100 + Number.parseInt(match[2]!, 10));
  }
  return values;
}

function isDirectUnitPriceSuffix(value: string): boolean {
  return new RegExp(
    `^\\s*(?:\\/|per\\b)\\s*(?:${getUnitRegexSource()})(?=$|[^a-z])`,
    "i"
  ).test(value);
}

function unitPriceCentsInText(text: string, unit: CanonicalUnit): number[] {
  const unitSource = unitAliasRegexSource(unit);
  if (!unitSource) return [];
  const centsRegex = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(?:¢|cents?)\\s*(?:[([]\\s*)?(?:\\/|per)\\s*(?:${unitSource})(?=$|[^a-z])`,
    "gi"
  );
  const dollarRegex = new RegExp(
    `\\$\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:[([]\\s*)?(?:\\/|per)\\s*(?:${unitSource})(?=$|[^a-z])`,
    "gi"
  );
  const values = [...text.matchAll(centsRegex)].map((match) =>
    Number.parseFloat(match[1]!.replace(",", "."))
  );
  for (const match of text.matchAll(dollarRegex)) {
    values.push(Number.parseFloat(match[1]!.replace(",", ".")) * 100);
  }
  if (
    values.length === 0 &&
    new RegExp(
      `(?:\\/|\\bper\\s+)\\s*(?:${unitSource})(?=$|[^a-z])`,
      "i"
    ).test(text)
  ) {
    const splitDollarValues = [
      ...text.matchAll(/\$\s*(\d+(?:[.,]\d+)?)/g)
    ].map(
      (match) => Number.parseFloat(match[1]!.replace(",", ".")) * 100
    );
    const splitCentValues = [
      ...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:¢|cents?)/gi)
    ].map((match) => Number.parseFloat(match[1]!.replace(",", ".")));
    const splitValues = [...splitDollarValues, ...splitCentValues].filter(
      Number.isFinite
    );
    if (splitValues.length === 1) {
      values.push(splitValues[0]!);
    }
  }
  return values.filter(Number.isFinite);
}

function unitInText(text: string, unit: CanonicalUnit): boolean {
  const source = unitAliasRegexSource(unit);
  return Boolean(source && new RegExp(`(?:^|[^a-z])(?:${source})(?:$|[^a-z])`, "i").test(text));
}

function unitAliasRegexSource(unit: CanonicalUnit): string | undefined {
  try {
    const definition = getUnitDefinition(unit);
    return [...new Set([definition.unit, definition.label, ...definition.aliases])]
      .sort((left, right) => right.length - left.length)
      .map((alias) => escapeRegex(alias).replace(/\\ /g, "\\s+"))
      .join("|");
  } catch {
    return undefined;
  }
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.001, Math.abs(right) * 0.0001);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isModelPageExtraction(input: unknown): input is ModelPageExtraction {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["version", "pageId", "products"]) ||
    input.version !== MODEL_EXTRACTION_VERSION ||
    typeof input.pageId !== "string" ||
    !Array.isArray(input.products)
  ) {
    return false;
  }
  return input.products.every((product) => {
    if (
      !isRecord(product) ||
      !hasOnlyKeys(product, [
        "cardNodeId",
        "title",
        "currentPrice",
        "nativeUnitPrice",
        "packageQuantity",
        "abstainReason"
      ]) ||
      typeof product.cardNodeId !== "string" ||
      product.cardNodeId.length === 0 ||
      !isGroundedTitle(product.title)
    ) {
      return false;
    }
    return (
      (product.currentPrice === undefined || isGroundedMoney(product.currentPrice)) &&
      (product.nativeUnitPrice === undefined || isGroundedNativeUnitPrice(product.nativeUnitPrice)) &&
      (product.packageQuantity === undefined || isGroundedQuantity(product.packageQuantity)) &&
      (product.abstainReason === undefined ||
        [
          "insufficient-evidence",
          "conditional-price",
          "price-range",
          "unselected-variant",
          "ambiguous-quantity",
          "unsupported-unit",
          "not-a-product"
        ].includes(String(product.abstainReason)))
    );
  });
}

function isGroundedTitle(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["value", "evidenceNodeIds"]) &&
    typeof value.value === "string" &&
    value.value.trim().length > 0 &&
    isNonEmptyStringArray(value.evidenceNodeIds)
  );
}

function isGroundedMoney(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["cents", "currency", "evidenceNodeIds"]) &&
    typeof value.cents === "number" &&
    value.currency === "USD" &&
    isNonEmptyStringArray(value.evidenceNodeIds)
  );
}

function isGroundedNativeUnitPrice(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["centsPerUnit", "unit", "dimension", "evidenceNodeIds"]) &&
    isGroundedUnitValue(value, "centsPerUnit")
  );
}

function isGroundedUnitValue(value: unknown, numericField: string): boolean {
  return (
    isRecord(value) &&
    typeof value[numericField] === "number" &&
    typeof value.unit === "string" &&
    typeof value.dimension === "string" &&
    isNonEmptyStringArray(value.evidenceNodeIds)
  );
}

function isGroundedQuantity(value: unknown): boolean {
  return (
    isGroundedUnitValue(value, "valuePerPackage") &&
    isRecord(value) &&
    hasOnlyKeys(value, ["valuePerPackage", "unit", "dimension", "packCount", "evidenceNodeIds"]) &&
    typeof value.packCount === "number"
  );
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function issue(code: EvidenceIssue["code"], field: string, message: string): EvidenceIssue {
  return { code, field, message };
}

function productIssue(
  code: EvidenceIssue["code"],
  productIndex: number,
  field: string,
  message: string
): EvidenceIssue {
  return { code, productIndex, field, message };
}
