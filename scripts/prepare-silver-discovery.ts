import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { cropObservationToRegion } from "../src/learning/observation-region";
import type { CorpusAnnotation } from "./live-corpus-lib";
import {
  buildT5DiscoveryRecords,
  getTrainingSplit,
  type T5TrainingRecord,
  type TrainingDomainSplits
} from "./t5-training-lib";

interface RunManifest {
  runId: string;
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

interface PageMetadata {
  capturedAt: string;
  blocked: boolean;
  annotationScreenshotCaptured?: boolean;
  candidateCount: number;
  target: { siteId: string };
}

interface Candidate {
  nodeId: string;
}

interface LivePage {
  runId: string;
  pageId: string;
  siteId: string;
  capturedAt: string;
  directory: string;
}

const outputDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-silver-discovery"
);
const syntheticDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-synthetic"
);
const runDirectories = process.argv.slice(2).map((value) => path.resolve(value));
if (runDirectories.length === 0) {
  throw new Error("Provide live-corpus run directories.");
}
const trainingSplits = await readJson<TrainingDomainSplits>(
  path.resolve("benchmarks/live-sites/training-splits.json")
);
const latestPages = new Map<string, LivePage>();

for (const runDirectory of runDirectories) {
  const run = await readJson<RunManifest>(path.join(runDirectory, "run.json")).catch(
    () => undefined
  );
  if (!run) continue;
  for (const result of run.results.filter((entry) => entry.status === "captured")) {
    const directory = path.join(runDirectory, result.pageId);
    const page = await readJson<PageMetadata>(path.join(directory, "page.json")).catch(
      () => undefined
    );
    if (
      !page ||
      getTrainingSplit(page.target.siteId, trainingSplits) !== "train" ||
      page.blocked ||
      !page.annotationScreenshotCaptured ||
      page.candidateCount <= 0
    ) {
      continue;
    }
    const candidate: LivePage = {
      runId: run.runId,
      pageId: result.pageId,
      siteId: page.target.siteId,
      capturedAt: page.capturedAt,
      directory
    };
    const prior = latestPages.get(candidate.pageId);
    if (!prior || candidate.capturedAt > prior.capturedAt) {
      latestPages.set(candidate.pageId, candidate);
    }
  }
}

const pages = [...latestPages.values()];
const sites = [...new Set(pages.map((page) => page.siteId))].sort(
  (left, right) => stableRank(left) - stableRank(right) || left.localeCompare(right)
);
const validationSiteCount = Math.max(1, Math.round(sites.length * 0.25));
const silverValidationSites = new Set(sites.slice(0, validationSiteCount));

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
await cp(
  path.join(syntheticDirectory, "assets"),
  path.join(outputDirectory, "assets"),
  { recursive: true }
);

const syntheticTrain = (
  await readJsonl<T5TrainingRecord>(path.join(syntheticDirectory, "train.jsonl"))
).filter((record) => record.task === "discover-products");
const syntheticValidation = (
  await readJsonl<T5TrainingRecord>(path.join(syntheticDirectory, "validation.jsonl"))
).filter((record) => record.task === "discover-products");
const silverTrain: T5TrainingRecord[] = [];
const silverValidation: T5TrainingRecord[] = [];
const sources: Array<Record<string, unknown>> = [];

for (const page of pages.sort((left, right) => left.pageId.localeCompare(right.pageId))) {
  const [observation, annotation, filenames] = await Promise.all([
    readJson<PageObservation>(path.join(page.directory, "observation.json")),
    readJson<CorpusAnnotation>(path.join(page.directory, "annotation.json")),
    readdir(path.join(page.directory, "cards"))
  ]);
  if (!annotation.region) continue;
  const candidates = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith(".json"))
      .map((filename) => readJson<Candidate>(path.join(page.directory, "cards", filename)))
  );
  const candidateIds = new Set(candidates.map((candidate) => candidate.nodeId));
  const croppedObservation = cropObservationToRegion(observation, annotation.region);
  const nodeMap = new Map(croppedObservation.nodes.map((node) => [node.id, node]));
  const imageFilename = `live-${safeSegment(page.runId)}--${page.pageId}.png`;
  const imagePath = path.posix.join("assets", imageFilename);
  await copyFile(
    path.join(page.directory, "annotation.png"),
    path.join(outputDirectory, imagePath)
  );
  const split = silverValidationSites.has(page.siteId) ? "validation" : "train";
  const records = buildT5DiscoveryRecords(croppedObservation, {
    captureId: `silver-${safeSegment(page.runId)}`,
    pageId: page.pageId,
    siteId: page.siteId,
    imagePath,
    requiredDiscoveryNodeIds: [...candidateIds]
  });
  let targets = 0;
  for (const input of records) {
    const region = input.metadata.sourceRegion;
    const cardNodeIds = [...candidateIds].filter((nodeId) => {
      const node = nodeMap.get(nodeId);
      if (!node) return false;
      const centerY = node.bounds.y + node.bounds.height / 2;
      return centerY >= region.y && centerY < region.y + region.height;
    });
    for (const nodeId of cardNodeIds) {
      if (!input.prompt.includes(`"id":"${nodeId}"`)) {
        throw new Error(`${input.id}: pruning removed silver card root ${nodeId}`);
      }
    }
    targets += cardNodeIds.length;
    const record: T5TrainingRecord = {
      ...input,
      split,
      target: JSON.stringify({
        version: 1,
        pageId: page.pageId,
        cardNodeIds
      }),
      metadata: {
        ...input.metadata,
        cardCount: cardNodeIds.length,
        abstainedProducts: 0
      }
    };
    (split === "train" ? silverTrain : silverValidation).push(record);
  }
  sources.push({
    runId: page.runId,
    pageId: page.pageId,
    siteId: page.siteId,
    split,
    candidateRootsInRegion: targets,
    records: records.length
  });
}

if (silverTrain.length === 0 || silverValidation.length === 0) {
  throw new Error("Silver train and validation records are both required.");
}
const train = [...silverTrain, ...syntheticTrain];
const validation = [...silverValidation, ...syntheticValidation];
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
const domains = [...new Set([...train, ...validation].map((record) => record.siteId))].sort();
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  datasetType: "synthetic-plus-silver-real-discovery",
  labelPolicy:
    "Real targets are generic collector card candidates and are weak labels, not adjudicated extraction truth.",
  strict: false,
  allowSingleReview: true,
  pages: new Set([...train, ...validation].map((record) => record.pageId)).size,
  domains,
  products: 0,
  records: {
    train: train.length,
    validation: validation.length,
    discovery: train.length + validation.length,
    extraction: 0
  },
  files: { train: "train.jsonl", validation: "validation.jsonl" },
  assets,
  silver: {
    seed: 20260724,
    trainSites: sites.filter((site) => !silverValidationSites.has(site)),
    validationSites: [...silverValidationSites].sort(),
    trainRecords: silverTrain.length,
    validationRecords: silverValidation.length,
    sources
  },
  sha256: createHash("sha256").update(trainText).update(validationText).digest("hex")
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
      silverTrainRecords: silverTrain.length,
      silverValidationRecords: silverValidation.length,
      silverTrainSites: manifest.silver.trainSites,
      silverValidationSites: manifest.silver.validationSites,
      sha256: manifest.sha256
    },
    null,
    2
  )}\n`
);

function stableRank(siteId: string): number {
  return Number.parseInt(
    createHash("sha256").update(`20260724:${siteId}`).digest("hex").slice(0, 8),
    16
  );
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function serializeJsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + "\n";
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
