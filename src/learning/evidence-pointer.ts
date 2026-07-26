import {
  cleanText,
  extractPackCount,
  parseFactoredPackageQuantities,
  parseMoneyValues,
  parseNativeUnitPrices,
  parseQuantities
} from "../core/pricing";
import { getUnitRegexSource, parseUnit } from "../core/units";
import type { CanonicalUnit, Dimension, UserPreferences } from "../core/types";
import { DEFAULT_PREFERENCES } from "../core/types";
import {
  type ModelPageExtraction,
  type ModelProductExtraction,
  type ObservedNode,
  type PageObservation,
  type ValidatedPageExtraction
} from "./contracts";
import { validateModelExtraction } from "./evidence-validator";

export const EVIDENCE_POINTER_VERSION = 1;
export const EVIDENCE_POINTER_FIELDS = [
  "CARD",
  "TITLE",
  "CURRENT_PRICE",
  "NATIVE_UNIT_PRICE",
  "PACKAGE_QUANTITY",
  "PACK_COUNT",
  "STATUS"
] as const;
export const EVIDENCE_POINTER_STATUSES = [
  "comparable",
  "insufficient-evidence",
  "conditional-price",
  "price-range",
  "unselected-variant",
  "ambiguous-quantity",
  "unsupported-unit",
  "not-a-product"
] as const;

type EvidencePointerField = (typeof EVIDENCE_POINTER_FIELDS)[number];
type PointerField = Exclude<EvidencePointerField, "STATUS">;
type CandidateField = Exclude<PointerField, "CARD" | "TITLE">;
export type EvidencePointerStatus = (typeof EVIDENCE_POINTER_STATUSES)[number];
export type EvidenceCandidateKind =
  "current-price" | "native-unit-price" | "package-quantity" | "pack-count";

interface EvidenceCandidateBase {
  id: string;
  kind: EvidenceCandidateKind;
  nodeId: string;
  evidenceNodeIds: string[];
  sourceText: string;
}

export interface CurrentPriceCandidate extends EvidenceCandidateBase {
  kind: "current-price";
  cents: number;
}

export interface NativeUnitPriceCandidate extends EvidenceCandidateBase {
  kind: "native-unit-price";
  centsPerUnit: number;
  unit: CanonicalUnit;
  dimension: Dimension;
}

export interface PackageQuantityCandidate extends EvidenceCandidateBase {
  kind: "package-quantity";
  valuePerPackage: number;
  unit: CanonicalUnit;
  dimension: Dimension;
}

export interface PackCountCandidate extends EvidenceCandidateBase {
  kind: "pack-count";
  packCount: number;
}

export type EvidenceCandidate =
  | CurrentPriceCandidate
  | NativeUnitPriceCandidate
  | PackageQuantityCandidate
  | PackCountCandidate;

export interface EvidencePointerProduct {
  version: typeof EVIDENCE_POINTER_VERSION;
  cardNodeId: string;
  titleNodeIds: string[];
  currentPriceCandidateId?: string;
  nativeUnitPriceCandidateId?: string;
  packageQuantityCandidateId?: string;
  packCountCandidateId?: string;
  status: EvidencePointerStatus;
}

export type EvidencePointerIssueCode =
  | "invalid-output-type"
  | "invalid-line-count"
  | "invalid-field"
  | "invalid-pointer"
  | "duplicate-pointer"
  | "invalid-status"
  | "incompatible-status"
  | "unknown-node"
  | "unknown-candidate"
  | "candidate-kind-mismatch"
  | "evidence-outside-card"
  | "missing-evidence"
  | "ambiguous-evidence"
  | "deterministic-validation";

export interface EvidencePointerIssue {
  code: EvidencePointerIssueCode;
  field: EvidencePointerField | "OUTPUT";
  message: string;
}

export interface ParsedEvidencePointer {
  valid: boolean;
  pointer?: EvidencePointerProduct;
  issues: EvidencePointerIssue[];
}

export interface ResolvedEvidencePointer {
  valid: boolean;
  pointer?: EvidencePointerProduct;
  extraction?: ModelPageExtraction;
  validation?: ValidatedPageExtraction;
  issues: EvidencePointerIssue[];
}

