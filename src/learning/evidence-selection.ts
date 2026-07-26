import {
  enumerateEvidenceCandidates,
  parseEvidencePointer,
  resolveEvidencePointer,
  serializeEvidencePointer,
  type EvidenceCandidate,
  type EvidencePointerIssue,
  type EvidencePointerProduct,
  type EvidencePointerStatus,
  type ResolvedEvidencePointer,
} from "./evidence-pointer";
import type {
  ModelProductExtraction,
  ObservedNode,
  PageObservation,
} from "./contracts";

export const EVIDENCE_SELECTION_VERSION = 1;

const STATUS_TO_CODE = {
  comparable: "C",
  "insufficient-evidence": "E",
  "conditional-price": "D",
  "price-range": "R",
  "unselected-variant": "V",
  "ambiguous-quantity": "Q",
  "unsupported-unit": "U",
  "not-a-product": "N",
} as const satisfies Record<EvidencePointerStatus, string>;

const CODE_TO_STATUS: ReadonlyMap<string, EvidencePointerStatus> = new Map(
  Object.entries(STATUS_TO_CODE).map(([status, code]) => [
    code,
    status as EvidencePointerStatus,
  ]),
);

const KIND_TO_CODE = {
  "current-price": "P",
  "native-unit-price": "U",
  "package-quantity": "Q",
  "pack-count": "K",
} as const satisfies Record<EvidenceCandidate["kind"], string>;

const OUTPUT_PATTERN =
  /^T([0-9A-Z]{2}) P([0-9A-Z]{2}|--) U([0-9A-Z]{2}|--) Q([0-9A-Z]{2}|--) K([0-9A-Z]{2}|--) S([CEDRVQUN])$/;

export interface EvidenceSelection {
  version: typeof EVIDENCE_SELECTION_VERSION;
  titleCode: string;
  currentPriceCode?: string;
  nativeUnitPriceCode?: string;
  packageQuantityCode?: string;
  packCountCode?: string;
  status: EvidencePointerStatus;
}

export interface ParsedEvidenceSelection {
  valid: boolean;
  selection?: EvidenceSelection;
  issues: EvidencePointerIssue[];
}

interface SelectionCatalog {
  nodeCodes: Map<string, string>;
  nodesByCode: Map<string, ObservedNode>;
  candidateCodes: Map<string, string>;
  candidatesByCode: Map<string, EvidenceCandidate>;
}

export function buildEvidenceSelectionPrompt(
  observation: PageObservation,
  cardNodeId: string,
): string {
  const catalog = buildSelectionCatalog(observation, cardNodeId);
  const cardCode = catalog.nodeCodes.get(cardNodeId);
  if (!cardCode) throw new Error(`Unknown card node ${cardNodeId}.`);
  return [
    "<start_of_image>",
    "TASK select-unit-evidence",
    `CARD ${cardCode}`,
    "OUTPUT T## P## U## Q## K## S#",
    "Use a listed two-character index for ## and -- for an absent value.",
    "S C requires U or both P and Q. Every non-C status requires P-- U-- Q-- K--.",
    "STATUS C=comparable E=insufficient D=conditional R=range V=variant Q=ambiguous U=unsupported N=not-product",
    `NODES ${serializeNodeCatalog(observation, catalog)}`,
    `VALUES ${serializeValueCatalog(catalog)}`,
  ].join("\n");
}

export function serializeEvidenceSelection(
  product: ModelProductExtraction,
  observation: PageObservation,
): string {
  const parsed = parseEvidencePointer(
    serializeEvidencePointer(product, observation),
  );
  if (!parsed.valid || !parsed.pointer) {
    throw new Error(
      `Cannot serialize evidence selection: ${parsed.issues
        .map((issue) => issue.code)
        .join(", ")}`,
    );
  }
  return serializePointerSelection(parsed.pointer, observation);
}

