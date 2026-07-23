import type { CanonicalUnit, Dimension, NormalizedPrice } from "../core/types";

export const PAGE_OBSERVATION_VERSION = 1;
export const MODEL_EXTRACTION_VERSION = 1;

export interface ObservationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObservationStyle {
  display: string;
  position: string;
  fontSize: number;
  fontWeight: number;
}

export interface ObservationAttributes {
  ariaLabel?: string;
  alt?: string;
  title?: string;
  placeholder?: string;
  itemProp?: string;
  itemType?: string;
  href?: string;
}

export interface ObservedNode {
  id: string;
  parentId?: string;
  tag: string;
  role?: string;
  text?: string;
  accessibleName?: string;
  attributes?: ObservationAttributes;
  bounds: ObservationBounds;
  intersectsViewport: boolean;
  interactive: boolean;
  style: ObservationStyle;
}

export interface PageObservation {
  version: typeof PAGE_OBSERVATION_VERSION;
  pageId: string;
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
  rootNodeId: string;
  nodes: ObservedNode[];
  truncated: boolean;
}

export interface GroundedTitle {
  value: string;
  evidenceNodeIds: string[];
}

export interface GroundedMoney {
  cents: number;
  currency: "USD";
  evidenceNodeIds: string[];
}

export interface GroundedNativeUnitPrice {
  centsPerUnit: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  evidenceNodeIds: string[];
}

export interface GroundedPackageQuantity {
  valuePerPackage: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  packCount: number;
  evidenceNodeIds: string[];
}

export type ModelAbstentionReason =
  | "insufficient-evidence"
  | "conditional-price"
  | "price-range"
  | "unselected-variant"
  | "ambiguous-quantity"
  | "unsupported-unit"
  | "not-a-product";

export interface ModelProductExtraction {
  cardNodeId: string;
  title: GroundedTitle;
  currentPrice?: GroundedMoney;
  nativeUnitPrice?: GroundedNativeUnitPrice;
  packageQuantity?: GroundedPackageQuantity;
  abstainReason?: ModelAbstentionReason;
}

export interface ModelPageExtraction {
  version: typeof MODEL_EXTRACTION_VERSION;
  pageId: string;
  products: ModelProductExtraction[];
}

export type EvidenceIssueCode =
  | "invalid-schema"
  | "page-mismatch"
  | "unknown-card-node"
  | "duplicate-card"
  | "unknown-evidence-node"
  | "evidence-outside-card"
  | "ungrounded-title"
  | "ungrounded-number"
  | "ungrounded-unit"
  | "invalid-dimension"
  | "invalid-value"
  | "incomplete-comparison"
  | "abstention-with-values";

export interface EvidenceIssue {
  code: EvidenceIssueCode;
  productIndex?: number;
  field: string;
  message: string;
}

export interface ValidatedProductExtraction {
  status: "accepted" | "abstained" | "rejected";
  extraction: ModelProductExtraction;
  issues: EvidenceIssue[];
  normalized?: NormalizedPrice;
}

export interface ValidatedPageExtraction {
  valid: boolean;
  pageId: string;
  issues: EvidenceIssue[];
  products: ValidatedProductExtraction[];
}

export interface ExtractionModelRequest {
  observation: PageObservation;
  instructions: string;
}

export interface ExtractionModelAdapter {
  id: string;
  extract(request: ExtractionModelRequest): Promise<unknown>;
}