export interface EvidencePointerScore {
  syntaxValid: boolean;
  pointerExact: boolean;
  pointerFieldsCorrect: number;
  pointerFieldsTotal: number;
  evidenceAccepted: boolean;
  targetComparable: boolean;
  acceptedCorrect: boolean;
  acceptedIncorrect: boolean;
  abstentionClassMatch: boolean;
  abstentionReasonMatch: boolean;
  issues: EvidencePointerIssue[];
}

const STATUS_SET = new Set<string>(EVIDENCE_POINTER_STATUSES);
const NODE_TOKEN = /^[A-Za-z0-9._:-]+$/;
const CANDIDATE_TOKEN = /^[A-Za-z0-9._:-]+@[puqk]\d+$/;
const CANDIDATE_KIND_BY_FIELD: Record<CandidateField, EvidenceCandidateKind> = {
  CURRENT_PRICE: "current-price",
  NATIVE_UNIT_PRICE: "native-unit-price",
  PACKAGE_QUANTITY: "package-quantity",
  PACK_COUNT: "pack-count"
};

export function parseEvidencePointer(input: unknown): ParsedEvidencePointer {
  if (typeof input !== "string") {
    return failure(
      "invalid-output-type",
      "OUTPUT",
      "Pointer output must be plain text."
    );
  }
  if (input !== input.trim() || input.includes("\r") || input.includes("```")) {
    return failure(
      "invalid-line-count",
      "OUTPUT",
      "Pointer output must contain only the seven canonical lines."
    );
  }
  const lines = input.split("\n");
  if (lines.length !== EVIDENCE_POINTER_FIELDS.length) {
    return failure(
      "invalid-line-count",
      "OUTPUT",
      `Expected ${EVIDENCE_POINTER_FIELDS.length} lines, received ${lines.length}.`
    );
  }

  const values = new Map<EvidencePointerField, string>();
  const issues: EvidencePointerIssue[] = [];
  for (const [index, line] of lines.entries()) {
    const field = EVIDENCE_POINTER_FIELDS[index]!;
    const prefix = `${field} `;
    if (!line.startsWith(prefix) || line.length === prefix.length) {
      issues.push({
        code: "invalid-field",
        field,
        message: `Line ${index + 1} must begin with ${prefix}.`
      });
    } else {
      values.set(field, line.slice(prefix.length));
    }
  }
  if (issues.length > 0) return { valid: false, issues };

  const cardNodeId = parseSingleNode(values.get("CARD")!, "CARD", issues);
  const titleNodeIds = parseNodeList(values.get("TITLE")!, "TITLE", issues);
  const currentPriceCandidateId = parseCandidate(
    values.get("CURRENT_PRICE")!,
    "CURRENT_PRICE",
    issues
  );
  const nativeUnitPriceCandidateId = parseCandidate(
    values.get("NATIVE_UNIT_PRICE")!,
    "NATIVE_UNIT_PRICE",
    issues
  );
  const packageQuantityCandidateId = parseCandidate(
    values.get("PACKAGE_QUANTITY")!,
    "PACKAGE_QUANTITY",
    issues
  );
  const packCountCandidateId = parseCandidate(
    values.get("PACK_COUNT")!,
    "PACK_COUNT",
    issues
  );
  const rawStatus = values.get("STATUS")!;
  if (!STATUS_SET.has(rawStatus)) {
    issues.push({
      code: "invalid-status",
      field: "STATUS",
      message: `Unknown status ${rawStatus}.`
    });
  }
  if (issues.length > 0 || !cardNodeId) return { valid: false, issues };

  const pointer: EvidencePointerProduct = {
    version: EVIDENCE_POINTER_VERSION,
    cardNodeId,
    titleNodeIds,
    ...(currentPriceCandidateId ? { currentPriceCandidateId } : {}),
    ...(nativeUnitPriceCandidateId ? { nativeUnitPriceCandidateId } : {}),
    ...(packageQuantityCandidateId ? { packageQuantityCandidateId } : {}),
    ...(packCountCandidateId ? { packCountCandidateId } : {}),
    status: rawStatus as EvidencePointerStatus
  };
  validatePointerSemantics(pointer, issues);
  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, pointer, issues: [] };
}

