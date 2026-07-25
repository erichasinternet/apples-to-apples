import type { CorpusAnnotation } from "./live-corpus-lib";

export type IdealCohortName = "training" | "validation" | "selection" | "final";

export interface IdealCohortTarget {
  minimumDomains: number;
  minimumPages: number;
  minimumProducts: number;
  minimumComparable: number;
  minimumAbstentions: number;
  minimumStrata: number;
  minimumCategories: number;
  requiredDualReviewRate: number;
  requiredPointerReadyRate: number;
}

export interface IdealDatasetTargets {
  version: number;
  scope: {
    locale: string;
    currency: string;
    claim: string;
    unsupportedLocalePolicy: "abstain";
  };
  cohorts: Record<IdealCohortName, IdealCohortTarget>;
  distribution: {
    minimumComparableDimensionShares: Record<string, number>;
    minimumEvidenceModeShares: Record<string, number>;
    maximumDomainProductShare: number;
    maximumPageProductShare: number;
    minimumNarrowViewportShare: number;
    minimumTemporalDomains: number;
    minimumCapturesPerTemporalDomain: number;
    minimumProductChallengeCounts: Record<string, number>;
    minimumPageChallengeCounts: Record<string, number>;
  };
  quality: {
    minimumComparableKappa: number;
    minimumExactFieldAgreement: number;
    minimumExactPointerAgreement: number;
    requiredResolvedPointerRate: number;
    requiredDeterministicValidationRate: number;
    maximumCrossCohortDuplicateRate: number;
  };
  synthetic: {
    targetProducts: number;
    minimumStructuralFamilies: number;
    minimumExamplesPerRarePattern: number;
    maximumPostWarmStartPresentationShare: number;
  };
  learningCurve: {
    liveProductCheckpoints: number[];
    plateauIncrements: number;
    maximumPlateauGain: number;
    maximumSliceCoverageGap: number;
  };
  finalEvidence: {
    targetCoverage: number;
    minimumAcceptedOutputs: number;
    maximumAcceptedErrors: number;
  };
}

export interface IdealCohortActual {
  domains: Set<string>;
  strata: Set<string>;
  categories: Set<string>;
  pages: number;
  narrowViewportPages: number;
  products: number;
  comparable: number;
  abstentions: number;
  dualReviewedPages: number;
  pointerReadyProducts: number;
  dimensions: Record<string, number>;
  evidenceModes: Record<string, number>;
  productChallengeCounts: Record<string, number>;
  pageChallengeCounts: Record<string, number>;
  captureDatesByDomain: Map<string, Set<string>>;
}

export function emptyIdealCohortActual(): IdealCohortActual {
  return {
    domains: new Set(),
    strata: new Set(),
    categories: new Set(),
    pages: 0,
    narrowViewportPages: 0,
    products: 0,
    comparable: 0,
    abstentions: 0,
    dualReviewedPages: 0,
    pointerReadyProducts: 0,
    dimensions: {},
    evidenceModes: {},
    productChallengeCounts: {},
    pageChallengeCounts: {},
    captureDatesByDomain: new Map()
  };
}

export function validateIdealDatasetTargets(targets: IdealDatasetTargets): string[] {
  const errors: string[] = [];
  if (targets.version !== 1) errors.push("dataset target version must be 1");
  if (targets.scope.unsupportedLocalePolicy !== "abstain") {
    errors.push("unsupported locales must abstain");
  }

  for (const [name, cohort] of Object.entries(targets.cohorts)) {
    for (const [metric, value] of Object.entries(cohort)) {
      if (metric.startsWith("required")) {
        if (!(value > 0 && value <= 1)) errors.push(`${name}.${metric} must be in (0, 1]`);
      } else if (!Number.isInteger(value) || value <= 0) {
        errors.push(`${name}.${metric} must be a positive integer`);
      }
    }
    if (cohort.minimumComparable + cohort.minimumAbstentions > cohort.minimumProducts) {
      errors.push(`${name} comparable and abstention minimums exceed product minimum`);
    }
  }

  for (const [name, share] of Object.entries({
    ...targets.distribution.minimumComparableDimensionShares,
    ...targets.distribution.minimumEvidenceModeShares
  })) {
    if (!(share > 0 && share <= 1)) errors.push(`${name} share must be in (0, 1]`);
  }
  const dimensionShare = sum(Object.values(targets.distribution.minimumComparableDimensionShares));
  if (dimensionShare > 1) errors.push("minimum dimension shares exceed 1");
  const evidenceShare = sum(Object.values(targets.distribution.minimumEvidenceModeShares));
  if (evidenceShare > 1) errors.push("minimum evidence-mode shares exceed 1");

  const final = targets.cohorts.final;
  if (
    Math.floor(final.minimumComparable * targets.finalEvidence.targetCoverage) <
    targets.finalEvidence.minimumAcceptedOutputs
  ) {
    errors.push("final comparable target cannot produce the required accepted outputs");
  }
  const checkpoints = targets.learningCurve.liveProductCheckpoints;
  if (
    checkpoints.length === 0 ||
    checkpoints.some((value, index) => value <= 0 || (index > 0 && value <= checkpoints[index - 1]!))
  ) {
    errors.push("learning-curve checkpoints must be positive and strictly increasing");
  }
  return errors;
}

