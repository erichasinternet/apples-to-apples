import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { cropObservationToRegion } from "../src/learning/observation-region";
import type { CorpusAnnotation } from "./live-corpus-lib";
import {
  buildT5DiscoveryRecords,
  buildT5ExtractionRecord,
  getTrainingSplit,
  type T5InferenceRecord,
  type TrainingDomainSplits
} from "./t5-training-lib";

type Stage = "discovery" | "extraction";
type RequestedSplit = "train" | "validation" | "all";

interface RunManifest {
  runId: string;
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

interface PageMetadata {
  capturedAt: string;
  blocked: boolean;
  annotationScreenshotCaptured?: boolean;
  target: { siteId: string };
}

interface BundlePage {
  captureId: string;
  runId: string;
  pageId: string;
  siteId: string;
  trainingSplit: "train" | "validation";
  sourceDirectory: string;
  observationPath: string;
  imagePath: string;
  observationSha256: string;
  imageSha256: string;
  nodeCount: number;
}

interface BundleManifest {
  version: 1;
  createdAt: string;
  requestedSplit: RequestedSplit;
  pages: BundlePage[];
  records: {
    discovery: number;
    extraction?: number;
  };
  promptCharacters: {
    discovery: NumberSummary;
    extraction?: NumberSummary;
  };
  discoveryAnalysis?: {
    parsedPredictions: number;
    invalidPredictions: number;
    acceptedCardNodeIds: number;
    duplicateCardNodeIds: number;
    unknownCardNodeIds: number;
  };
}

interface NumberSummary {
  min: number;
  median: number;
  p95: number;
  max: number;
}

interface InferencePrediction {
  id: string;
  task: string;
  prediction: string;
}

interface Options {
  stage: Stage;
  outputDirectory: string;
  requestedSplit: RequestedSplit;
  predictionsPath?: string;
  runDirectories: string[];
}

const options = parseOptions(process.argv.slice(2));
if (options.stage === "discovery") {
  await prepareDiscovery(options);
} else {
  await prepareExtraction(options);
}

async function prepareDiscovery(options: Options): Promise<void> {
  if (options.runDirectories.length === 0) {
    throw new Error("Discovery requires at least one live-corpus run directory.");
  }
  const splits = await readJson<TrainingDomainSplits>(
    path.resolve("benchmarks/live-sites/training-splits.json")
  );
  const latestPages = new Map<string, BundlePage & { capturedAt: string }>();

  for (const runDirectoryValue of options.runDirectories) {
    const runDirectory = path.resolve(runDirectoryValue);
    const run = await readJson<RunManifest>(path.join(runDirectory, "run.json")).catch(
      () => undefined
    );
    if (!run) continue;
    for (const result of run.results.filter((entry) => entry.status === "captured")) {
      const pageDirectory = path.join(runDirectory, result.pageId);
      const candidate = await loadCandidatePage(pageDirectory, run.runId, splits).catch(
        () => undefined
      );
      if (!candidate) continue;
      if (
        options.requestedSplit !== "all" &&
        candidate.trainingSplit !== options.requestedSplit
      ) {
        continue;
      }
      const prior = latestPages.get(candidate.pageId);
      if (!prior || candidate.capturedAt > prior.capturedAt) {
        latestPages.set(candidate.pageId, candidate);
      }
    }
  }

  const pages = [...latestPages.values()].sort(
    (left, right) =>
      left.siteId.localeCompare(right.siteId) || left.pageId.localeCompare(right.pageId)
  );
  if (pages.length === 0) {
    throw new Error("No usable live captures matched the requested internal split.");
  }

  await rm(options.outputDirectory, { recursive: true, force: true });
  await Promise.all([
    mkdir(path.join(options.outputDirectory, "assets"), { recursive: true }),
    mkdir(path.join(options.outputDirectory, "pages"), { recursive: true })
  ]);

  const records: T5InferenceRecord[] = [];
  const manifestPages: BundlePage[] = [];
  for (const page of pages) {
    const observation = await readJson<PageObservation>(
      path.join(page.sourceDirectory, "observation.json")
    );
    const annotation = await readJson<CorpusAnnotation>(
      path.join(page.sourceDirectory, "annotation.json")
    );
    if (!annotation.region) throw new Error(`${page.pageId}: missing annotation region`);
    const croppedObservation = cropObservationToRegion(observation, annotation.region);
    const observationFilename = `${page.captureId}--${page.pageId}.json`;
    const imageFilename = `${page.captureId}--${page.pageId}.png`;
    const observationPath = path.posix.join("pages", observationFilename);
    const imagePath = path.posix.join("assets", imageFilename);
    const serializedObservation = `${JSON.stringify(croppedObservation, null, 2)}\n`;
    const sourceImage = path.join(page.sourceDirectory, "annotation.png");
    const destinationImage = path.join(options.outputDirectory, imagePath);
    await Promise.all([
      writeFile(
        path.join(options.outputDirectory, observationPath),
        serializedObservation,
        "utf8"
      ),
      copyFile(sourceImage, destinationImage)
    ]);
    const image = await readFile(destinationImage);
    manifestPages.push({
      captureId: page.captureId,
      runId: page.runId,
      pageId: page.pageId,
      siteId: page.siteId,
      trainingSplit: page.trainingSplit,
      sourceDirectory: page.sourceDirectory,
      observationPath,
      imagePath,
      observationSha256: createHash("sha256").update(serializedObservation).digest("hex"),
      imageSha256: createHash("sha256").update(image).digest("hex"),
      nodeCount: croppedObservation.nodes.length
    });
    records.push(
      ...buildT5DiscoveryRecords(croppedObservation, {
        captureId: page.captureId,
        pageId: page.pageId,
        siteId: page.siteId,
        imagePath
      })
    );
  }
  records.sort((left, right) => left.id.localeCompare(right.id));
  await writeJsonl(path.join(options.outputDirectory, "discovery.jsonl"), records);
  const manifest: BundleManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    requestedSplit: options.requestedSplit,
    pages: manifestPages,
    records: { discovery: records.length },
    promptCharacters: {
      discovery: summarize(records.map((record) => record.prompt.length))
    }
  };
  await writeJson(path.join(options.outputDirectory, "manifest.json"), manifest);
  process.stdout.write(
    `${JSON.stringify(
      {
        stage: "discovery",
        outputDirectory: options.outputDirectory,
        pages: manifestPages.length,
        domains: [...new Set(manifestPages.map((page) => page.siteId))],
        records: records.length,
        promptCharacters: manifest.promptCharacters.discovery
      },
      null,
      2
    )}\n`
  );
}

