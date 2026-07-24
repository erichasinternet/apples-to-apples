import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface Prediction {
  id: string;
  pageId: string;
  siteId: string;
  prediction: string;
  visualReview?: {
    cardNodeIds: string[];
    boxes: number;
    invalidBoxes: number;
    unmappedBoxes: number;
    duplicateMappings: number;
  };
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-heldout"
);
const outputPath = path.resolve(
  process.argv[3] ?? "benchmarks/reviews/heldout-2026-07-24-reviewer-b.json"
);
const [raw, mapped] = await Promise.all([
  readJsonl<Prediction>(path.join(bundle, "qwen-review.jsonl")),
  readJsonl<Prediction>(path.join(bundle, "qwen-review-mapped.jsonl"))
]);
const mappedById = new Map(mapped.map((prediction) => [prediction.id, prediction]));
const pages = new Map<
  string,
  {
    pageId: string;
    siteId: string;
    productCardNodeIds: Set<string>;
    records: Array<Record<string, unknown>>;
  }
>();

for (const prediction of raw) {
  const mappedPrediction = mappedById.get(prediction.id);
  if (!mappedPrediction?.visualReview) {
    throw new Error(`${prediction.id}: missing mapped visual review`);
  }
  const page = pages.get(prediction.pageId) ?? {
    pageId: prediction.pageId,
    siteId: prediction.siteId,
    productCardNodeIds: new Set<string>(),
    records: []
  };
  for (const nodeId of mappedPrediction.visualReview.cardNodeIds) {
    page.productCardNodeIds.add(nodeId);
  }
  page.records.push({
    id: prediction.id,
    rawPrediction: prediction.prediction,
    mapping: mappedPrediction.visualReview
  });
  pages.set(prediction.pageId, page);
}

const artifact = {
  version: 1,
  runId: raw[0]?.id.split("--")[0],
  reviewer: {
    type: "independent-visual-model",
    modelId: "Qwen/Qwen3-VL-2B-Instruct",
    reviewPromptVersion: 2
  },
  reviewType: "independent-visual-plus-deterministic-mapping",
  eligibleForTraining: false,
  policy:
    "The model saw screenshot crops only. Visual boxes were mapped by the frozen IoU policy. Mapping disagreement requires adjudication before any node ID is used as gold.",
  pages: [...pages.values()]
    .sort((left, right) => left.pageId.localeCompare(right.pageId))
    .map((page) => ({
      pageId: page.pageId,
      siteId: page.siteId,
      productCardNodeIds: [...page.productCardNodeIds].sort(),
      records: page.records
    }))
};
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      pages: artifact.pages.length,
      mappedRoots: artifact.pages.reduce(
        (sum, page) => sum + page.productCardNodeIds.length,
        0
      ),
      records: raw.length
    },
    null,
    2
  )}\n`
);

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
