import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
  countExtractionOutcomes,
  getTrainingSplit,
  validateTrainingDomainSplits,
  type T5TrainingRecord,
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

interface PreparedPage {
  runId: string;
  pageId: string;
  siteId: string;
  split: "train" | "validation";
  pageDirectory: string;
  imageFilename: string;
  example: NonNullable<ReturnType<typeof buildTrainingExample>["example"]>;
}

interface AdjudicationOverlayManifest {
  version: 1;
  queueId: string;
  cohort: "training" | "validation" | "selection" | "final";
  pages: Array<{
    pageId: string;
    source: {
      observationSha256: string;
      screenshotSha256: string;
    };
    annotationPath: string;
    annotationSha256: string;
  }>;
}

const options = parseOptions(process.argv.slice(2));
const [manifest, domainSplits, trainingSplits] = await Promise.all([
  readJson<CorpusTargetManifest>(path.resolve("benchmarks/live-sites/targets.json")),
  readJson<CorpusDomainSplits>(path.resolve("benchmarks/live-sites/domain-splits.json")),
  readJson<TrainingDomainSplits>(path.resolve("benchmarks/live-sites/training-splits.json"))
]);
const adjudicationOverlay = options.adjudicationManifest
  ? await loadAdjudicationOverlay(options.adjudicationManifest)
  : undefined;
const usedOverlayKeys = new Set<string>();
const splitErrors = [
  ...validateDomainSplits(manifest, domainSplits),
  ...validateTrainingDomainSplits(domainSplits, trainingSplits)
];
if (splitErrors.length > 0) {
  throw new Error(`Invalid training splits:\n${splitErrors.join("\n")}`);
}

const preparedPages: PreparedPage[] = [];
const skippedPages: Array<{ runId: string; pageId: string; reason: string }> = [];
const rejectedPages: Array<{ runId: string; pageId: string; reasons: string[] }> = [];
const captureKeys = new Set<string>();

for (const runDirectory of options.runDirectories) {
  const run = await readJson<RunManifest>(path.join(runDirectory, "run.json"));
  for (const result of run.results.filter((entry) => entry.status === "captured")) {
    const pageDirectory = path.join(runDirectory, result.pageId);
    const page = await readJson<PageMetadata>(path.join(pageDirectory, "page.json"));
    const domainSplit = getDomainSplit(page.target.siteId, domainSplits);
    if (domainSplit !== "development") {
      skippedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reason: `domain belongs to ${domainSplit ?? "no"} benchmark split`
      });
      continue;
    }
    const trainingSplit = getTrainingSplit(page.target.siteId, trainingSplits);
    if (!trainingSplit) {
      rejectedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reasons: ["development domain has no internal training split"]
      });
      continue;
    }
    const captureKey = `${run.runId}/${result.pageId}`;
    if (captureKeys.has(captureKey)) {
      rejectedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reasons: ["duplicate capture supplied more than once"]
      });
      continue;
    }
    captureKeys.add(captureKey);

    const observationPath = path.join(pageDirectory, "observation.json");
    const observationBytes = await readFile(observationPath);
    const observationSha256 = createHash("sha256")
      .update(observationBytes)
      .digest("hex");
    const overlayKey = `${result.pageId}\0${observationSha256}`;
    const overlayEntry = adjudicationOverlay?.entries.get(overlayKey);
    if (adjudicationOverlay && !overlayEntry) {
      skippedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reason: "capture is not present in the adjudication overlay"
      });
      continue;
    }
    const observation = JSON.parse(
      observationBytes.toString("utf8")
    ) as PageObservation;
    const annotationPath = overlayEntry
      ? path.resolve(
          adjudicationOverlay!.directory,
          overlayEntry.annotationPath
        )
      : path.join(pageDirectory, "annotation.json");
    const annotationBytes = await readFile(annotationPath);
    if (
      overlayEntry &&
      createHash("sha256").update(annotationBytes).digest("hex") !==
        overlayEntry.annotationSha256
    ) {
      rejectedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reasons: ["adjudication overlay annotation hash mismatch"]
      });
      continue;
    }
    if (overlayEntry) usedOverlayKeys.add(overlayKey);
    const annotation = JSON.parse(
      annotationBytes.toString("utf8")
    ) as CorpusAnnotation;
    if (overlayEntry) {
      const screenshotBytes = await readFile(
        path.join(pageDirectory, "annotation.png")
      );
      if (
        createHash("sha256").update(screenshotBytes).digest("hex") !==
        overlayEntry.source.screenshotSha256
      ) {
        rejectedPages.push({
          runId: run.runId,
          pageId: result.pageId,
          reasons: ["adjudication overlay screenshot hash mismatch"]
        });
        continue;
      }
    }
    const built = buildTrainingExample(page.target.siteId, observation, annotation, {
      allowSingleReview: options.allowSingleReview
    });
    if (!built.example) {
      rejectedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reasons: built.errors
      });
      continue;
    }
    const imageFilename = `${safeSegment(run.runId)}--${safeSegment(result.pageId)}.png`;
    try {
      await readFile(path.join(pageDirectory, "annotation.png"));
    } catch (error) {
      rejectedPages.push({
        runId: run.runId,
        pageId: result.pageId,
        reasons: [
          `annotation screenshot is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`
        ]
      });
      continue;
    }
    preparedPages.push({
      runId: run.runId,
      pageId: result.pageId,
      siteId: page.target.siteId,
      split: trainingSplit,
      pageDirectory,
      imageFilename,
      example: built.example
    });
  }
}