async function prepareExtraction(options: Options): Promise<void> {
  if (!options.predictionsPath) {
    throw new Error("Extraction requires --predictions <discovery-predictions.jsonl>.");
  }
  const manifestPath = path.join(options.outputDirectory, "manifest.json");
  const manifest = await readJson<BundleManifest>(manifestPath);
  const predictions = await readJsonl<InferencePrediction>(options.predictionsPath);
  const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
  const accepted = new Map<string, Set<string>>();
  let parsedPredictions = 0;
  let invalidPredictions = 0;
  let duplicateCardNodeIds = 0;
  let unknownCardNodeIds = 0;

  for (const prediction of predictions) {
    if (prediction.task !== "discover-products") continue;
    const parsed = parseJsonPrefix(prediction.prediction);
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.pageId !== "string" ||
      !Array.isArray(parsed.cardNodeIds)
    ) {
      invalidPredictions += 1;
      continue;
    }
    const page = pageMap.get(parsed.pageId);
    if (!page) {
      invalidPredictions += 1;
      continue;
    }
    parsedPredictions += 1;
    const observation = await readJson<PageObservation>(
      path.join(options.outputDirectory, page.observationPath)
    );
    const knownNodeIds = new Set(observation.nodes.map((node) => node.id));
    const pageNodeIds = accepted.get(page.pageId) ?? new Set<string>();
    accepted.set(page.pageId, pageNodeIds);
    for (const value of parsed.cardNodeIds) {
      if (typeof value !== "string" || !knownNodeIds.has(value)) {
        unknownCardNodeIds += 1;
      } else if (pageNodeIds.has(value)) {
        duplicateCardNodeIds += 1;
      } else {
        pageNodeIds.add(value);
      }
    }
  }

  const records: T5InferenceRecord[] = [];
  for (const page of manifest.pages) {
    const observation = await readJson<PageObservation>(
      path.join(options.outputDirectory, page.observationPath)
    );
    for (const cardNodeId of accepted.get(page.pageId) ?? []) {
      records.push(
        buildT5ExtractionRecord(observation, cardNodeId, {
          captureId: page.captureId,
          pageId: page.pageId,
          siteId: page.siteId,
          imagePath: page.imagePath
        })
      );
    }
  }
  records.sort((left, right) => left.id.localeCompare(right.id));
  await writeJsonl(path.join(options.outputDirectory, "extraction.jsonl"), records);
  manifest.records.extraction = records.length;
  manifest.promptCharacters.extraction = summarize(
    records.map((record) => record.prompt.length)
  );
  manifest.discoveryAnalysis = {
    parsedPredictions,
    invalidPredictions,
    acceptedCardNodeIds: records.length,
    duplicateCardNodeIds,
    unknownCardNodeIds
  };
  await writeJson(manifestPath, manifest);
  process.stdout.write(
    `${JSON.stringify(
      {
        stage: "extraction",
        outputDirectory: options.outputDirectory,
        records: records.length,
        promptCharacters: manifest.promptCharacters.extraction,
        discoveryAnalysis: manifest.discoveryAnalysis
      },
      null,
      2
    )}\n`
  );
}

