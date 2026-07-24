import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import type { T5InferenceRecord } from "./t5-training-lib";

interface Prediction {
  id: string;
  pageId: string;
  siteId: string;
  prediction: string;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    sourceDirectory: string;
    observationPath: string;
  }>;
}

interface Candidate {
  nodeId: string;
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-live"
);
const predictionsPath = path.resolve(
  process.argv[3] ?? path.join(bundle, "discovery-predictions.jsonl")
);
const outputPath = path.resolve(
  process.argv[4] ?? path.join(bundle, "discovery-analysis.json")
);
const checkpoint = process.argv[5] ?? "synthetic-pilot-60-replay";
const manifest = await readJson<BundleManifest>(path.join(bundle, "manifest.json"));
const records = await readJsonl<T5InferenceRecord>(path.join(bundle, "discovery.jsonl"));
const predictions = await readJsonl<Prediction>(predictionsPath);
const predictionsById = new Map(predictions.map((prediction) => [prediction.id, prediction]));
const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
const pageReferences = new Map<string, Set<string>>();

for (const page of manifest.pages) {
  const cardsDirectory = path.join(page.sourceDirectory, "cards");
  const filenames = await readdir(cardsDirectory).catch(() => []);
  const candidates = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith(".json"))
      .map((filename) => readJson<Candidate>(path.join(cardsDirectory, filename)))
  );
  pageReferences.set(page.pageId, new Set(candidates.map((candidate) => candidate.nodeId)));
}

const slices = new Map<
  string,
  {
    records: number;
    completeJson: number;
    outputTruncations: number;
    duplicateIds: number;
    unknownIds: number;
    predictedIds: number;
    referencedRecords: number;
    referencedPredictedIds: number;
    referenceIds: number;
    truePositiveIds: number;
  }
>();

for (const record of records) {
  const prediction = predictionsById.get(record.id);
  const page = pageMap.get(record.pageId);
  if (!prediction || !page) throw new Error(`Missing prediction or page for ${record.id}`);
  const observation = await readJson<PageObservation>(
    path.join(bundle, page.observationPath)
  );
  const knownIds = new Set(observation.nodes.map((node) => node.id));
  const referenceIds = pageReferences.get(record.pageId) ?? new Set<string>();
  const region = record.metadata.sourceRegion;
  const referencesInRegion = new Set(
    [...referenceIds].filter((nodeId) => {
      const node = observation.nodes.find((entry) => entry.id === nodeId);
      if (!node) return false;
      const centerY = node.bounds.y + node.bounds.height / 2;
      return centerY >= region.y && centerY < region.y + region.height;
    })
  );
  const parsed = parseJsonPrefix(prediction.prediction);
  const predictedIds =
    parsed &&
    parsed.version === 1 &&
    parsed.pageId === record.pageId &&
    Array.isArray(parsed.cardNodeIds)
      ? parsed.cardNodeIds.filter((value): value is string => typeof value === "string")
      : [];
  const uniquePredicted = new Set(predictedIds);
  const values = [
    slices.get("all") ?? emptySlice(),
    slices.get(record.siteId) ?? emptySlice()
  ];
  for (const value of values) {
    value.records += 1;
    value.completeJson += parsed ? 1 : 0;
    value.outputTruncations += parsed ? 0 : 1;
    value.duplicateIds += predictedIds.length - uniquePredicted.size;
    value.unknownIds += [...uniquePredicted].filter((id) => !knownIds.has(id)).length;
    value.predictedIds += uniquePredicted.size;
    if (referencesInRegion.size > 0) {
      value.referencedRecords += 1;
      value.referencedPredictedIds += uniquePredicted.size;
      value.referenceIds += referencesInRegion.size;
      value.truePositiveIds += [...uniquePredicted].filter((id) =>
        referencesInRegion.has(id)
      ).length;
    }
  }
  slices.set("all", values[0]!);
  slices.set(record.siteId, values[1]!);
}

const report = {
  version: 1,
  checkpoint,
  note:
    "Candidate roots are generic collector outputs, not adjudicated gold labels. Precision and recall are weak-label diagnostics only.",
  slices: Object.fromEntries(
    [...slices.entries()].map(([name, value]) => [
      name,
      {
        ...value,
        completeJsonRate: divide(value.completeJson, value.records),
        weakRootPrecision: divide(value.truePositiveIds, value.referencedPredictedIds),
        weakRootRecall: divide(value.truePositiveIds, value.referenceIds),
        weakRootF1: f1(
          value.truePositiveIds,
          value.referencedPredictedIds,
          value.referenceIds
        )
      }
    ])
  )
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

function emptySlice() {
  return {
    records: 0,
    completeJson: 0,
    outputTruncations: 0,
    duplicateIds: 0,
    unknownIds: 0,
    predictedIds: 0,
    referencedRecords: 0,
    referencedPredictedIds: 0,
    referenceIds: 0,
    truePositiveIds: 0
  };
}

function divide(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function f1(
  truePositives: number,
  predicted: number,
  references: number
): number | null {
  const precision = divide(truePositives, predicted);
  const recall = divide(truePositives, references);
  if (precision === null || recall === null || precision + recall === 0) return null;
  return (2 * precision * recall) / (precision + recall);
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
