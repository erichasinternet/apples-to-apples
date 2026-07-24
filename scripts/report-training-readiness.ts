import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  getDomainSplit,
  validateDomainSplits,
  type CorpusAnnotation,
  type CorpusDomainSplits,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import {
  buildT5TrainingRecords,
  getTrainingSplit,
  validateTrainingDomainSplits,
  type TrainingDomainSplits
} from "./t5-training-lib";
import { buildTrainingExample } from "./training-export-lib";

interface RunManifest {
  runId: string;
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

interface PageMetadata {
  target: {
    siteId: string;
  };
}

const runDirectories = process.argv
  .slice(2)
  .filter((arg) => !arg.startsWith("--"))
  .map((directory) => path.resolve(directory));
if (runDirectories.length === 0) {
  throw new Error("Usage: bun run training:readiness -- <run-directory> [...]");
}

const [manifest, domainSplits, trainingSplits] = await Promise.all([
  readJson<CorpusTargetManifest>(path.resolve("benchmarks/live-sites/targets.json")),
  readJson<CorpusDomainSplits>(path.resolve("benchmarks/live-sites/domain-splits.json")),
  readJson<TrainingDomainSplits>(path.resolve("benchmarks/live-sites/training-splits.json"))
]);
const splitErrors = [
  ...validateDomainSplits(manifest, domainSplits),
  ...validateTrainingDomainSplits(domainSplits, trainingSplits)
];
if (splitErrors.length > 0) {
  throw new Error(`Invalid training splits:\n${splitErrors.join("\n")}`);
}

const readyDomains = new Set<string>();
const readyTrainDomains = new Set<string>();
const readyValidationDomains = new Set<string>();
const uniqueReadyPages = new Set<string>();
const blockers: Record<string, number> = {};
const skippedRunDirectories: string[] = [];
let capturedPages = 0;
let readyCaptures = 0;
let products = 0;
let abstainedProducts = 0;
let discoveryRecords = 0;
let extractionRecords = 0;

for (const runDirectory of runDirectories) {
  let run: RunManifest;
  try {
    run = await readJson<RunManifest>(path.join(runDirectory, "run.json"));
  } catch {
    skippedRunDirectories.push(runDirectory);
    increment(blockers, "missing-run-manifest");
    continue;
  }
  for (const result of run.results.filter((entry) => entry.status === "captured")) {
    const pageDirectory = path.join(runDirectory, result.pageId);
    let page: PageMetadata;
    try {
      page = await readJson<PageMetadata>(path.join(pageDirectory, "page.json"));
    } catch {
      increment(blockers, "missing-capture-artifacts");
      continue;
    }
    if (getDomainSplit(page.target.siteId, domainSplits) !== "development") continue;
    capturedPages += 1;
    const split = getTrainingSplit(page.target.siteId, trainingSplits);
    if (!split) {
      increment(blockers, "missing-training-split");
      continue;
    }
    let observation: PageObservation;
    let annotation: CorpusAnnotation;
    try {
      [observation, annotation] = await Promise.all([
        readJson<PageObservation>(path.join(pageDirectory, "observation.json")),
        readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json"))
      ]);
    } catch {
      increment(blockers, "missing-capture-artifacts");
      continue;
    }
    try {
      await readFile(path.join(pageDirectory, "annotation.png"));
    } catch {
      increment(blockers, "missing-training-image");
      continue;
    }
    const built = buildTrainingExample(page.target.siteId, observation, annotation);
    if (!built.example) {
      for (const reason of classifyBlockers(built.errors)) increment(blockers, reason);
      continue;
    }
    const records = buildT5TrainingRecords(built.example, {
      captureId: run.runId,
      split,
      imagePath: "annotation.png"
    });
    readyCaptures += 1;
    readyDomains.add(page.target.siteId);
    if (split === "train") readyTrainDomains.add(page.target.siteId);
    else readyValidationDomains.add(page.target.siteId);
    uniqueReadyPages.add(`${page.target.siteId}/${result.pageId}`);
    products += built.example.target.products.length;
    abstainedProducts += built.example.target.products.filter(
      (product) => product.abstainReason
    ).length;
    discoveryRecords += records.filter((record) => record.task === "discover-products").length;
    extractionRecords += records.filter((record) => record.task === "extract-product").length;
  }
}

const targets = {
  trainingDomains: 24,
  validationDomains: 6,
  uniquePages: 120,
  products: 1500,
  abstainedProducts: 300
};
const actual = {
  capturedDevelopmentPages: capturedPages,
  readyCaptures,
  readyDomains: readyDomains.size,
  trainingDomains: readyTrainDomains.size,
  validationDomains: readyValidationDomains.size,
  uniquePages: uniqueReadyPages.size,
  products,
  abstainedProducts,
  discoveryRecords,
  extractionRecords
};
const unmet = [
  ["trainingDomains", actual.trainingDomains, targets.trainingDomains],
  ["validationDomains", actual.validationDomains, targets.validationDomains],
  ["uniquePages", actual.uniquePages, targets.uniquePages],
  ["products", actual.products, targets.products],
  ["abstainedProducts", actual.abstainedProducts, targets.abstainedProducts]
]
  .filter(([, value, target]) => Number(value) < Number(target))
  .map(([metric, value, target]) => ({ metric, value, target }));
const report = {
  version: 1,
  readyForPilotTraining: unmet.length === 0,
  actual,
  targets,
  unmet,
  blockers,
  skippedRunDirectories
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (unmet.length > 0) process.exitCode = 1;

function classifyBlockers(errors: readonly string[]): string[] {
  const labels = new Set<string>();
  for (const error of errors) {
    if (error.includes("status must be adjudicated")) labels.add("not-adjudicated");
    else if (error.includes("complete-main-region")) labels.add("incomplete-coverage");
    else if (error.includes("two annotators")) labels.add("insufficient-reviewers");
    else if (error.includes("fieldEvidence")) labels.add("missing-field-evidence");
    else if (error.includes("abstainReason")) labels.add("missing-abstention");
    else labels.add("invalid-training-label");
  }
  return [...labels];
}

function increment(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