export function parseEvidenceSelection(
  input: unknown,
): ParsedEvidenceSelection {
  if (typeof input !== "string") {
    return selectionFailure(
      "invalid-output-type",
      "Selection output must be plain text.",
    );
  }
  const match = input.match(OUTPUT_PATTERN);
  if (!match) {
    return selectionFailure(
      "invalid-field",
      "Selection output must exactly match T## P## U## Q## K## S#.",
    );
  }
  const status = CODE_TO_STATUS.get(match[6]!);
  if (!status) {
    return selectionFailure("invalid-status", "Unknown selection status.");
  }
  const selection: EvidenceSelection = {
    version: EVIDENCE_SELECTION_VERSION,
    titleCode: match[1]!,
    ...(match[2] !== "--" ? { currentPriceCode: match[2] } : {}),
    ...(match[3] !== "--" ? { nativeUnitPriceCode: match[3] } : {}),
    ...(match[4] !== "--" ? { packageQuantityCode: match[4] } : {}),
    ...(match[5] !== "--" ? { packCountCode: match[5] } : {}),
    status,
  };
  if (
    status === "comparable" &&
    !selection.nativeUnitPriceCode &&
    !(selection.currentPriceCode && selection.packageQuantityCode)
  ) {
    return selectionFailure(
      "incompatible-status",
      "Comparable selection requires native unit price or current price plus package quantity.",
    );
  }
  if (
    status !== "comparable" &&
    (selection.currentPriceCode ||
      selection.nativeUnitPriceCode ||
      selection.packageQuantityCode ||
      selection.packCountCode)
  ) {
    return selectionFailure(
      "incompatible-status",
      "Abstaining selection must omit all price and quantity values.",
    );
  }
  return { valid: true, selection, issues: [] };
}

export function resolveEvidenceSelection(
  input: unknown,
  observation: PageObservation,
  cardNodeId: string,
): ResolvedEvidencePointer {
  const parsed = parseEvidenceSelection(input);
  if (!parsed.valid || !parsed.selection) {
    return { valid: false, issues: parsed.issues };
  }
  const catalog = buildSelectionCatalog(observation, cardNodeId);
  const selection = parsed.selection;
  const titleNode = catalog.nodesByCode.get(selection.titleCode);
  if (!titleNode) {
    return selectionResolutionFailure(
      "TITLE",
      `Unknown title index ${selection.titleCode}.`,
    );
  }
  const fields: Array<
    [
      "CURRENT_PRICE" | "NATIVE_UNIT_PRICE" | "PACKAGE_QUANTITY" | "PACK_COUNT",
      string | undefined,
      EvidenceCandidate["kind"],
    ]
  > = [
    ["CURRENT_PRICE", selection.currentPriceCode, "current-price"],
    ["NATIVE_UNIT_PRICE", selection.nativeUnitPriceCode, "native-unit-price"],
    ["PACKAGE_QUANTITY", selection.packageQuantityCode, "package-quantity"],
    ["PACK_COUNT", selection.packCountCode, "pack-count"],
  ];
  const resolvedCandidates = new Map<string, EvidenceCandidate>();
  for (const [field, code, expectedKind] of fields) {
    if (!code) continue;
    const candidate = catalog.candidatesByCode.get(code);
    if (!candidate) {
      return selectionResolutionFailure(field, `Unknown value index ${code}.`);
    }
    if (candidate.kind !== expectedKind) {
      return selectionResolutionFailure(
        field,
        `Value index ${code} has kind ${candidate.kind}, expected ${expectedKind}.`,
      );
    }
    resolvedCandidates.set(field, candidate);
  }
  return resolveEvidencePointer(
    [
      `CARD ${cardNodeId}`,
      `TITLE ${titleNode.id}`,
      `CURRENT_PRICE ${resolvedCandidates.get("CURRENT_PRICE")?.id ?? "NONE"}`,
      `NATIVE_UNIT_PRICE ${resolvedCandidates.get("NATIVE_UNIT_PRICE")?.id ?? "NONE"}`,
      `PACKAGE_QUANTITY ${resolvedCandidates.get("PACKAGE_QUANTITY")?.id ?? "NONE"}`,
      `PACK_COUNT ${resolvedCandidates.get("PACK_COUNT")?.id ?? "NONE"}`,
      `STATUS ${selection.status}`,
    ].join("\n"),
    observation,
  );
}