export function enumerateEvidenceCandidates(
  observation: PageObservation,
  cardNodeId: string
): EvidenceCandidate[] {
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const children = buildChildren(observation.nodes);
  if (!nodeMap.has(cardNodeId)) return [];
  const candidates: EvidenceCandidate[] = [];
  for (const node of observation.nodes) {
    if (!isWithinCard(node.id, cardNodeId, nodeMap) || node.id.includes("@"))
      continue;
    const text = evidenceText([node.id], nodeMap, children);
    if (!text) continue;
    addCandidatesForNode(candidates, node.id, text);
  }
  addSplitNativeUnitCandidates(candidates, observation, cardNodeId, nodeMap);
  return candidates;
}

export function serializeEvidenceCandidateCatalog(
  observation: PageObservation,
  cardNodeId: string
): string {
  return JSON.stringify(
    enumerateEvidenceCandidates(observation, cardNodeId).map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      sourceText: candidate.sourceText
    }))
  );
}

export function serializeEvidencePointer(
  product: ModelProductExtraction,
  observation: PageObservation
): string {
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const candidates = enumerateEvidenceCandidates(
    observation,
    product.cardNodeId
  );
  const currentPriceCandidateId = product.currentPrice
    ? selectTargetCandidate(
        candidates,
        "current-price",
        product.currentPrice.evidenceNodeIds,
        nodeMap,
        (candidate) =>
          candidate.kind === "current-price" &&
          candidate.cents === product.currentPrice!.cents
      )
    : undefined;
  const nativeUnitPriceCandidateId = product.nativeUnitPrice
    ? selectTargetCandidate(
        candidates,
        "native-unit-price",
        product.nativeUnitPrice.evidenceNodeIds,
        nodeMap,
        (candidate) =>
          candidate.kind === "native-unit-price" &&
          approximatelyEqual(
            candidate.centsPerUnit,
            product.nativeUnitPrice!.centsPerUnit
          ) &&
          candidate.unit === product.nativeUnitPrice!.unit &&
          candidate.dimension === product.nativeUnitPrice!.dimension
      )
    : undefined;
  const packageQuantityCandidateId = product.packageQuantity
    ? selectTargetCandidate(
        candidates,
        "package-quantity",
        product.packageQuantity.evidenceNodeIds,
        nodeMap,
        (candidate) =>
          candidate.kind === "package-quantity" &&
          approximatelyEqual(
            candidate.valuePerPackage,
            product.packageQuantity!.valuePerPackage
          ) &&
          candidate.unit === product.packageQuantity!.unit &&
          candidate.dimension === product.packageQuantity!.dimension
      )
    : undefined;
  const packCountCandidateId =
    product.packageQuantity && product.packageQuantity.packCount > 1
      ? selectTargetCandidate(
          candidates,
          "pack-count",
          product.packageQuantity.evidenceNodeIds,
          nodeMap,
          (candidate) =>
            candidate.kind === "pack-count" &&
            candidate.packCount === product.packageQuantity!.packCount
        )
      : undefined;
  const status: EvidencePointerStatus = product.abstainReason ?? "comparable";
  return serializeParsedPointer({
    version: EVIDENCE_POINTER_VERSION,
    cardNodeId: product.cardNodeId,
    titleNodeIds: product.title.evidenceNodeIds,
    ...(currentPriceCandidateId ? { currentPriceCandidateId } : {}),
    ...(nativeUnitPriceCandidateId ? { nativeUnitPriceCandidateId } : {}),
    ...(packageQuantityCandidateId ? { packageQuantityCandidateId } : {}),
    ...(packCountCandidateId ? { packCountCandidateId } : {}),
    status
  });
}

