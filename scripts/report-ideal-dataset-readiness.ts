import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CorpusAnnotation, CorpusDomainSplits } from "./live-corpus-lib";
import {
  compareCohortToTarget,
  compareDevelopmentChallenges,
  compareDistributionToTargets,
  emptyIdealCohortActual,
  evidenceMode,
  isPointerReadyAnnotationProduct,
  validateIdealDatasetTargets,
  type IdealCohortName,
  type IdealDatasetTargets
} from "./ideal-dataset-lib";
import type { TrainingDomainSplits } from "./t5-training-lib";

interface PageMetadata {
  capturedAt: string;
  viewport: {
    width: number;
  };
  target: {
    id: string;
    siteId: string;
    stratum: string;
  };
}

const captureRoot = path.resolve(process.argv[2] ?? "benchmark-data/live");
const [targets, domainSplits, trainingSplits] = await Promise.all([
  readJson<IdealDatasetTargets>(path.resolve("benchmarks/ideal-dataset-targets.json")),
  readJson<CorpusDomainSplits>(path.resolve("benchmarks/live-sites/domain-splits.json")),
  readJson<TrainingDomainSplits>(path.resolve("benchmarks/live-sites/training-splits.json"))
]);
const targetErrors = validateIdealDatasetTargets(targets);
if (targetErrors.length > 0) {
  throw new Error(`Invalid ideal dataset targets:\n${targetErrors.join("\n")}`);
}

const actual = {
  training: emptyIdealCohortActual(),
  validation: emptyIdealCohortActual(),
  selection: emptyIdealCohortActual(),
  final: emptyIdealCohortActual()
};
let retiredOpenedPages = 0;
let unreadableCaptures = 0;
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
  const cohort = resolveCohort(page.target.siteId, domainSplits, trainingSplits);
  if (!cohort) {
    retiredOpenedPages += 1;
    continue;
  }
  const accumulator = actual[cohort];
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
    annotation.annotators.length >= 2
  ) {
    accumulator.dualReviewedPages += 1;
  }
  for (const product of annotation.products) {
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

const report = {
  version: 1,
  scope: targets.scope,
  captureRoot,
  annotationFiles: annotationFiles.length,
  retiredOpenedPages,
  unreadableCaptures,
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
            productChallengeCounts: value.productChallengeCounts,
            pageChallengeCounts: value.pageChallengeCounts
          },
          target: targets.cohorts[cohort],
          gaps: [...gaps, ...compareDistributionToTargets(value, targets.distribution)]
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
  report.developmentChallengeGaps.length === 0;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;

function resolveCohort(
  siteId: string,
  splits: CorpusDomainSplits,
  training: TrainingDomainSplits
): IdealCohortName | undefined {
  if (training.train.includes(siteId)) return "training";
  if (training.validation.includes(siteId)) return "validation";
  if (splits.selection.includes(siteId)) return "selection";
  // The old held-out cohort was opened during prior research and is retired.
  return undefined;
}

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

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
