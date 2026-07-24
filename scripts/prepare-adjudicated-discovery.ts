import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import type { T5TrainingRecord } from "./t5-training-lib";

interface Review {
  reviewType: string;
  eligibleForTraining: boolean;
  eligibleForBenchmarkGold: boolean;
  retiredFromValidation: boolean;
  pages: Array<{
    pageId: string;
    siteId: string;
    productCardNodeIds: string[];
  }>;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    observationPath: string;
    imagePath: string;
  }>;
}

const syntheticDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-synthetic"
);
const bundleDirectory = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-live"
);
const reviewPath = path.resolve(
  process.argv[3] ??
    "benchmarks/reviews/development-2026-07-23-adjudicated.json"
);
const outputDirectory = path.resolve(
  process.argv[4] ??
    "benchmark-data/training/t5gemma2-adjudicated-discovery"
);

const [review, bundleManifest, inputs, syntheticTrain, syntheticValidation] =
  await Promise.all([
    readJson<Review>(reviewPath),
    readJson<BundleManifest>(path.join(bundleDirectory, "manifest.json")),
    readJsonl<T5TrainingRecord>(path.join(bundleDirectory, "discovery.jsonl")),
    readJsonl<T5TrainingRecord>(path.join(syntheticDirectory, "train.jsonl")),
    readJsonl<T5TrainingRecord>(
      path.join(syntheticDirectory, "validation.jsonl")
    )
  ]);

if (
  review.reviewType !== "adjudicated-development" ||
  !review.eligibleForTraining ||
  review.eligibleForBenchmarkGold ||
  !review.retiredFromValidation
) {
  throw new Error(
    "Review must be adjudicated, training-only, and retired from validation."
  );
}
const reviewPages = new Map(review.pages.map((page) => [page.pageId, page]));
if (
  reviewPages.size !== bundleManifest.pages.length ||
  bundleManifest.pages.some((page) => !reviewPages.has(page.pageId))
) {
  throw new Error("Review must cover every inference-bundle page exactly once.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
await cp(path.join(syntheticDirectory, "assets"), path.join(outputDirectory, "assets"), {
  recursive: true
});

const observations = new Map<string, PageObservation>();
for (const page of bundleManifest.pages) {
  observations.set(
    page.pageId,
    await readJson<PageObservation>(
      path.join(bundleDirectory, page.observationPath)
    )
  );
  await copyFile(
    path.join(bundleDirectory, page.imagePath),
    path.join(outputDirectory, page.imagePath)
  );
}

const adjudicatedRecords: T5TrainingRecord[] = [];
const assignedRoots = new Map<string, number>();
for (const input of inputs) {
  const reviewedPage = reviewPages.get(input.pageId);
  const observation = observations.get(input.pageId);
  if (!reviewedPage || !observation) {
    throw new Error(`${input.id}: missing adjudicated page or observation`);
  }
  const nodes = new Map(observation.nodes.map((node) => [node.id, node]));
  const region = input.metadata.sourceRegion;
  const cardNodeIds = reviewedPage.productCardNodeIds.filter((nodeId) => {
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`${input.pageId}: unknown reviewed root ${nodeId}`);
    const centerY = node.bounds.y + node.bounds.height / 2;
    return centerY >= region.y && centerY < region.y + region.height;
  });
  for (const nodeId of cardNodeIds) {
    if (!input.prompt.includes(`"id":"${nodeId}"`)) {
      throw new Error(`${input.id}: prompt pruning removed reviewed root ${nodeId}`);
    }
    const key = `${input.pageId}:${nodeId}`;
    assignedRoots.set(key, (assignedRoots.get(key) ?? 0) + 1);
  }
  adjudicatedRecords.push({
    ...input,
    captureId: `adjudicated-${input.captureId}`,
    split: "train",
    target: JSON.stringify({
      version: 1,
      pageId: input.pageId,
      cardNodeIds
    }),
    metadata: {
      ...input.metadata,
      cardCount: cardNodeIds.length,
      abstainedProducts: 0
    }
  });
}

for (const page of review.pages) {
  for (const nodeId of page.productCardNodeIds) {
    const count = assignedRoots.get(`${page.pageId}:${nodeId}`) ?? 0;
    if (count !== 1) {
      throw new Error(
        `${page.pageId}:${nodeId} must be assigned to exactly one chunk; got ${count}`
      );
    }
  }
}

const train = [
  ...adjudicatedRecords,
  ...syntheticTrain.filter((record) => record.task === "discover-products")
];
const validation = syntheticValidation.filter(
  (record) => record.task === "discover-products"
);
const trainDomains = new Set(train.map((record) => record.siteId));
const validationDomains = new Set(validation.map((record) => record.siteId));
const overlap = [...trainDomains].filter((siteId) => validationDomains.has(siteId));
if (overlap.length > 0) {
  throw new Error(`Train/validation domain overlap: ${overlap.join(", ")}`);
}

const trainText = serializeJsonl(train);
const validationText = serializeJsonl(validation);
await Promise.all([
  writeFile(path.join(outputDirectory, "train.jsonl"), trainText, "utf8"),
  writeFile(path.join(outputDirectory, "validation.jsonl"), validationText, "utf8")
]);

const referencedAssets = new Set(
  [...train, ...validation].map((record) => record.imagePath)
);
const assets = [];
for (const relativePath of [...referencedAssets].sort()) {
  assets.push({
    path: relativePath,
    sha256: createHash("sha256")
      .update(await readFile(path.join(outputDirectory, relativePath)))
      .digest("hex")
  });
}
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  datasetType: "synthetic-plus-adjudicated-real-discovery",
  labelPolicy:
    "Real targets come only from the checked-in adjudicated development review. Synthetic targets are generated from known fixture structure.",
  strict: true,
  allowSingleReview: false,
  pages:
    new Set([...train, ...validation].map((record) => record.pageId)).size,
  domains: [...new Set([...train, ...validation].map((record) => record.siteId))].sort(),
  products: review.pages.reduce(
    (sum, page) => sum + page.productCardNodeIds.length,
    0
  ),
  records: {
    train: train.length,
    validation: validation.length,
    discovery: train.length + validation.length,
    extraction: 0
  },
  files: { train: "train.jsonl", validation: "validation.jsonl" },
  assets,
  adjudicated: {
    reviewPath: path.relative(process.cwd(), reviewPath),
    retiredDomains: review.pages.map((page) => page.siteId).sort(),
    trainRecords: adjudicatedRecords.length,
    roots: assignedRoots.size
  },
  sha256: createHash("sha256")
    .update(trainText)
    .update(validationText)
    .digest("hex")
};
await writeFile(
  path.join(outputDirectory, "dataset-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify(
    {
      outputDirectory,
      trainRecords: train.length,
      validationRecords: validation.length,
      adjudicatedRecords: adjudicatedRecords.length,
      adjudicatedRoots: assignedRoots.size,
      sha256: manifest.sha256
    },
    null,
    2
  )}\n`
);

function serializeJsonl(values: unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
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