export function resolveEvidencePointer(
  input: unknown,
  observation: PageObservation,
  preferences: UserPreferences = DEFAULT_PREFERENCES
): ResolvedEvidencePointer {
  const parsed = parseEvidencePointer(input);
  if (!parsed.valid || !parsed.pointer) return parsed;
  const pointer = parsed.pointer;
  const issues: EvidencePointerIssue[] = [];
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const children = buildChildren(observation.nodes);
  if (!nodeMap.has(pointer.cardNodeId)) {
    return {
      valid: false,
      pointer,
      issues: [
        {
          code: "unknown-node",
          field: "CARD",
          message: `Unknown card node ${pointer.cardNodeId}.`
        }
      ]
    };
  }
  for (const nodeId of pointer.titleNodeIds) {
    validateNodePointer(nodeId, "TITLE", pointer.cardNodeId, nodeMap, issues);
  }
  if (issues.length > 0) return { valid: false, pointer, issues };

  const titleText = evidenceText(pointer.titleNodeIds, nodeMap, children);
  if (!titleText) {
    return {
      valid: false,
      pointer,
      issues: [
        {
          code: "missing-evidence",
          field: "TITLE",
          message: "Title pointers contain no visible text."
        }
      ]
    };
  }

  const candidateMap = new Map(
    enumerateEvidenceCandidates(observation, pointer.cardNodeId).map(
      (candidate) => [candidate.id, candidate]
    )
  );
  const product: ModelProductExtraction = {
    cardNodeId: pointer.cardNodeId,
    title: { value: titleText, evidenceNodeIds: pointer.titleNodeIds }
  };
  if (pointer.status === "comparable") {
    resolveComparableCandidates(
      pointer,
      product,
      candidateMap,
      nodeMap,
      issues
    );
  } else {
    product.abstainReason = pointer.status;
  }
  if (issues.length > 0) return { valid: false, pointer, issues };

  const extraction: ModelPageExtraction = {
    version: 1,
    pageId: observation.pageId,
    products: [product]
  };
  const validation = validateModelExtraction(
    extraction,
    observation,
    preferences
  );
  if (!validation.valid) {
    issues.push(
      ...validation.issues.map((entry) => ({
        code: "deterministic-validation" as const,
        field: mapValidationField(entry.field),
        message: `${entry.code}: ${entry.message}`
      }))
    );
  }
  return {
    valid: validation.valid,
    pointer,
    extraction,
    validation,
    issues
  };
}

export function scoreEvidencePointer(
  prediction: unknown,
  target: string,
  observation: PageObservation
): EvidencePointerScore {
  const targetParsed = parseEvidencePointer(target);
  const targetResolved = resolveEvidencePointer(target, observation);
  if (
    !targetParsed.valid ||
    !targetParsed.pointer ||
    !targetResolved.valid ||
    !targetResolved.validation
  ) {
    throw new Error(
      `Invalid target pointer: ${[
        ...targetParsed.issues,
        ...targetResolved.issues
      ]
        .map((issue) => issue.message)
        .join(" ")}`
    );
  }
  const predictedParsed = parseEvidencePointer(prediction);
  const predictedResolved = resolveEvidencePointer(prediction, observation);
  const fields = pointerFieldValues(targetParsed.pointer);
  const predictedFields = predictedParsed.pointer
    ? pointerFieldValues(predictedParsed.pointer)
    : new Map<EvidencePointerField, string>();
  const pointerFieldsCorrect = [...fields].filter(
    ([field, value]) => predictedFields.get(field) === value
  ).length;
  const targetProduct = targetResolved.validation.products[0]!;
  const predictedProduct = predictedResolved.validation?.products[0];
  const targetComparable = targetProduct.status === "accepted";
  const predictedAccepted = predictedProduct?.status === "accepted";
  const normalizedMatch =
    Boolean(targetProduct.normalized && predictedProduct?.normalized) &&
    targetProduct.normalized!.compareKey ===
      predictedProduct!.normalized!.compareKey &&
    Math.abs(
      targetProduct.normalized!.centsPerUnit -
        predictedProduct!.normalized!.centsPerUnit
    ) /
      targetProduct.normalized!.centsPerUnit <=
      0.005;
  return {
    syntaxValid: predictedParsed.valid,
    pointerExact:
      predictedParsed.valid &&
      serializeParsedPointer(predictedParsed.pointer!) ===
        serializeParsedPointer(targetParsed.pointer),
    pointerFieldsCorrect,
    pointerFieldsTotal: fields.size,
    evidenceAccepted: predictedResolved.valid,
    targetComparable,
    acceptedCorrect:
      targetComparable && Boolean(predictedAccepted && normalizedMatch),
    acceptedIncorrect: Boolean(
      predictedAccepted && (!targetComparable || !normalizedMatch)
    ),
    abstentionClassMatch:
      targetComparable === (predictedProduct?.status === "accepted"),
    abstentionReasonMatch:
      targetParsed.pointer.status !== "comparable" &&
      predictedParsed.pointer?.status === targetParsed.pointer.status,
    issues: predictedResolved.issues
  };
}

