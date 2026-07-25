import type { PageObservation } from "../src/learning/contracts";
import {
  parseEvidencePointer,
  resolveEvidencePointer,
  type EvidencePointerProduct,
  type ResolvedEvidencePointer
} from "../src/learning/evidence-pointer";
import type {
  CorpusAnnotation,
  DatasetProductChallengeTag
} from "./live-corpus-lib";

export type EvidenceReviewPhase = "independent" | "adjudicated";
export type EvidenceProductScope =
  | "primary-results"
  | "secondary-recommendation"
  | "sponsored"
  | "non-product";

export interface EvidenceReviewSource {
  observationSha256: string;
  screenshotSha256: string;
  captureTimestamp: string;
  registrableDomain: string;
  cohort: "training" | "validation" | "selection" | "final";
}

export interface EvidenceReviewProduct {
  cardNodeId: string;
  scope: EvidenceProductScope;
  target: string;
  challengeTags?: DatasetProductChallengeTag[];
  notes?: string;
}

export interface EvidencePointerReview {
  version: 1;
  reviewId: string;
  pageId: string;
  phase: EvidenceReviewPhase;
  reviewerId: string;
  completedAt: string;
  coverage: "complete-main-region";
  preannotationVisibility: "hidden" | "shown-after-submit";
  source: EvidenceReviewSource;
  sourceReviewIds?: string[];
  products: EvidenceReviewProduct[];
}

export interface EvidenceReviewValidation {
  valid: boolean;
  errors: string[];
  resolvedProducts: Map<string, ResolvedEvidencePointer>;
}

export interface EvidenceReviewAgreement {
  pageId: string;
  reviewerIds: [string, string];
  cardsA: number;
  cardsB: number;
  alignedCards: number;
  rootSetExact: boolean;
  rootPrecision: number;
  rootRecall: number;
  rootF1: number;
  comparableKappa: number | null;
  exactStatusAgreement: number;
  exactPriceAgreement: number;
  exactQuantityAgreement: number;
  exactDimensionAgreement: number;
  exactPointerAgreement: number;
  disagreements: EvidenceReviewDisagreement[];
}

export interface EvidenceReviewDisagreement {
  cardNodeId: string;
  fields: Array<
    | "root"
    | "scope"
    | "status"
    | "title"
    | "currentPrice"
    | "nativeUnitPrice"
    | "packageQuantity"
    | "packCount"
    | "dimension"
  >;
}

export interface EvidenceReviewValidationOptions {
  observationSha256?: string;
  screenshotSha256?: string;
  expectedCardNodeIds?: readonly string[];
}

const SHA256 = /^[a-f0-9]{64}$/;

export function validateEvidencePointerReview(
  review: EvidencePointerReview,
  observation: PageObservation,
  options: EvidenceReviewValidationOptions = {}
): EvidenceReviewValidation {
  const errors: string[] = [];
  const resolvedProducts = new Map<string, ResolvedEvidencePointer>();
  if (review.version !== 1) errors.push("review version must be 1");
  if (!review.reviewId.trim()) errors.push("reviewId is required");
  if (review.pageId !== observation.pageId) {
    errors.push("review and observation page ids do not match");
  }
  if (!review.reviewerId.trim()) errors.push("reviewerId is required");
  if (!isIsoTimestamp(review.completedAt)) errors.push("completedAt must be ISO-8601");
  if (review.coverage !== "complete-main-region") {
    errors.push("review coverage must be complete-main-region");
  }
  validateSource(review.source, options, errors);
  validatePhase(review, errors);

  const seenCards = new Set<string>();
  for (const [index, product] of review.products.entries()) {
    if (seenCards.has(product.cardNodeId)) {
      errors.push(`product ${index}: duplicate card ${product.cardNodeId}`);
      continue;
    }
    seenCards.add(product.cardNodeId);
    const parsed = parseEvidencePointer(product.target);
    if (!parsed.valid || !parsed.pointer) {
      errors.push(
        `product ${index}: invalid target: ${parsed.issues
          .map((issue) => issue.code)
          .join(", ")}`
      );
      continue;
    }
    if (parsed.pointer.cardNodeId !== product.cardNodeId) {
      errors.push(`product ${index}: target CARD does not match cardNodeId`);
      continue;
    }
    const resolved = resolveEvidencePointer(product.target, observation);
    resolvedProducts.set(product.cardNodeId, resolved);
    if (!resolved.valid) {
      errors.push(
        `product ${index}: unresolved target: ${resolved.issues
          .map((issue) => issue.code)
          .join(", ")}`
      );
    }
    if (
      product.scope === "non-product" &&
      parsed.pointer.status !== "not-a-product"
    ) {
      errors.push(`product ${index}: non-product scope requires not-a-product status`);
    }
    if (
      product.scope !== "non-product" &&
      parsed.pointer.status === "not-a-product"
    ) {
      errors.push(`product ${index}: not-a-product status requires non-product scope`);
    }
  }

  if (options.expectedCardNodeIds) {
    const expected = new Set(options.expectedCardNodeIds);
    const missing = [...expected].filter((cardNodeId) => !seenCards.has(cardNodeId));
    const unexpected = [...seenCards].filter((cardNodeId) => !expected.has(cardNodeId));
    if (missing.length > 0) {
      errors.push(`review omits expected cards: ${missing.sort().join(", ")}`);
    }
    if (unexpected.length > 0) {
      errors.push(`review includes unexpected cards: ${unexpected.sort().join(", ")}`);
    }
  }

  return { valid: errors.length === 0, errors, resolvedProducts };
}