async function loadCandidatePage(
  pageDirectory: string,
  runId: string,
  splits: TrainingDomainSplits
): Promise<(BundlePage & { capturedAt: string }) | undefined> {
  const [page, observation, annotation] = await Promise.all([
    readJson<PageMetadata>(path.join(pageDirectory, "page.json")),
    readJson<PageObservation>(path.join(pageDirectory, "observation.json")),
    readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json"))
  ]);
  const trainingSplit = getTrainingSplit(page.target.siteId, splits);
  if (
    !trainingSplit ||
    page.blocked ||
    !page.annotationScreenshotCaptured ||
    !annotation.region ||
    observation.nodes.length === 0
  ) {
    return undefined;
  }
  await readFile(path.join(pageDirectory, "annotation.png"));
  return {
    captureId: safeSegment(runId),
    runId,
    pageId: observation.pageId,
    siteId: page.target.siteId,
    trainingSplit,
    capturedAt: page.capturedAt,
    sourceDirectory: pageDirectory,
    observationPath: "",
    imagePath: "",
    observationSha256: "",
    imageSha256: "",
    nodeCount: observation.nodes.length
  };
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${value}`);
    values.set(value, next);
    index += 1;
  }
  const stage = values.get("--stage") ?? "discovery";
  if (stage !== "discovery" && stage !== "extraction") {
    throw new Error("--stage must be discovery or extraction.");
  }
  const requestedSplit = values.get("--split") ?? "validation";
  if (!["train", "validation", "all"].includes(requestedSplit)) {
    throw new Error("--split must be train, validation, or all.");
  }
  return {
    stage,
    outputDirectory: path.resolve(
      values.get("--output") ?? "benchmark-data/inference/t5gemma2-live"
    ),
    requestedSplit: requestedSplit as RequestedSplit,
    ...(values.has("--predictions")
      ? { predictionsPath: path.resolve(values.get("--predictions")!) }
      : {}),
    runDirectories: positional
  };
}

function parseJsonPrefix(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
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
}

function summarize(values: number[]): NumberSummary {
  if (values.length === 0) return { min: 0, median: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0]!,
    median: sorted[Math.floor((sorted.length - 1) * 0.5)]!,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)]!,
    max: sorted.at(-1)!
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeJsonl(filePath: string, values: unknown[]): Promise<void> {
  await writeFile(
    filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : ""),
    "utf8"
  );
}
