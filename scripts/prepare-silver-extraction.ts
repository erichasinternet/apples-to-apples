import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";
import {
  buildT5ExtractionRecord,
  getTrainingSplit,
  parseT5PromptObservation,
  type T5TrainingRecord,
  type TrainingDomainSplits
} from "./t5-training-lib";
import type { ExtractionPreannotation } from "./extraction-preannotation-lib";

interface QueueItem {
  id: string;
  pageId: string;
  siteId: string;
  cardNodeId: string;
  source: {
    bundleDirectory: string;
    observationPath: string;
    imagePath: string;
  };
}

interface QueueReport {
  queue: QueueItem[];
}

interface PreannotationReport {
  preannotations: ExtractionPreannotation[];
}

interface AuditReport {
  eligibleForSilverTraining: boolean;
  eligibleForBenchmarkGold: boolean;
  eligibleIds: string[];
}

const outputDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-silver-extraction"
);
const syntheticDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-synthetic"
);
const queuePath = path.resolve(
  "benchmark-data/review/extraction-development-annotation-queue.json"
);
const preannotationPath = path.resolve(
  "benchmark-data/review/extraction-development-preannotations.json"
);
const auditPath = path.resolve(
  "benchmark-data/review/extraction-development-silver-audit.json"
);
const splitPath = path.resolve("benchmarks/live-sites/training-splits.json");
const [
  queueBytes,
  preannotationBytes,
  auditBytes,
  splits,
  syntheticTrain,
  syntheticValidation
] = await Promise.all([
  readFile(queuePath),
  readFile(preannotationPath),
  readFile(auditPath),
  readJson<TrainingDomainSplits>(splitPath),
  readJsonl<T5TrainingRecord>(path.join(syntheticDirectory, "train.jsonl")),
  readJsonl<T5TrainingRecord>(
    path.join(syntheticDirectory, "validation.jsonl")
  )
]);
const queue = JSON.parse(queueBytes.toString("utf8")) as QueueReport;
const preannotations = JSON.parse(
  preannotationBytes.toString("utf8")
) as PreannotationReport;
const audit = JSON.parse(auditBytes.toString("utf8")) as AuditReport;
if (
  !audit.eligibleForSilverTraining ||
  audit.eligibleForBenchmarkGold !== false
) {
  throw new Error("Silver audit is missing or has an invalid eligibility policy.");
}