export function compareIndependentEvidenceReviews(
  reviewA: EvidencePointerReview,
  reviewB: EvidencePointerReview,
  observation: PageObservation
): EvidenceReviewAgreement {
  assertIndependentPair(reviewA, reviewB);
  const validationA = validateEvidencePointerReview(reviewA, observation);
  const validationB = validateEvidencePointerReview(reviewB, observation);
  if (!validationA.valid || !validationB.valid) {
    throw new Error(
      `Cannot compare invalid reviews: ${[
        ...validationA.errors.map((error) => `A: ${error}`),
        ...validationB.errors.map((error) => `B: ${error}`)
      ].join("; ")}`
    );
  }

  const productsA = productMap(reviewA);
  const productsB = productMap(reviewB);
  const cardsA = new Set(productsA.keys());
  const cardsB = new Set(productsB.keys());
  const aligned = [...cardsA].filter((cardNodeId) => cardsB.has(cardNodeId)).sort();
  const union = [...new Set([...cardsA, ...cardsB])].sort();
  const disagreements: EvidenceReviewDisagreement[] = [];
  const fieldMatches = {
    status: 0,
    currentPrice: 0,
    packageQuantity: 0,
    dimension: 0,
    pointer: 0
  };
  const comparableA: boolean[] = [];
  const comparableB: boolean[] = [];

  for (const cardNodeId of union) {
    const left = productsA.get(cardNodeId);
    const right = productsB.get(cardNodeId);
    if (!left || !right) {
      disagreements.push({ cardNodeId, fields: ["root"] });
      continue;
    }
    const pointerA = requirePointer(left.target);
    const pointerB = requirePointer(right.target);
    const resolvedA = validationA.resolvedProducts.get(cardNodeId)!;
    const resolvedB = validationB.resolvedProducts.get(cardNodeId)!;
    const fields = disagreementFields(left, right, pointerA, pointerB, resolvedA, resolvedB);
    if (fields.length > 0) disagreements.push({ cardNodeId, fields });

    const statusMatch = pointerA.status === pointerB.status;
    const priceMatch =
      pointerA.currentPriceCandidateId === pointerB.currentPriceCandidateId;
    const quantityMatch =
      pointerA.packageQuantityCandidateId === pointerB.packageQuantityCandidateId &&
      pointerA.packCountCandidateId === pointerB.packCountCandidateId;
    const dimensionMatch =
      resolvedDimension(resolvedA) === resolvedDimension(resolvedB);
    fieldMatches.status += Number(statusMatch);
    fieldMatches.currentPrice += Number(priceMatch);
    fieldMatches.packageQuantity += Number(quantityMatch);
    fieldMatches.dimension += Number(dimensionMatch);
    fieldMatches.pointer += Number(left.target === right.target);
    comparableA.push(pointerA.status === "comparable");
    comparableB.push(pointerB.status === "comparable");
  }

  const rootPrecision = cardsA.size > 0 ? aligned.length / cardsA.size : 1;
  const rootRecall = cardsB.size > 0 ? aligned.length / cardsB.size : 1;
  return {
    pageId: reviewA.pageId,
    reviewerIds: [reviewA.reviewerId, reviewB.reviewerId],
    cardsA: cardsA.size,
    cardsB: cardsB.size,
    alignedCards: aligned.length,
    rootSetExact: cardsA.size === cardsB.size && aligned.length === cardsA.size,
    rootPrecision,
    rootRecall,
    rootF1:
      rootPrecision + rootRecall > 0
        ? (2 * rootPrecision * rootRecall) / (rootPrecision + rootRecall)
        : 0,
    comparableKappa: cohensKappa(comparableA, comparableB),
    exactStatusAgreement: rate(fieldMatches.status, aligned.length),
    exactPriceAgreement: rate(fieldMatches.currentPrice, aligned.length),
    exactQuantityAgreement: rate(fieldMatches.packageQuantity, aligned.length),
    exactDimensionAgreement: rate(fieldMatches.dimension, aligned.length),
    exactPointerAgreement: rate(fieldMatches.pointer, aligned.length),
    disagreements
  };
}

