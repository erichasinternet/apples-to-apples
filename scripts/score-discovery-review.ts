import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";

interface Prediction {
  pageId: string;
  siteId: string;
  prediction: string;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    observationPath: string;
  }>;
}

interface Review {
  runId: string;
  reviewType: string;
  eligibleForTraining: boolean;
  pages: Array<{
    pageId: string;
    siteId: string;
    productCardNodeIds: string[];
  }>;
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-heldout"
);
const predictionsPath = path.resolve(
  process.argv[3] ??
    path.join(bundle, "discovery-predictions-balanced-real-adapted.jsonl")
);
const reviewPath = path.resolve(
  process.argv[4] ?? "benchmarks/reviews/heldout-2026-07-24-reviewer-a.json"
);
const outputPath = path.resolve(
  process.argv[5] ?? path.join(bundle, "discovery-review-a-score.json")
);
const manifest = await readJson<BundleManifest>(path.join(bundle, "manifest.json"));
const predictions = await readJsonl<Prediction>(predictionsPath);
const review = await readJson<Review>(reviewPath);
if (review.eligibleForTraining) {
  throw new Error("A non-adjudicated review cannot be marked training-eligible.");
}
const reviewedPageIds = new Set(review.pages.map((page) => page.pageId));
const manifestPageIds = new Set(manifest.pages.map((page) => page.pageId));
if (
  reviewedPageIds.size !== review.pages.length ||
  reviewedPageIds.size !== manifestPageIds.size ||
  [...manifestPageIds].some((pageId) => !reviewedPageIds.has(pageId))
) {
  throw new Error("Review must cover every bundle page exactly once.");
}

const predictionsByPage = new Map<string, string[]>();
let malformedPredictions = 0;
let duplicateIds = 0;
for (const prediction of predictions) {
  const parsed = parseJsonPrefix(prediction.prediction);
  if (
    !parsed ||
    parsed.version !== 1 ||
    parsed.pageId !== prediction.pageId ||
    !Array.isArray(parsed.cardNodeIds)
  ) {
    malformedPredictions += 1;
    continue;
  }
  const values = parsed.cardNodeIds.filter(
    (value): value is string => typeof value === "string"
  );
  duplicateIds += values.length - new Set(values).size;
  const pageValues = predictionsByPage.get(prediction.pageId) ?? [];
  pageValues.push(...values);
  predictionsByPage.set(prediction.pageId, pageValues);
}

const pages = [];
let predicted = 0;
let reference = 0;
let truePositive = 0;
let unknownIds = 0;
for (const reviewedPage of review.pages) {
  const page = manifest.pages.find((candidate) => candidate.pageId === reviewedPage.pageId);
  if (!page) throw new Error(`Review references unknown page ${reviewedPage.pageId}`);
  const observation = await readJson<PageObservation>(
    path.join(bundle, page.observationPath)
  );
  const knownIds = new Set(observation.nodes.map((node) => node.id));
  const unknownReferences = reviewedPage.productCardNodeIds.filter(
    (nodeId) => !knownIds.has(nodeId)
  );
  if (unknownReferences.length > 0) {
    throw new Error(
      `${page.pageId}: review references unknown nodes ${unknownReferences.join(", ")}`
    );
  }
  const rawPredictions = new Set(predictionsByPage.get(page.pageId) ?? []);
  const knownPredictions = new Set(
    [...rawPredictions].filter((nodeId) => knownIds.has(nodeId))
  );
  const references = new Set(reviewedPage.productCardNodeIds);
  const truePositives = [...knownPredictions].filter((nodeId) =>
    references.has(nodeId)
  ).length;
  const pageUnknownIds = [...rawPredictions].filter(
    (nodeId) => !knownIds.has(nodeId)
  ).length;
  predicted += knownPredictions.size;
  reference += references.size;
  truePositive += truePositives;
  unknownIds += pageUnknownIds;
  pages.push({
    pageId: page.pageId,
    siteId: page.siteId,
    predicted: knownPredictions.size,
    reference: references.size,
    truePositive: truePositives,
    falsePositive: knownPredictions.size - truePositives,
    falseNegative: references.size - truePositives,
    unknownIds: pageUnknownIds,
    precision: divide(truePositives, knownPredictions.size),
    recall: divide(truePositives, references.size)
  });
}

const precision = divide(truePositive, predicted);
const recall = divide(truePositive, reference);
const report = {
  version: 1,
  review: {
    path: path.relative(process.cwd(), reviewPath),
    reviewType: review.reviewType,
    eligibleForTraining: review.eligibleForTraining
  },
  note:
    "Single-review metrics are diagnostic only. Duplicate and unknown IDs are rejected before scoring, matching the extraction-prompt safety gate.",
  counts: {
    predictions: predictions.length,
    malformedPredictions,
    duplicateIds,
    unknownIds,
    predicted,
    reference,
    truePositive,
    falsePositive: predicted - truePositive,
    falseNegative: reference - truePositive
  },
  metrics: {
    precision,
    recall,
    f1:
      precision === null || recall === null || precision + recall === 0
        ? null
        : (2 * precision * recall) / (precision + recall)
  },
  pages
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function divide(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function parseJsonPrefix(value: string): Record<string, unknown> | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(value.slice(start, index + 1));
          return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