function addCandidatesForNode(
  output: EvidenceCandidate[],
  nodeId: string,
  text: string
): void {
  const prices = uniqueBy(
    parseMoneyValues(text),
    (value) => `${value.cents}:${value.sourceText}`
  );
  prices.forEach((value, index) =>
    output.push({
      id: `${nodeId}@p${index}`,
      kind: "current-price",
      nodeId,
      evidenceNodeIds: [nodeId],
      sourceText: value.sourceText,
      cents: value.cents
    })
  );
  const unitPrices = uniqueBy(
    parseNativeUnitPrices(text),
    (value) => `${value.centsPerUnit}:${value.unit}:${value.sourceText}`
  );
  unitPrices.forEach((value, index) =>
    output.push({
      id: `${nodeId}@u${index}`,
      kind: "native-unit-price",
      nodeId,
      evidenceNodeIds: [nodeId],
      sourceText: value.sourceText,
      centsPerUnit: value.centsPerUnit,
      unit: value.unit,
      dimension: value.dimension
    })
  );

  const factored = parseFactoredPackageQuantities(text);
  const standalonePackCount = extractPackCount(text);
  const quantities = [
    ...factored.map((value) => ({
      value: value.valuePerPackage,
      unit: value.unit,
      dimension: value.dimension,
      sourceText: value.sourceText
    })),
    ...parseQuantities(text)
  ];
  uniqueBy(
    quantities,
    (value) => `${value.value}:${value.unit}:${value.sourceText}`
  ).forEach((value, index) =>
    output.push({
      id: `${nodeId}@q${index}`,
      kind: "package-quantity",
      nodeId,
      evidenceNodeIds: [nodeId],
      sourceText: value.sourceText,
      valuePerPackage: value.value,
      unit: value.unit,
      dimension: value.dimension
    })
  );
  uniqueBy(
    [
      ...factored.map((value) => ({
        packCount: value.packCount,
        sourceText: value.sourceText
      })),
      ...(standalonePackCount
        ? [
            {
              packCount: standalonePackCount,
              sourceText: text
            }
          ]
        : [])
    ],
    (value) => `${value.packCount}:${value.sourceText}`
  ).forEach((value, index) =>
    output.push({
      id: `${nodeId}@k${index}`,
      kind: "pack-count",
      nodeId,
      evidenceNodeIds: [nodeId],
      sourceText: value.sourceText,
      packCount: value.packCount
    })
  );
}

function addSplitNativeUnitCandidates(
  output: EvidenceCandidate[],
  observation: PageObservation,
  cardNodeId: string,
  nodeMap: ReadonlyMap<string, ObservedNode>
): void {
  const directPrices = observation.nodes
    .filter((node) => isWithinCard(node.id, cardNodeId, nodeMap))
    .flatMap((node) => {
      const text = directNodeText(node);
      if (!text || parseNativeUnitPrices(text).length > 0) return [];
      return parseMoneyValues(text).map((price) => ({
        nodeId: node.id,
        cents: price.cents,
        sourceText: price.sourceText
      }));
    });
  const uniquePrices = uniqueBy(
    directPrices,
    (price) => `${price.nodeId}:${price.cents}:${price.sourceText}`
  );
  if (uniquePrices.length !== 1) return;

  const unitPattern = new RegExp(
    `(?:/|\\bper\\s+)\\s*(${getUnitRegexSource()})(?=\\b|\\W)`,
    "gi"
  );
  const unitMarkers = observation.nodes
    .filter((node) => isWithinCard(node.id, cardNodeId, nodeMap))
    .flatMap((node) => {
      const text = directNodeText(node);
      if (!text || parseNativeUnitPrices(text).length > 0) return [];
      return [...text.matchAll(unitPattern)].flatMap((match) => {
        const unit = match[1] ? parseUnit(match[1]) : undefined;
        if (
          !unit ||
          (unit.dimension !== "area" && unit.dimension !== "length")
        ) {
          return [];
        }
        return [
          {
            nodeId: node.id,
            unit: unit.unit,
            dimension: unit.dimension,
            sourceText: match[0]
          }
        ];
      });
    });
  const uniqueUnits = uniqueBy(
    unitMarkers,
    (unit) => `${unit.nodeId}:${unit.unit}:${unit.sourceText}`
  );
  if (
    uniqueUnits.length === 0 ||
    new Set(uniqueUnits.map((unit) => `${unit.unit}:${unit.dimension}`))
      .size !== 1
  ) {
    return;
  }

  const price = uniquePrices[0]!;
  let nextIndex = output.filter((candidate) =>
    candidate.id.startsWith(`${cardNodeId}@u`)
  ).length;
  for (const unit of uniqueUnits) {
    if (price.nodeId === unit.nodeId) continue;
    output.push({
      id: `${cardNodeId}@u${nextIndex}`,
      kind: "native-unit-price",
      nodeId: cardNodeId,
      evidenceNodeIds: [price.nodeId, unit.nodeId],
      sourceText: `${price.sourceText} ${unit.sourceText}`,
      centsPerUnit: price.cents,
      unit: unit.unit,
      dimension: unit.dimension
    });
    nextIndex += 1;
  }
}