export function validateEvidenceAdjudication(
  adjudication: EvidencePointerReview,
  reviewA: EvidencePointerReview,
  reviewB: EvidencePointerReview,
  observation: PageObservation
): EvidenceReviewValidation {
  assertIndependentPair(reviewA, reviewB);
  const result = validateEvidencePointerReview(adjudication, observation);
  const errors = [...result.errors];
  if (adjudication.phase !== "adjudicated") {
    errors.push("final review phase must be adjudicated");
  }
  if (
    adjudication.reviewerId === reviewA.reviewerId ||
    adjudication.reviewerId === reviewB.reviewerId
  ) {
    errors.push("adjudicator must differ from both independent reviewers");
  }
  const expectedSources = [reviewA.reviewId, reviewB.reviewId].sort();
  const actualSources = [...(adjudication.sourceReviewIds ?? [])].sort();
  if (JSON.stringify(actualSources) !== JSON.stringify(expectedSources)) {
    errors.push("adjudication must cite exactly both independent review IDs");
  }
  const sourceCards = new Set([
    ...reviewA.products.map((product) => product.cardNodeId),
    ...reviewB.products.map((product) => product.cardNodeId)
  ]);
  const adjudicatedCards = new Set(
    adjudication.products.map((product) => product.cardNodeId)
  );
  const unresolved = [...sourceCards].filter(
    (cardNodeId) => !adjudicatedCards.has(cardNodeId)
  );
  const unreviewed = [...adjudicatedCards].filter(
    (cardNodeId) => !sourceCards.has(cardNodeId)
  );
  if (unresolved.length > 0) {
    errors.push(`adjudication omits reviewed cards: ${unresolved.sort().join(", ")}`);
  }
  if (unreviewed.length > 0) {
    errors.push(`adjudication adds cards lacking dual review: ${unreviewed.sort().join(", ")}`);
  }
  return { ...result, valid: errors.length === 0, errors };
}