export function isPointerReadyAnnotationProduct(
  product: CorpusAnnotation["products"][number]
): boolean {
  if (!product.fieldEvidence?.title?.length) return false;
  if (!product.comparable) return Boolean(product.abstainReason);
  if (
    product.currentPriceCents === undefined ||
    !product.fieldEvidence.currentPrice?.length
  ) {
    return false;
  }
  const nativeReady =
    Boolean(product.nativeUnitPrice) &&
    Boolean(product.fieldEvidence.nativeUnitPrice?.length);
  const quantityReady =
    Boolean(product.packageQuantity) &&
    Boolean(product.fieldEvidence.packageQuantity?.length);
  return nativeReady || quantityReady;
}

export function evidenceMode(
  product: CorpusAnnotation["products"][number]
): "native-only" | "derived-only" | "native-and-derived" | "none" {
  const native = Boolean(product.nativeUnitPrice);
  const derived = Boolean(product.packageQuantity);
  if (native && derived) return "native-and-derived";
  if (native) return "native-only";
  if (derived) return "derived-only";
  return "none";
}

export function compareCohortToTarget(
  actual: IdealCohortActual,
  target: IdealCohortTarget
): Array<{ metric: string; actual: number; target: number }> {
  const dualReviewRate = actual.pages > 0 ? actual.dualReviewedPages / actual.pages : 0;
  const pointerReadyRate =
    actual.products > 0 ? actual.pointerReadyProducts / actual.products : 0;
  return [
    ["domains", actual.domains.size, target.minimumDomains],
    ["pages", actual.pages, target.minimumPages],
    ["products", actual.products, target.minimumProducts],
    ["comparable", actual.comparable, target.minimumComparable],
    ["abstentions", actual.abstentions, target.minimumAbstentions],
    ["strata", actual.strata.size, target.minimumStrata],
    ["categories", actual.categories.size, target.minimumCategories],
    ["dualReviewRate", dualReviewRate, target.requiredDualReviewRate],
    ["pointerReadyRate", pointerReadyRate, target.requiredPointerReadyRate]
  ]
    .filter(([, actualValue, targetValue]) => Number(actualValue) < Number(targetValue))
    .map(([metric, actualValue, targetValue]) => ({
      metric: String(metric),
      actual: Number(actualValue),
      target: Number(targetValue)
    }));
}

export function compareDistributionToTargets(
  actual: IdealCohortActual,
  targets: IdealDatasetTargets["distribution"]
): Array<{ metric: string; actual: number; target: number }> {
  const gaps: Array<{ metric: string; actual: number; target: number }> = [];
  for (const [dimension, target] of Object.entries(
    targets.minimumComparableDimensionShares
  )) {
    const actualShare = actual.comparable > 0
      ? (actual.dimensions[dimension] ?? 0) / actual.comparable
      : 0;
    if (actualShare < target) {
      gaps.push({ metric: `dimensionShare.${dimension}`, actual: actualShare, target });
    }
  }
  for (const [mode, target] of Object.entries(targets.minimumEvidenceModeShares)) {
    const actualShare = actual.comparable > 0
      ? (actual.evidenceModes[mode] ?? 0) / actual.comparable
      : 0;
    if (actualShare < target) {
      gaps.push({ metric: `evidenceModeShare.${mode}`, actual: actualShare, target });
    }
  }
  const narrowShare = actual.pages > 0 ? actual.narrowViewportPages / actual.pages : 0;
  if (narrowShare < targets.minimumNarrowViewportShare) {
    gaps.push({
      metric: "narrowViewportShare",
      actual: narrowShare,
      target: targets.minimumNarrowViewportShare
    });
  }
  return gaps;
}

export function compareDevelopmentChallenges(
  training: IdealCohortActual,
  validation: IdealCohortActual,
  targets: IdealDatasetTargets["distribution"]
): Array<{ metric: string; actual: number; target: number }> {
  const gaps: Array<{ metric: string; actual: number; target: number }> = [];
  for (const [challenge, target] of Object.entries(
    targets.minimumProductChallengeCounts
  )) {
    const actual =
      (training.productChallengeCounts[challenge] ?? 0) +
      (validation.productChallengeCounts[challenge] ?? 0);
    if (actual < target) gaps.push({ metric: `productChallenge.${challenge}`, actual, target });
  }
  for (const [challenge, target] of Object.entries(
    targets.minimumPageChallengeCounts
  )) {
    const actual =
      (training.pageChallengeCounts[challenge] ?? 0) +
      (validation.pageChallengeCounts[challenge] ?? 0);
    if (actual < target) gaps.push({ metric: `pageChallenge.${challenge}`, actual, target });
  }
  const dates = new Map<string, Set<string>>();
  for (const cohort of [training, validation]) {
    for (const [domain, cohortDates] of cohort.captureDatesByDomain) {
      const merged = dates.get(domain) ?? new Set<string>();
      for (const date of cohortDates) merged.add(date);
      dates.set(domain, merged);
    }
  }
  const temporalDomains = [...dates.values()].filter(
    (values) => values.size >= targets.minimumCapturesPerTemporalDomain
  ).length;
  if (temporalDomains < targets.minimumTemporalDomains) {
    gaps.push({
      metric: "temporalDomains",
      actual: temporalDomains,
      target: targets.minimumTemporalDomains
    });
  }
  return gaps;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