function directNodeText(node: ObservedNode): string {
  return [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveComparableCandidates(
  pointer: EvidencePointerProduct,
  product: ModelProductExtraction,
  candidateMap: ReadonlyMap<string, EvidenceCandidate>,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  issues: EvidencePointerIssue[]
): void {
  const price = resolveCandidate(
    pointer.currentPriceCandidateId,
    "CURRENT_PRICE",
    candidateMap,
    product.cardNodeId,
    nodeMap,
    issues
  );
  const native = resolveCandidate(
    pointer.nativeUnitPriceCandidateId,
    "NATIVE_UNIT_PRICE",
    candidateMap,
    product.cardNodeId,
    nodeMap,
    issues
  );
  const quantity = resolveCandidate(
    pointer.packageQuantityCandidateId,
    "PACKAGE_QUANTITY",
    candidateMap,
    product.cardNodeId,
    nodeMap,
    issues
  );
  const pack = resolveCandidate(
    pointer.packCountCandidateId,
    "PACK_COUNT",
    candidateMap,
    product.cardNodeId,
    nodeMap,
    issues
  );
  if (price?.kind === "current-price") {
    product.currentPrice = {
      cents: price.cents,
      currency: "USD",
      evidenceNodeIds: price.evidenceNodeIds
    };
  }
  if (native?.kind === "native-unit-price") {
    product.nativeUnitPrice = {
      centsPerUnit: native.centsPerUnit,
      unit: native.unit,
      dimension: native.dimension,
      evidenceNodeIds: native.evidenceNodeIds
    };
  }
  if (quantity?.kind === "package-quantity") {
    product.packageQuantity = {
      valuePerPackage: quantity.valuePerPackage,
      unit: quantity.unit,
      dimension: quantity.dimension,
      packCount: pack?.kind === "pack-count" ? pack.packCount : 1,
      evidenceNodeIds: unique([
        ...quantity.evidenceNodeIds,
        ...(pack?.kind === "pack-count" ? pack.evidenceNodeIds : [])
      ])
    };
  }
}

function resolveCandidate(
  candidateId: string | undefined,
  field: CandidateField,
  candidateMap: ReadonlyMap<string, EvidenceCandidate>,
  cardNodeId: string,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  issues: EvidencePointerIssue[]
): EvidenceCandidate | undefined {
  if (!candidateId) return undefined;
  const candidate = candidateMap.get(candidateId);
  if (!candidate) {
    const nodeId = candidateId.slice(0, candidateId.lastIndexOf("@"));
    if (nodeMap.has(nodeId) && !isWithinCard(nodeId, cardNodeId, nodeMap)) {
      issues.push({
        code: "evidence-outside-card",
        field,
        message: `Candidate ${candidateId} is outside card ${cardNodeId}.`
      });
      return undefined;
    }
    issues.push({
      code: "unknown-candidate",
      field,
      message: `Unknown candidate ${candidateId}.`
    });
    return undefined;
  }
  const expected = CANDIDATE_KIND_BY_FIELD[field];
  if (candidate.kind !== expected) {
    issues.push({
      code: "candidate-kind-mismatch",
      field,
      message: `${candidateId} is ${candidate.kind}, expected ${expected}.`
    });
    return undefined;
  }
  return candidate;
}

function selectTargetCandidate(
  candidates: readonly EvidenceCandidate[],
  kind: EvidenceCandidateKind,
  evidenceNodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, ObservedNode>,
  matches: (candidate: EvidenceCandidate) => boolean
): string {
  const matching = candidates.filter(
    (candidate) =>
      candidate.kind === kind &&
      matches(candidate) &&
      candidateSupportsEvidence(candidate, evidenceNodeIds, nodeMap)
  );
  if (matching.length === 0) {
    throw new Error(
      `No deterministic ${kind} candidate matches the grounded target.`
    );
  }
  return matching.sort(
    (left, right) =>
      evidenceDistance(left.evidenceNodeIds, evidenceNodeIds, nodeMap) -
        evidenceDistance(right.evidenceNodeIds, evidenceNodeIds, nodeMap) ||
      left.id.localeCompare(right.id)
  )[0]!.id;
}

function candidateSupportsEvidence(
  candidate: EvidenceCandidate,
  evidenceNodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, ObservedNode>
): boolean {
  return evidenceNodeIds.every((nodeId) =>
    candidate.evidenceNodeIds.some(
      (candidateNodeId) =>
        isWithinCard(nodeId, candidateNodeId, nodeMap) ||
        isWithinCard(candidateNodeId, nodeId, nodeMap)
    )
  );
}

function evidenceDistance(
  candidateNodeIds: readonly string[],
  evidenceNodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, ObservedNode>
): number {
  return Math.min(
    ...candidateNodeIds.map((candidateNodeId) =>
      evidenceDistanceForNode(candidateNodeId, evidenceNodeIds, nodeMap)
    )
  );
}

function evidenceDistanceForNode(
  candidateNodeId: string,
  evidenceNodeIds: readonly string[],
  nodeMap: ReadonlyMap<string, ObservedNode>
): number {
  if (evidenceNodeIds.includes(candidateNodeId)) return 0;
  let distance = 1;
  let current = nodeMap.get(evidenceNodeIds[0] ?? "");
  while (current?.parentId) {
    if (current.parentId === candidateNodeId) return distance;
    current = nodeMap.get(current.parentId);
    distance += 1;
  }
  return 1_000 + distance;
}

function parseSingleNode(
  value: string,
  field: "CARD",
  issues: EvidencePointerIssue[]
): string | undefined {
  if (!NODE_TOKEN.test(value)) {
    issues.push({
      code: "invalid-pointer",
      field,
      message: "CARD must contain exactly one node ID."
    });
    return undefined;
  }
  return value;
}

function parseNodeList(
  value: string,
  field: "TITLE",
  issues: EvidencePointerIssue[]
): string[] {
  if (value === "NONE") {
    issues.push({
      code: "missing-evidence",
      field,
      message: "TITLE cannot be NONE."
    });
    return [];
  }
  const values = value.split(",");
  if (values.some((item) => !NODE_TOKEN.test(item))) {
    issues.push({
      code: "invalid-pointer",
      field,
      message: "TITLE must be a comma-separated list of node IDs."
    });
    return [];
  }
  if (new Set(values).size !== values.length) {
    issues.push({
      code: "duplicate-pointer",
      field,
      message: "TITLE contains a duplicate node ID."
    });
  }
  return values;
}

function parseCandidate(
  value: string,
  field: CandidateField,
  issues: EvidencePointerIssue[]
): string | undefined {
  if (value === "NONE") return undefined;
  if (!CANDIDATE_TOKEN.test(value)) {
    issues.push({
      code: "invalid-pointer",
      field,
      message: `${field} must be NONE or one listed deterministic candidate ID.`
    });
    return undefined;
  }
  return value;
}

function validatePointerSemantics(
  pointer: EvidencePointerProduct,
  issues: EvidencePointerIssue[]
): void {
  const valueCandidates = [
    pointer.currentPriceCandidateId,
    pointer.nativeUnitPriceCandidateId,
    pointer.packageQuantityCandidateId,
    pointer.packCountCandidateId
  ];
  if (pointer.status !== "comparable" && valueCandidates.some(Boolean)) {
    issues.push({
      code: "incompatible-status",
      field: "STATUS",
      message: "An abstention must use NONE for all price and quantity fields."
    });
  }
  if (
    pointer.status === "comparable" &&
    !pointer.nativeUnitPriceCandidateId &&
    !(pointer.currentPriceCandidateId && pointer.packageQuantityCandidateId)
  ) {
    issues.push({
      code: "incompatible-status",
      field: "STATUS",
      message:
        "Comparable output requires native unit price or current price plus package quantity."
    });
  }
  if (pointer.packCountCandidateId && !pointer.packageQuantityCandidateId) {
    issues.push({
      code: "incompatible-status",
      field: "PACK_COUNT",
      message: "PACK_COUNT requires PACKAGE_QUANTITY."
    });
  }
}

function serializeParsedPointer(pointer: EvidencePointerProduct): string {
  return [
    `CARD ${pointer.cardNodeId}`,
    `TITLE ${pointer.titleNodeIds.join(",")}`,
    `CURRENT_PRICE ${pointer.currentPriceCandidateId ?? "NONE"}`,
    `NATIVE_UNIT_PRICE ${pointer.nativeUnitPriceCandidateId ?? "NONE"}`,
    `PACKAGE_QUANTITY ${pointer.packageQuantityCandidateId ?? "NONE"}`,
    `PACK_COUNT ${pointer.packCountCandidateId ?? "NONE"}`,
    `STATUS ${pointer.status}`
  ].join("\n");
}

function pointerFieldValues(
  pointer: EvidencePointerProduct
): Map<EvidencePointerField, string> {
  return new Map([
    ["CARD", pointer.cardNodeId],
    ["TITLE", pointer.titleNodeIds.join(",")],
    ["CURRENT_PRICE", pointer.currentPriceCandidateId ?? "NONE"],
    ["NATIVE_UNIT_PRICE", pointer.nativeUnitPriceCandidateId ?? "NONE"],
    ["PACKAGE_QUANTITY", pointer.packageQuantityCandidateId ?? "NONE"],
    ["PACK_COUNT", pointer.packCountCandidateId ?? "NONE"],
    ["STATUS", pointer.status]
  ]);
}

function validateNodePointer(
  nodeId: string,
  field: "TITLE",
  cardNodeId: string,
  nodeMap: ReadonlyMap<string, ObservedNode>,
  issues: EvidencePointerIssue[]
): void {
  if (!nodeMap.has(nodeId)) {
    issues.push({
      code: "unknown-node",
      field,
      message: `Unknown evidence node ${nodeId}.`
    });
  } else if (!isWithinCard(nodeId, cardNodeId, nodeMap)) {
    issues.push({
      code: "evidence-outside-card",
      field,
      message: `Evidence node ${nodeId} is outside card ${cardNodeId}.`
    });
  }
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
    for (const child of children.get(nodeId) ?? []) visit(child);
  };
  for (const nodeId of nodeIds) visit(nodeId);
  return cleanText(parts.join(" "));
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
  let current = nodeMap.get(nodeId);
  while (current) {
    if (current.id === cardNodeId) return true;
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
  }
  return false;
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const valueKey = key(value);
    if (seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(0.001, Math.abs(right) * 0.0001);
}

function mapValidationField(field: string): EvidencePointerField {
  if (field.startsWith("title")) return "TITLE";
  if (field.startsWith("currentPrice")) return "CURRENT_PRICE";
  if (field.startsWith("nativeUnitPrice")) return "NATIVE_UNIT_PRICE";
  if (field.startsWith("packageQuantity")) return "PACKAGE_QUANTITY";
  if (field.startsWith("cardNodeId")) return "CARD";
  return "STATUS";
}

function failure(
  code: EvidencePointerIssueCode,
  field: EvidencePointerIssue["field"],
  message: string
): ParsedEvidencePointer {
  return { valid: false, issues: [{ code, field, message }] };
}
