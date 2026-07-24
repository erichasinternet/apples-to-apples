import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import type { T5InferenceRecord } from "./t5-training-lib";
import { mapPix2StructMarkup } from "./pix2struct-markup-lib";

interface Prediction {
  id: string;
  task: string;
  captureId: string;
  pageId: string;
  siteId: string;
  prediction: string;
  rawPrediction?: string;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    observationPath: string;
  }>;
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-selection-instacart"
);
const predictionsPath = path.resolve(
  process.argv[3] ??
    path.join(bundle, "discovery-predictions-pix2struct-base-compact-boxes.jsonl")
);
const outputPath = path.resolve(
  process.argv[4] ??
    path.join(bundle, "discovery-predictions-pix2struct-base-markup-mapped.jsonl")
);
const reportPath = outputPath.replace(/\.jsonl$/, "-report.json");
const [manifest, records, predictions] = await Promise.all([
  readJson<BundleManifest>(path.join(bundle, "manifest.json")),
  readJsonl<T5InferenceRecord>(path.join(bundle, "discovery.jsonl")),
  readJsonl<Prediction>(predictionsPath)
]);
const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
const recordMap = new Map(records.map((record) => [record.id, record]));
const observations = new Map<string, PageObservation>();
const mappedPredictions = [];
const counts = {
  predictions: predictions.length,
  titleCandidates: 0,
  matchedTitles: 0,
  unmatchedTitles: 0,
  duplicateMappings: 0,
  mappedCardNodeIds: 0
};

for (const prediction of predictions) {
  const record = recordMap.get(prediction.id);
  const page = pageMap.get(prediction.pageId);
  if (!record || !page) throw new Error(`${prediction.id}: missing record or page`);
  let observation = observations.get(page.pageId);
  if (!observation) {
    observation = await readJson<PageObservation>(
      path.join(bundle, page.observationPath)
    );
    observations.set(page.pageId, observation);
  }
  const mapping = mapPix2StructMarkup(
    prediction.rawPrediction ?? prediction.prediction,
    record.metadata.sourceRegion,
    observation
  );
  counts.titleCandidates += mapping.titleCandidates;
  counts.matchedTitles += mapping.matchedTitles;
  counts.unmatchedTitles += mapping.unmatchedTitles;
  counts.duplicateMappings += mapping.duplicateMappings;
  counts.mappedCardNodeIds += mapping.cardNodeIds.length;
  mappedPredictions.push({
    ...prediction,
    prediction: JSON.stringify({
      version: 1,
      pageId: prediction.pageId,
      cardNodeIds: mapping.cardNodeIds
    }),
    pix2structMarkup: mapping
  });
}

await writeFile(
  outputPath,
  mappedPredictions.map((prediction) => JSON.stringify(prediction)).join("\n") + "\n",
  "utf8"
);
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      version: 1,
      modelId: "google/pix2struct-base",
      mappingPolicy:
        "generated img_alt text to DOM evidence similarity >= 0.58, then semantic or isolated repeated outer root",
      counts
    },
    null,
    2
  )}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(counts, null, 2)}\n`);

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
