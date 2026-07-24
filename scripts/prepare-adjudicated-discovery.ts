import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  buildT5DiscoveryRecords,
  type T5TrainingRecord
} from "./t5-training-lib";

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
    captureId: string;
    pageId: string;
    siteId: string;
    observationPath: string;
    imagePath: string;
  }>;
}

interface SourceSpec {
  bundleDirectory: string;
  reviewPath: string;
}

const syntheticDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-synthetic"
);
const { sourceSpecs, outputDirectory } = await parseOptions(process.argv.slice(2));
const [syntheticTrain, syntheticValidation] = await Promise.all([
  readJsonl<T5TrainingRecord>(path.join(syntheticDirectory, "train.jsonl")),
  readJsonl<T5TrainingRecord>(
    path.join(syntheticDirectory, "validation.jsonl")
  )
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
await cp(path.join(syntheticDirectory, "assets"), path.join(outputDirectory, "assets"), {
  recursive: true
});

const observations = new Map<string, PageObservation>();
const adjudicatedRecords: T5TrainingRecord[] = [];
const assignedRoots = new Map<string, number>();
const reviewedPages: Review["pages"] = [];
const sourceManifests: Array<{
  bundleDirectory: string;
  reviewPath: string;
  pages: number;
  trainRecords: number;
  roots: number;
}> = [];

for (const source of sourceSpecs) {
  const bundleDirectory = path.resolve(source.bundleDirectory);
  const reviewPath = path.resolve(source.reviewPath);
  const [review, bundleManifest] = await Promise.all([
    readJson<Review>(reviewPath),
    readJson<BundleManifest>(path.join(bundleDirectory, "manifest.json"))
  ]);
  validateReview(review, bundleManifest, reviewPath);
  const reviewPages = new Map(review.pages.map((page) => [page.pageId, page]));
  const sourceRootsBefore = assignedRoots.size;
  const sourceRecordsBefore = adjudicatedRecords.length;

  const inputs = [];
  for (const page of bundleManifest.pages) {
    if (observations.has(page.pageId)) {
      throw new Error(`${page.pageId}: duplicate page across adjudicated sources`);
    }
    const observation = await readJson<PageObservation>(
      path.join(bundleDirectory, page.observationPath)
    );
    observations.set(page.pageId, observation);
    await copyFile(
      path.join(bundleDirectory, page.imagePath),
      path.join(outputDirectory, page.imagePath)
    );
    inputs.push(
      ...buildT5DiscoveryRecords(observation, {
        captureId: page.captureId,
        pageId: page.pageId,
        siteId: page.siteId,
        imagePath: page.imagePath,
        requiredDiscoveryNodeIds:
          reviewPages.get(page.pageId)?.productCardNodeIds ?? []
      })
    );
  }

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
      if (!node) {
        throw new Error(`${input.pageId}: unknown reviewed root ${nodeId}`);
      }
      const centerY = node.bounds.y + node.bounds.height / 2;
      return centerY >= region.y && centerY < region.y + region.height;
    });
    for (const nodeId of cardNodeIds) {
      if (!input.prompt.includes(`"id":"${nodeId}"`)) {
        throw new Error(
          `${input.id}: prompt pruning removed reviewed root ${nodeId}`
        );
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
  reviewedPages.push(...review.pages);
  sourceManifests.push({
    bundleDirectory: path.relative(process.cwd(), bundleDirectory),
    reviewPath: path.relative(process.cwd(), reviewPath),
    pages: review.pages.length,
    trainRecords: adjudicatedRecords.length - sourceRecordsBefore,
    roots: assignedRoots.size - sourceRootsBefore
  });
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
    "Real targets come only from checked-in adjudicated development reviews. Synthetic targets are generated from known fixture structure.",
  strict: true,
  allowSingleReview: false,
  pages:
    new Set([...train, ...validation].map((record) => record.pageId)).size,
  domains: [...new Set([...train, ...validation].map((record) => record.siteId))].sort(),
  products: reviewedPages.reduce(
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
    sources: sourceManifests,
    retiredDomains: [...new Set(reviewedPages.map((page) => page.siteId))].sort(),
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

function validateReview(
  review: Review,
  bundleManifest: BundleManifest,
  reviewPath: string
): void {
  if (
    review.reviewType !== "adjudicated-development" ||
    !review.eligibleForTraining ||
    review.eligibleForBenchmarkGold ||
    !review.retiredFromValidation
  ) {
    throw new Error(
      `${reviewPath}: review must be adjudicated, training-only, and retired from validation`
    );
  }
  const reviewPages = new Map(review.pages.map((page) => [page.pageId, page]));
  if (
    reviewPages.size !== review.pages.length ||
    reviewPages.size !== bundleManifest.pages.length ||
    bundleManifest.pages.some((page) => !reviewPages.has(page.pageId))
  ) {
    throw new Error(
      `${reviewPath}: review must cover every inference-bundle page exactly once`
    );
  }
}

async function parseOptions(args: string[]): Promise<{
  sourceSpecs: SourceSpec[];
  outputDirectory: string;
}> {
  if (!args.includes("--sources")) {
    return {
      sourceSpecs: [
        {
          bundleDirectory:
            args[0] ?? "benchmark-data/inference/t5gemma2-live",
          reviewPath:
            args[1] ??
            "benchmarks/reviews/development-2026-07-23-adjudicated.json"
        }
      ],
      outputDirectory: path.resolve(
        args[2] ?? "benchmark-data/training/t5gemma2-adjudicated-discovery"
      )
    };
  }
  const sourceIndex = args.indexOf("--sources");
  const sourcePath = args[sourceIndex + 1];
  if (!sourcePath) throw new Error("--sources requires a JSON source manifest");
  const outputIndex = args.indexOf("--output");
  const output =
    outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  const manifest = await readJson<{ sources: SourceSpec[] }>(
    path.resolve(sourcePath)
  );
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    throw new Error("Source manifest must contain at least one source");
  }
  return {
    sourceSpecs: manifest.sources,
    outputDirectory: path.resolve(
      output ?? "benchmark-data/training/t5gemma2-adjudicated-discovery"
    )
  };
}

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