const queueById = new Map(queue.queue.map((item) => [item.id, item]));
const annotationById = new Map(
  preannotations.preannotations.map((item) => [item.id, item])
);
const eligibleIds = new Set(audit.eligibleIds);
if (eligibleIds.size !== audit.eligibleIds.length) {
  throw new Error("Silver audit contains duplicate eligible ids.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
await cp(
  path.join(syntheticDirectory, "assets"),
  path.join(outputDirectory, "assets"),
  { recursive: true }
);

const train = syntheticTrain.filter(
  (record) => record.task === "extract-product"
);
const validation = syntheticValidation.filter(
  (record) => record.task === "extract-product"
);
const realTrain: T5TrainingRecord[] = [];
const realValidation: T5TrainingRecord[] = [];
const observationCache = new Map<string, PageObservation>();
const copiedImages = new Set<string>();
const sources: Array<Record<string, unknown>> = [];

for (const id of [...eligibleIds].sort()) {
  const item = queueById.get(id);
  const preannotation = annotationById.get(id);
  if (!item || !preannotation) {
    throw new Error(`${id}: missing queue item or preannotation`);
  }
  const split = getTrainingSplit(item.siteId, splits);
  if (!split) {
    throw new Error(`${id}: site ${item.siteId} is not assigned to a split`);
  }
  const observationPath = path.resolve(
    item.source.bundleDirectory,
    item.source.observationPath
  );
  let observation = observationCache.get(observationPath);
  if (!observation) {
    observation = await readJson<PageObservation>(observationPath);
    observationCache.set(observationPath, observation);
  }
  const sourceImagePath = path.resolve(
    item.source.bundleDirectory,
    item.source.imagePath
  );
  const imageFilename = `real-${path.basename(sourceImagePath)}`;
  const imagePath = path.posix.join("assets", imageFilename);
  if (!copiedImages.has(sourceImagePath)) {
    await copyFile(sourceImagePath, path.join(outputDirectory, imagePath));
    copiedImages.add(sourceImagePath);
  }

  const input = buildT5ExtractionRecord(observation, item.cardNodeId, {
    captureId: "audited-silver",
    pageId: item.pageId,
    siteId: item.siteId,
    imagePath,
    requiredExtractionNodeIds: extractionEvidenceNodeIds(
      preannotation.extraction
    )
  });
  const serializedTarget = {
    version: 1 as const,
    pageId: item.pageId,
    products: [preannotation.extraction]
  };
  const serializedValidation = validateModelExtraction(
    serializedTarget,
    parseT5PromptObservation(input.prompt)
  );
  if (!serializedValidation.valid) {
    throw new Error(
      `${id}: target is not grounded in serialized prompt: ${serializedValidation.issues
        .map((issue) => `${issue.code}/${issue.field}`)
        .join(", ")}`
    );
  }
  for (const evidenceNodeId of extractionEvidenceNodeIds(
    preannotation.extraction
  )) {
    if (!input.prompt.includes(`"id":"${evidenceNodeId}"`)) {
      throw new Error(
        `${id}: pruning removed required extraction evidence ${evidenceNodeId}`
      );
    }
  }
  const record: T5TrainingRecord = {
    ...input,
    id: `audited-silver--${safeSegment(id)}`,
    split,
    target: JSON.stringify(serializedTarget),
    metadata: {
      ...input.metadata,
      cardCount: 1,
      abstainedProducts: preannotation.extraction.abstainReason ? 1 : 0
    }
  };
  (split === "train" ? realTrain : realValidation).push(record);
  sources.push({
    id,
    pageId: item.pageId,
    siteId: item.siteId,
    split,
    outcome: preannotation.outcome,
    method: preannotation.method
  });
}

train.push(...realTrain);
validation.push(...realValidation);
assertDomainDisjoint(train, validation);
const trainText = serializeJsonl(train);
const validationText = serializeJsonl(validation);
await Promise.all([
  writeFile(path.join(outputDirectory, "train.jsonl"), trainText, "utf8"),
  writeFile(path.join(outputDirectory, "validation.jsonl"), validationText, "utf8")
]);

const referencedAssets = new Set(
  [...train, ...validation].map((record) => record.imagePath)
);
const assets = await Promise.all(
  [...referencedAssets].sort().map(async (relativePath) => ({
    path: relativePath,
    sha256: createHash("sha256")
      .update(await readFile(path.join(outputDirectory, relativePath)))
      .digest("hex")
  }))
);
const domains = [
  ...new Set([...train, ...validation].map((record) => record.siteId))
].sort();
const allRecords = [...train, ...validation];
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  datasetType: "synthetic-plus-audited-silver-real-extraction",
  labelPolicy:
    "Real targets are evidence-valid deterministic preannotations that passed an independent semantic quarantine audit. They are silver training labels, never benchmark gold.",
  strict: false,
  allowSingleReview: true,
  pages: new Set(allRecords.map((record) => record.pageId)).size,
  domains,
  products: allRecords.length,
  records: {
    train: train.length,
    validation: validation.length,
    discovery: 0,
    extraction: allRecords.length
  },
  outcomes: {
    comparable: allRecords.filter(
      (record) => record.metadata.abstainedProducts === 0
    ).length,
    abstained: allRecords.filter(
      (record) => (record.metadata.abstainedProducts ?? 0) > 0
    ).length
  },
  files: { train: "train.jsonl", validation: "validation.jsonl" },
  assets,
  silver: {
    queueSha256: sha256(queueBytes),
    preannotationSha256: sha256(preannotationBytes),
    auditSha256: sha256(auditBytes),
    trainSites: [...new Set(realTrain.map((record) => record.siteId))].sort(),
    validationSites: [
      ...new Set(realValidation.map((record) => record.siteId))
    ].sort(),
    trainRecords: realTrain.length,
    validationRecords: realValidation.length,
    sources
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
      syntheticTrainRecords: train.length - realTrain.length,
      syntheticValidationRecords: validation.length - realValidation.length,
      silverTrainRecords: realTrain.length,
      silverValidationRecords: realValidation.length,
      silverTrainSites: manifest.silver.trainSites,
      silverValidationSites: manifest.silver.validationSites,
      outcomes: manifest.outcomes,
      sha256: manifest.sha256
    },
    null,
    2
  )}\n`
);

function assertDomainDisjoint(
  left: T5TrainingRecord[],
  right: T5TrainingRecord[]
): void {
  const trainSites = new Set(left.map((record) => record.siteId));
  const overlap = [...new Set(right.map((record) => record.siteId))].filter(
    (siteId) => trainSites.has(siteId)
  );
  if (overlap.length > 0) {
    throw new Error(`Train/validation site overlap: ${overlap.join(", ")}`);
  }
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractionEvidenceNodeIds(
  extraction: ExtractionPreannotation["extraction"]
): string[] {
  return [
    ...extraction.title.evidenceNodeIds,
    ...(extraction.currentPrice?.evidenceNodeIds ?? []),
    ...(extraction.nativeUnitPrice?.evidenceNodeIds ?? []),
    ...(extraction.packageQuantity?.evidenceNodeIds ?? [])
  ].filter((value, index, values) => values.indexOf(value) === index);
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