export function compileAdjudicatedCorpusAnnotation(
  adjudication: EvidencePointerReview,
  reviewA: EvidencePointerReview,
  reviewB: EvidencePointerReview,
  observation: PageObservation
): CorpusAnnotation {
  const validation = validateEvidenceAdjudication(
    adjudication,
    reviewA,
    reviewB,
    observation
  );
  if (!validation.valid) {
    throw new Error(`Invalid adjudication: ${validation.errors.join("; ")}`);
  }
  const root = observation.nodes.find(
    (node) => node.id === observation.rootNodeId
  );
  const region = observation.sourceRegion ?? root?.bounds;
  if (!region) throw new Error("Observation lacks a bounded annotation region.");

  return {
    version: 1,
    pageId: observation.pageId,
    reviewStatus: "adjudicated",
    coverage: "complete-main-region",
    region,
    annotators: [
      reviewA.reviewerId,
      reviewB.reviewerId,
      adjudication.reviewerId
    ],
    products: adjudication.products.map((reviewedProduct) => {
      const resolved = validation.resolvedProducts.get(
        reviewedProduct.cardNodeId
      )!;
      const extraction = resolved.extraction!.products[0]!;
      const validated = resolved.validation!.products[0]!;
      const fieldEvidence = {
        title: extraction.title.evidenceNodeIds,
        ...(extraction.currentPrice
          ? { currentPrice: extraction.currentPrice.evidenceNodeIds }
          : {}),
        ...(extraction.nativeUnitPrice
          ? { nativeUnitPrice: extraction.nativeUnitPrice.evidenceNodeIds }
          : {}),
        ...(extraction.packageQuantity
          ? { packageQuantity: extraction.packageQuantity.evidenceNodeIds }
          : {})
      };
      const evidenceNodeIds = [
        ...fieldEvidence.title,
        ...(fieldEvidence.currentPrice ?? []),
        ...(fieldEvidence.nativeUnitPrice ?? []),
        ...(fieldEvidence.packageQuantity ?? [])
      ].filter((value, index, values) => values.indexOf(value) === index);
      const comparable = validated.status === "accepted";
      return {
        nodeId: reviewedProduct.cardNodeId,
        scope: legacyScope(reviewedProduct.scope),
        comparable,
        ...(reviewedProduct.challengeTags
          ? { challengeTags: reviewedProduct.challengeTags }
          : {}),
        title: extraction.title.value,
        evidenceNodeIds,
        fieldEvidence,
        ...(extraction.currentPrice
          ? { currentPriceCents: extraction.currentPrice.cents }
          : {}),
        ...(extraction.nativeUnitPrice
          ? {
              nativeUnitPrice: {
                centsPerUnit: extraction.nativeUnitPrice.centsPerUnit,
                unit: extraction.nativeUnitPrice.unit,
                dimension: extraction.nativeUnitPrice.dimension
              }
            }
          : {}),
        ...(extraction.packageQuantity
          ? {
              packageQuantity: {
                valuePerPackage: extraction.packageQuantity.valuePerPackage,
                packCount: extraction.packageQuantity.packCount,
                unit: extraction.packageQuantity.unit,
                dimension: extraction.packageQuantity.dimension
              }
            }
          : {}),
        ...(validated.normalized
          ? {
              expectedNormalized: {
                centsPerUnit: validated.normalized.centsPerUnit,
                unit: validated.normalized.unit,
                dimension: validated.normalized.dimension
              }
            }
          : {}),
        ...(extraction.abstainReason
          ? {
              abstainReason: extraction.abstainReason,
              exclusionReason: extraction.abstainReason
            }
          : {}),
        ...(reviewedProduct.notes ? { notes: reviewedProduct.notes } : {})
      };
    })
  };
}

function validateSource(
  source: EvidenceReviewSource,
  options: EvidenceReviewValidationOptions,
  errors: string[]
): void {
  if (!SHA256.test(source.observationSha256)) {
    errors.push("source observationSha256 must be lowercase SHA-256");
  }
  if (!SHA256.test(source.screenshotSha256)) {
    errors.push("source screenshotSha256 must be lowercase SHA-256");
  }
  if (
    options.observationSha256 &&
    source.observationSha256 !== options.observationSha256
  ) {
    errors.push("source observation hash does not match");
  }
  if (
    options.screenshotSha256 &&
    source.screenshotSha256 !== options.screenshotSha256
  ) {
    errors.push("source screenshot hash does not match");
  }
  if (!isIsoTimestamp(source.captureTimestamp)) {
    errors.push("source captureTimestamp must be ISO-8601");
  }
  if (!source.registrableDomain.trim()) {
    errors.push("source registrableDomain is required");
  }
}

