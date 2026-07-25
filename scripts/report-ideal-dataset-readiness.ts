import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CorpusAnnotation } from "./live-corpus-lib";
import {
  compareCohortToTarget,
  compareDevelopmentChallenges,
  compareDistributionToTargets,
  compareReviewQualityToTargets,
  emptyIdealCohortActual,
  evidenceMode,
  isPointerReadyAnnotationProduct,
  resolveIdealCohort,
  validateIdealDatasetTargets,
  validateIdealDomainSplits,
  type IdealDomainSplits,
  type IdealCohortName,
  type IdealDatasetTargets
} from "./ideal-dataset-lib";

interface PageMetadata {
  pageId: string;
  capturedAt: string;
  viewport: {
    width: number;
  };
  observationSha256?: string;
  target: {
    id: string;
    siteId: string;
    stratum: string;
  };
}

const captureRoot = path.resolve(process.argv[2] ?? "benchmark-data/live");
const [targets, domainSplits] = await Promise.all([
  readJson<IdealDatasetTargets>(path.resolve("benchmarks/ideal-dataset-targets.json")),
  readJson<IdealDomainSplits>(path.resolve("benchmarks/ideal-domain-splits.json"))
]);
const targetErrors = validateIdealDatasetTargets(targets);
if (targetErrors.length > 0) {
  throw new Error(`Invalid ideal dataset targets:\n${targetErrors.join("\n")}`);
}
const splitErrors = validateIdealDomainSplits(domainSplits);
if (splitErrors.length > 0) {
  throw new Error(`Invalid ideal domain splits:\n${splitErrors.join("\n")}`);
}

const actual = {
  training: emptyIdealCohortActual(),
  validation: emptyIdealCohortActual(),
  selection: emptyIdealCohortActual(),
  final: emptyIdealCohortActual()
};
let retiredOpenedPages = 0;
let unreadableCaptures = 0;
const observationSources = new Map<
  string,
  Array<{ cohort: IdealCohortName; pageId: string }>
>();
const productTitleSources = new Map<
  string,
  Array<{ cohort: IdealCohortName; pageId: string; nodeId: string }>
>();
const annotationFiles = await findFiles(captureRoot, "annotation.json");

for (const annotationFile of annotationFiles) {
  const pageDirectory = path.dirname(annotationFile);
  let annotation: CorpusAnnotation;
  let page: PageMetadata;
  try {
    [annotation, page] = await Promise.all([
      readJson<CorpusAnnotation>(annotationFile),
      readJson<PageMetadata>(path.join(pageDirectory, "page.json"))
    ]);
  } catch {
    unreadableCaptures += 1;
    continue;
  }
  const cohort = resolveIdealCohort(page.target.siteId, domainSplits);
  if (!cohort || cohort === "retired") {
    retiredOpenedPages += 1;
    continue;
  }
  const accumulator = actual[cohort];
  if (page.observationSha256) {
    const sources = observationSources.get(page.observationSha256) ?? [];
    sources.push({ cohort, pageId: page.pageId });
    observationSources.set(page.observationSha256, sources);
  }
  accumulator.domains.add(page.target.siteId);
  accumulator.strata.add(page.target.stratum);
  accumulator.categories.add(page.target.id);
  accumulator.pages += 1;
  if (page.viewport.width <= 768) accumulator.narrowViewportPages += 1;
  const captureDate = page.capturedAt.slice(0, 10);
  const dates = accumulator.captureDatesByDomain.get(page.target.siteId) ?? new Set();
  dates.add(captureDate);
  accumulator.captureDatesByDomain.set(page.target.siteId, dates);
  for (const tag of annotation.pageTags ?? []) {
    increment(accumulator.pageChallengeCounts, tag);
  }
  if (
    annotation.reviewStatus === "adjudicated" &&
    annotation.coverage === "complete-main-region" &&
    annotation.annotators.length >= 3 &&
    annotation.reviewProvenance
  ) {
    accumulator.dualReviewedPages += 1;
    const agreement = annotation.reviewProvenance.agreement;
    accumulator.reviewAgreement.alignedCards += agreement.alignedCards;
    accumulator.reviewAgreement.priceMatches += agreement.matches.price;
    accumulator.reviewAgreement.quantityMatches += agreement.matches.quantity;
    accumulator.reviewAgreement.dimensionMatches += agreement.matches.dimension;
    accumulator.reviewAgreement.pointerMatches += agreement.matches.pointer;
    accumulator.reviewAgreement.bothComparable +=
      agreement.comparableConfusion.bothComparable;
    accumulator.reviewAgreement.reviewerAOnly +=
      agreement.comparableConfusion.reviewerAOnly;
    accumulator.reviewAgreement.reviewerBOnly +=
      agreement.comparableConfusion.reviewerBOnly;
    accumulator.reviewAgreement.bothAbstain +=
      agreement.comparableConfusion.bothAbstain;
  }
  increment(accumulator.productCountsByDomain, page.target.siteId, annotation.products.length);
  increment(accumulator.productCountsByPage, page.pageId, annotation.products.length);
  for (const product of annotation.products) {
    const titleHash = normalizedTextHash(product.title);
    const titleSources = productTitleSources.get(titleHash) ?? [];
    titleSources.push({ cohort, pageId: page.pageId, nodeId: product.nodeId });
    productTitleSources.set(titleHash, titleSources);
    accumulator.products += 1;
    if (product.comparable) accumulator.comparable += 1;
    else accumulator.abstentions += 1;
    if (isPointerReadyAnnotationProduct(product)) accumulator.pointerReadyProducts += 1;
    for (const tag of product.challengeTags ?? []) {
      increment(accumulator.productChallengeCounts, tag);
    }
    if (product.comparable) {
      const dimension =
        product.expectedNormalized?.dimension ??
        product.packageQuantity?.dimension ??
        product.nativeUnitPrice?.dimension ??
        "missing";
      increment(accumulator.dimensions, dimension);
      increment(accumulator.evidenceModes, evidenceMode(product));
    }
  }
}