function serializePointerSelection(
  pointer: EvidencePointerProduct,
  observation: PageObservation,
): string {
  if (pointer.titleNodeIds.length !== 1) {
    throw new Error("Evidence selection requires exactly one title node.");
  }
  const catalog = buildSelectionCatalog(observation, pointer.cardNodeId);
  const titleCode = catalog.nodeCodes.get(pointer.titleNodeIds[0]!);
  if (!titleCode)
    throw new Error("Title node is absent from selection catalog.");
  return [
    `T${titleCode}`,
    `P${candidateCode(catalog, pointer.currentPriceCandidateId)}`,
    `U${candidateCode(catalog, pointer.nativeUnitPriceCandidateId)}`,
    `Q${candidateCode(catalog, pointer.packageQuantityCandidateId)}`,
    `K${candidateCode(catalog, pointer.packCountCandidateId)}`,
    `S${STATUS_TO_CODE[pointer.status]}`,
  ].join(" ");
}

function candidateCode(
  catalog: SelectionCatalog,
  candidateId: string | undefined,
): string {
  if (!candidateId) return "--";
  const code = catalog.candidateCodes.get(candidateId);
  if (!code)
    throw new Error(`Candidate ${candidateId} is absent from catalog.`);
  return code;
}

function buildSelectionCatalog(
  observation: PageObservation,
  cardNodeId: string,
): SelectionCatalog {
  if (observation.nodes.length > 36 * 36) {
    throw new Error("Selection catalog exceeds two-character node capacity.");
  }
  const nodeEntries = observation.nodes.map(
    (node, index) => [node.id, encodeIndex(index)] as const,
  );
  const candidates = enumerateEvidenceCandidates(observation, cardNodeId);
  if (candidates.length > 36 * 36) {
    throw new Error("Selection catalog exceeds two-character value capacity.");
  }
  const candidateEntries = candidates.map(
    (candidate, index) => [candidate.id, encodeIndex(index)] as const,
  );
  return {
    nodeCodes: new Map(nodeEntries),
    nodesByCode: new Map(
      observation.nodes.map((node, index) => [encodeIndex(index), node]),
    ),
    candidateCodes: new Map(candidateEntries),
    candidatesByCode: new Map(
      candidates.map((candidate, index) => [encodeIndex(index), candidate]),
    ),
  };
}

function serializeNodeCatalog(
  observation: PageObservation,
  catalog: SelectionCatalog,
): string {
  const region = observation.sourceRegion ?? {
    x: observation.viewport.scrollX,
    y: observation.viewport.scrollY,
    width: observation.viewport.width,
    height: observation.viewport.height,
  };
  return JSON.stringify(
    observation.nodes.map((node) => ({
      i: catalog.nodeCodes.get(node.id),
      p: node.parentId ? (catalog.nodeCodes.get(node.parentId) ?? "--") : "--",
      t: node.tag,
      ...(node.role ? { r: node.role } : {}),
      ...(nodeContent(node) ? { s: nodeContent(node) } : {}),
      b: [
        normalizeCoordinate(node.bounds.x - region.x, region.width),
        normalizeCoordinate(node.bounds.y - region.y, region.height),
        normalizeCoordinate(node.bounds.width, region.width),
        normalizeCoordinate(node.bounds.height, region.height),
      ],
      ...(node.interactive ? { a: 1 } : {}),
    })),
  );
}

function serializeValueCatalog(catalog: SelectionCatalog): string {
  return JSON.stringify(
    [...catalog.candidatesByCode].map(([code, candidate]) => ({
      i: code,
      k: KIND_TO_CODE[candidate.kind],
      n: candidate.evidenceNodeIds.map((nodeId) =>
        catalog.nodeCodes.get(nodeId),
      ),
      s: candidate.sourceText,
    })),
  );
}

function nodeContent(node: ObservedNode): string {
  return [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function normalizeCoordinate(value: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(size) || size <= 0) return 0;
  return Math.round((value / size) * 1000);
}

function encodeIndex(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= 36 * 36) {
    throw new Error(`Selection index ${index} is out of range.`);
  }
  return index.toString(36).toUpperCase().padStart(2, "0");
}

function selectionFailure(
  code: EvidencePointerIssue["code"],
  message: string,
): ParsedEvidenceSelection {
  return {
    valid: false,
    issues: [{ code, field: "OUTPUT", message }],
  };
}

function selectionResolutionFailure(
  field: EvidencePointerIssue["field"],
  message: string,
): ResolvedEvidencePointer {
  return {
    valid: false,
    issues: [{ code: "invalid-pointer", field, message }],
  };
}