if (adjudicationOverlay) {
  for (const [key, entry] of adjudicationOverlay.entries) {
    if (usedOverlayKeys.has(key)) continue;
    rejectedPages.push({
      runId: adjudicationOverlay.manifest.queueId,
      pageId: entry.pageId,
      reasons: ["adjudication overlay page was not consumed by supplied runs"]
    });
  }
}

if (rejectedPages.length > 0 && !options.allowIncomplete) {
  process.stderr.write(
    `${JSON.stringify(
      {
        message:
          "Training export is strict. Resolve rejected annotations or pass --allow-incomplete for a non-release pilot.",
        rejectedPages
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
}
if (preparedPages.length === 0) {
  throw new Error("No eligible adjudicated development pages were found.");
}

const assetDirectory = path.join(options.outputDirectory, "assets");
await mkdir(assetDirectory, { recursive: true });
const records: T5TrainingRecord[] = [];
const assets: Array<{ path: string; sha256: string }> = [];

for (const page of preparedPages) {
  const sourceImage = path.join(page.pageDirectory, "annotation.png");
  const relativeImagePath = path.posix.join("assets", page.imageFilename);
  const destinationImage = path.join(assetDirectory, page.imageFilename);
  await copyFile(sourceImage, destinationImage);
  assets.push({
    path: relativeImagePath,
    sha256: createHash("sha256").update(await readFile(destinationImage)).digest("hex")
  });
  records.push(
    ...buildT5TrainingRecords(page.example, {
      captureId: safeSegment(page.runId),
      split: page.split,
      imagePath: relativeImagePath,
      discoveryChunkHeight: options.discoveryChunkHeight,
      cardPadding: options.cardPadding
    })
  );
}

records.sort((left, right) => left.id.localeCompare(right.id));
const trainRecords = records.filter((record) => record.split === "train");
const validationRecords = records.filter((record) => record.split === "validation");
if (trainRecords.length === 0 || validationRecords.length === 0) {
  throw new Error("Both train and validation records are required.");
}

const trainText = serializeJsonl(trainRecords);
const validationText = serializeJsonl(validationRecords);
await mkdir(options.outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(options.outputDirectory, "train.jsonl"), trainText, "utf8"),
  writeFile(path.join(options.outputDirectory, "validation.jsonl"), validationText, "utf8")
]);

const products = preparedPages.flatMap((page) => page.example.target.products);
const outcomes = countExtractionOutcomes(products);
const datasetHash = createHash("sha256")
  .update(trainText)
  .update(validationText)
  .digest("hex");
const datasetManifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  sourceRuns: [...new Set(preparedPages.map((page) => page.runId))].sort(),
  files: {
    train: "train.jsonl",
    validation: "validation.jsonl"
  },
  strict: !options.allowIncomplete,
  allowSingleReview: options.allowSingleReview,
  ...(adjudicationOverlay
    ? {
        adjudicationOverlay: {
          manifest: options.adjudicationManifest,
          queueId: adjudicationOverlay.manifest.queueId,
          pages: adjudicationOverlay.entries.size
        }
      }
    : {}),
  discoveryChunkHeight: options.discoveryChunkHeight,
  cardPadding: options.cardPadding,
  pages: preparedPages.length,
  uniquePages: new Set(preparedPages.map((page) => `${page.siteId}/${page.pageId}`)).size,
  domains: [...new Set(preparedPages.map((page) => page.siteId))].sort(),
  products: products.length,
  comparableProducts: outcomes.comparable,
  abstainedProducts: outcomes.abstained,
  records: {
    train: trainRecords.length,
    validation: validationRecords.length,
    discovery: records.filter((record) => record.task === "discover-products").length,
    extraction: records.filter((record) => record.task === "extract-product").length
  },
  assets: assets.sort((left, right) => left.path.localeCompare(right.path)),
  skippedPages,
  rejectedPages,
  sha256: datasetHash
};
await writeFile(
  path.join(options.outputDirectory, "dataset-manifest.json"),
  `${JSON.stringify(datasetManifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(datasetManifest, null, 2)}\n`);

function parseOptions(args: string[]): {
  runDirectories: string[];
  outputDirectory: string;
  allowSingleReview: boolean;
  allowIncomplete: boolean;
  discoveryChunkHeight: number;
  cardPadding: number;
  adjudicationManifest?: string;
} {
  const runDirectories: string[] = [];
  let outputDirectory = path.resolve("benchmark-data/training/t5gemma2");
  let allowSingleReview = false;
  let allowIncomplete = false;
  let discoveryChunkHeight = 900;
  let cardPadding = 24;
  let adjudicationManifest: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--output") {
      outputDirectory = path.resolve(requireValue(args, ++index, arg));
    } else if (arg === "--discovery-chunk-height") {
      discoveryChunkHeight = Number.parseInt(requireValue(args, ++index, arg), 10);
    } else if (arg === "--card-padding") {
      cardPadding = Number.parseInt(requireValue(args, ++index, arg), 10);
    } else if (arg === "--adjudication-manifest") {
      adjudicationManifest = path.resolve(requireValue(args, ++index, arg));
    } else if (arg === "--allow-single-review") {
      allowSingleReview = true;
    } else if (arg === "--allow-incomplete") {
      allowIncomplete = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      runDirectories.push(path.resolve(arg));
    }
  }

  if (runDirectories.length === 0) {
    throw new Error(
      "Usage: bun run training:prepare -- <run-directory> [...] [--output <directory>] [--adjudication-manifest <manifest.json>]"
    );
  }
  if (discoveryChunkHeight < 320 || cardPadding < 0) {
    throw new Error("Invalid discovery chunk height or card padding.");
  }
  return {
    runDirectories,
    outputDirectory,
    allowSingleReview,
    allowIncomplete,
    discoveryChunkHeight,
    cardPadding,
    ...(adjudicationManifest ? { adjudicationManifest } : {})
  };
}

async function loadAdjudicationOverlay(filename: string): Promise<{
  manifest: AdjudicationOverlayManifest;
  directory: string;
  entries: Map<string, AdjudicationOverlayManifest["pages"][number]>;
}> {
  const manifest = await readJson<AdjudicationOverlayManifest>(filename);
  if (
    manifest.version !== 1 ||
    manifest.cohort !== "training" ||
    !manifest.queueId?.trim() ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length === 0
  ) {
    throw new Error("Invalid training adjudication overlay manifest.");
  }
  const entries = new Map<
    string,
    AdjudicationOverlayManifest["pages"][number]
  >();
  const directory = path.dirname(filename);
  for (const entry of manifest.pages) {
    const key = `${entry.pageId}\0${entry.source.observationSha256}`;
    const annotationPath = path.resolve(directory, entry.annotationPath);
    if (
      entries.has(key) ||
      !/^[a-f0-9]{64}$/.test(entry.source.observationSha256) ||
      !/^[a-f0-9]{64}$/.test(entry.source.screenshotSha256) ||
      !/^[a-f0-9]{64}$/.test(entry.annotationSha256) ||
      !entry.annotationPath?.trim() ||
      (annotationPath !== directory &&
        !annotationPath.startsWith(`${directory}${path.sep}`))
    ) {
      throw new Error(
        `Invalid or duplicate adjudication overlay page: ${entry.pageId}`
      );
    }
    entries.set(key, entry);
  }
  return {
    manifest,
    directory,
    entries
  };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function serializeJsonl(records: readonly T5TrainingRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