const exactObservationDuplicates = crossCohortGroups(observationSources);
const normalizedProductDuplicates = crossCohortGroups(productTitleSources);
const totalProducts = Object.values(actual).reduce(
  (sum, cohort) => sum + cohort.products,
  0
);
const contaminatedProducts = normalizedProductDuplicates.reduce(
  (sum, group) => sum + group.sources.length,
  0
);
const crossCohortDuplicateRate =
  totalProducts > 0 ? contaminatedProducts / totalProducts : 0;
const contaminationGaps =
  exactObservationDuplicates.length > 0 ||
  crossCohortDuplicateRate > targets.quality.maximumCrossCohortDuplicateRate
    ? [
        {
          metric: "crossCohortDuplicateRate",
          actual: crossCohortDuplicateRate,
          target: targets.quality.maximumCrossCohortDuplicateRate
        }
      ]
    : [];

const report = {
  version: 1,
  scope: targets.scope,
  domainRegistry: {
    training: domainSplits.training.length,
    validation: domainSplits.validation.length,
    selection: domainSplits.selection.length,
    final: domainSplits.final.length,
    retired: domainSplits.retired.length
  },
  captureRoot,
  annotationFiles: annotationFiles.length,
  retiredOpenedPages,
  unreadableCaptures,
  contamination: {
    exactObservationDuplicates,
    normalizedProductDuplicates,
    crossCohortDuplicateRate,
    gaps: contaminationGaps
  },
  ready: false,
  cohorts: Object.fromEntries(
    (Object.keys(actual) as IdealCohortName[]).map((cohort) => {
      const value = actual[cohort];
      const gaps = compareCohortToTarget(value, targets.cohorts[cohort]);
      return [
        cohort,
        {
          actual: {
            domains: value.domains.size,
            strata: value.strata.size,
            categories: value.categories.size,
            pages: value.pages,
            narrowViewportPages: value.narrowViewportPages,
            products: value.products,
            comparable: value.comparable,
            abstentions: value.abstentions,
            dualReviewedPages: value.dualReviewedPages,
            pointerReadyProducts: value.pointerReadyProducts,
            dimensions: value.dimensions,
            evidenceModes: value.evidenceModes,
            reviewAgreement: value.reviewAgreement,
            productChallengeCounts: value.productChallengeCounts,
            pageChallengeCounts: value.pageChallengeCounts
          },
          target: targets.cohorts[cohort],
          gaps: [
            ...gaps,
            ...compareDistributionToTargets(value, targets.distribution),
            ...compareReviewQualityToTargets(value, targets.quality)
          ]
        }
      ];
    })
  ),
  developmentChallengeGaps: compareDevelopmentChallenges(
    actual.training,
    actual.validation,
    targets.distribution
  )
};
report.ready =
  Object.values(report.cohorts).every((cohort) => cohort.gaps.length === 0) &&
  report.developmentChallengeGaps.length === 0 &&
  report.contamination.gaps.length === 0;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;

async function findFiles(directory: string, basename: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(filename, basename)));
    else if (entry.name === basename) files.push(filename);
  }
  return files.sort();
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function increment(
  counts: Record<string, number>,
  key: string,
  amount = 1
): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

function normalizedTextHash(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function crossCohortGroups<T extends { cohort: IdealCohortName }>(
  groups: Map<string, T[]>
): Array<{ sha256: string; cohorts: IdealCohortName[]; sources: T[] }> {
  return [...groups.entries()]
    .map(([sha256, sources]) => ({
      sha256,
      cohorts: [...new Set(sources.map((source) => source.cohort))].sort(),
      sources
    }))
    .filter((group) => group.cohorts.length > 1)
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
}