function validatePhase(review: EvidencePointerReview, errors: string[]): void {
  if (review.phase === "independent") {
    if (review.preannotationVisibility !== "hidden") {
      errors.push("independent review must hide preannotations");
    }
    if (review.sourceReviewIds?.length) {
      errors.push("independent review cannot cite source reviews");
    }
  } else {
    if (review.preannotationVisibility !== "shown-after-submit") {
      errors.push("adjudication must occur after independent submission");
    }
    if (
      review.sourceReviewIds?.length !== 2 ||
      new Set(review.sourceReviewIds).size !== 2
    ) {
      errors.push("adjudication must cite two distinct source reviews");
    }
  }
}

function assertIndependentPair(
  reviewA: EvidencePointerReview,
  reviewB: EvidencePointerReview
): void {
  if (reviewA.phase !== "independent" || reviewB.phase !== "independent") {
    throw new Error("Agreement requires two independent reviews.");
  }
  if (reviewA.reviewerId === reviewB.reviewerId) {
    throw new Error("Independent reviews require distinct reviewers.");
  }
  if (
    reviewA.pageId !== reviewB.pageId ||
    JSON.stringify(reviewA.source) !== JSON.stringify(reviewB.source)
  ) {
    throw new Error("Independent reviews must reference the same immutable source.");
  }
}

function productMap(
  review: EvidencePointerReview
): Map<string, EvidenceReviewProduct> {
  return new Map(review.products.map((product) => [product.cardNodeId, product]));
}

function requirePointer(target: string): EvidencePointerProduct {
  const parsed = parseEvidencePointer(target);
  if (!parsed.valid || !parsed.pointer) throw new Error("Invalid pointer target.");
  return parsed.pointer;
}

function disagreementFields(
  left: EvidenceReviewProduct,
  right: EvidenceReviewProduct,
  pointerA: EvidencePointerProduct,
  pointerB: EvidencePointerProduct,
  resolvedA: ResolvedEvidencePointer,
  resolvedB: ResolvedEvidencePointer
): EvidenceReviewDisagreement["fields"] {
  const fields: EvidenceReviewDisagreement["fields"] = [];
  if (left.scope !== right.scope) fields.push("scope");
  if (pointerA.status !== pointerB.status) fields.push("status");
  if (pointerA.titleNodeIds.join(",") !== pointerB.titleNodeIds.join(",")) {
    fields.push("title");
  }
  if (pointerA.currentPriceCandidateId !== pointerB.currentPriceCandidateId) {
    fields.push("currentPrice");
  }
  if (pointerA.nativeUnitPriceCandidateId !== pointerB.nativeUnitPriceCandidateId) {
    fields.push("nativeUnitPrice");
  }
  if (pointerA.packageQuantityCandidateId !== pointerB.packageQuantityCandidateId) {
    fields.push("packageQuantity");
  }
  if (pointerA.packCountCandidateId !== pointerB.packCountCandidateId) {
    fields.push("packCount");
  }
  if (resolvedDimension(resolvedA) !== resolvedDimension(resolvedB)) {
    fields.push("dimension");
  }
  return fields;
}

function resolvedDimension(result: ResolvedEvidencePointer): string {
  const product = result.extraction?.products[0];
  return (
    product?.nativeUnitPrice?.dimension ??
    product?.packageQuantity?.dimension ??
    "none"
  );
}

function legacyScope(
  scope: EvidenceProductScope
): CorpusAnnotation["products"][number]["scope"] {
  if (scope === "primary-results") return "primary-results";
  if (scope === "secondary-recommendation" || scope === "sponsored") {
    return "secondary-recommendation";
  }
  return "unknown";
}

function cohensKappa(left: readonly boolean[], right: readonly boolean[]): number | null {
  if (left.length !== right.length) throw new Error("Kappa labels must align.");
  if (left.length === 0) return null;
  const observed =
    left.filter((value, index) => value === right[index]).length / left.length;
  const leftPositive = left.filter(Boolean).length / left.length;
  const rightPositive = right.filter(Boolean).length / right.length;
  const expected =
    leftPositive * rightPositive +
    (1 - leftPositive) * (1 - rightPositive);
  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}

function rate(matches: number, total: number): number {
  return total > 0 ? matches / total : 1;
}

function isIsoTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
