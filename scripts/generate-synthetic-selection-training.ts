import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  enumerateEvidenceCandidates,
  resolveEvidencePointer,
} from "../src/learning/evidence-pointer";
import {
  buildEvidenceSelectionPrompt,
  resolveEvidenceSelection,
  serializeEvidenceSelection,
} from "../src/learning/evidence-selection";
import { parseT5PromptObservation } from "./t5-training-lib";

interface TrainingRecord {
  version: number;
  id: string;
  task: string;
  captureId: string;
  pageId: string;
  siteId: string;
  imagePath: string;
  imageCrop?: { x: number; y: number; width: number; height: number };
  prompt: string;
  target: string;
  metadata: Record<string, unknown>;
}

const sourceDirectory = path.resolve(
  optionValue("--source") ??
    "benchmark-data/training/t5gemma2-synthetic-pointer",
);
const outputDirectory = path.resolve(
  optionValue("--output") ??
    "benchmark-data/training/t5gemma2-synthetic-selection",
);
const cardPath = path.resolve(
  optionValue("--card") ??
    "benchmarks/synthetic-training/selection-dataset-card.json",
);
const sourceCard = JSON.parse(
  await readFile(
    path.resolve(
      optionValue("--source-card") ??
        "benchmarks/synthetic-training/pointer-dataset-card.json",
    ),
    "utf8",
  ),
) as {
  seed: number;
  generatorVersion: number;
  domains: unknown;
  structuralFamilies: number;
  challengeTags: Record<string, number>;
  sha256: string;
};

const splitNames = ["train", "validation"] as const;
const convertedBySplit = new Map<string, TrainingRecord[]>();
const sourcePromptLengths: number[] = [];
const compactPromptLengths: number[] = [];
const targetLengths: number[] = [];
const nodeCounts: number[] = [];
const candidateCounts: number[] = [];
const statuses: Record<string, number> = {};
let invalidSelections = 0;

for (const split of splitNames) {
  const sourceRecords = await readJsonl<TrainingRecord>(
    path.join(sourceDirectory, `${split}.jsonl`),
  );
  const converted: TrainingRecord[] = [];
  for (const record of sourceRecords) {
    if (record.task !== "extract-product") continue;
    const observation = parseT5PromptObservation(record.prompt);
    const pointer = resolveEvidencePointer(record.target, observation);
    const product = pointer.extraction?.products[0];
    if (!pointer.valid || !product) {
      throw new Error(`${record.id}: source pointer does not resolve`);
    }
    const prompt = buildEvidenceSelectionPrompt(
      observation,
      product.cardNodeId,
    );
    const target = serializeEvidenceSelection(product, observation);
    const resolved = resolveEvidenceSelection(
      target,
      observation,
      product.cardNodeId,
    );
    if (!resolved.valid) {
      invalidSelections += 1;
      throw new Error(
        `${record.id}: compact selection does not resolve: ${resolved.issues
          .map((issue) => issue.code)
          .join(", ")}`,
      );
    }
    sourcePromptLengths.push(record.prompt.length);
    compactPromptLengths.push(prompt.length);
    targetLengths.push(target.length);
    nodeCounts.push(observation.nodes.length);
    candidateCounts.push(
      enumerateEvidenceCandidates(observation, product.cardNodeId).length,
    );
    const statusCode = target.slice(-1);
    statuses[statusCode] = (statuses[statusCode] ?? 0) + 1;
    converted.push({
      ...record,
      task: "select-unit-evidence",
      prompt,
      target,
      metadata: {
        ...record.metadata,
        targetFormat: "evidence-selection-v1",
        sourceTargetFormat: "evidence-pointer",
        sourcePromptChars: record.prompt.length,
        promptChars: prompt.length,
        targetChars: target.length,
      },
    });
  }
  convertedBySplit.set(split, converted);
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
const assetNames = await readdir(path.join(sourceDirectory, "assets"));
await Promise.all(
  assetNames.map((name) =>
    copyFile(
      path.join(sourceDirectory, "assets", name),
      path.join(outputDirectory, "assets", name),
    ),
  ),
);

const splitTexts = new Map<string, string>();
for (const split of splitNames) {
  const text = `${convertedBySplit
    .get(split)!
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
  splitTexts.set(split, text);
  await writeFile(path.join(outputDirectory, `${split}.jsonl`), text, "utf8");
}

const trainRecords = convertedBySplit.get("train")!;
const validationRecords = convertedBySplit.get("validation")!;
const report = {
  version: 1,
  generatorVersion: 1,
  seed: sourceCard.seed,
  datasetType: "synthetic-pretraining",
  targetFormat: "evidence-selection-v1",
  sourceTargetFormat: "evidence-pointer",
  sourceDatasetSha256: sourceCard.sha256,
  outputPath: path.relative(process.cwd(), outputDirectory),
  sha256: sha256(`${splitTexts.get("train")}${splitTexts.get("validation")}`),
  domains: sourceCard.domains,
  records: {
    total: trainRecords.length + validationRecords.length,
    train: trainRecords.length,
    validation: validationRecords.length,
  },
  structuralFamilies: sourceCard.structuralFamilies,
  challengeTags: sourceCard.challengeTags,
  statuses: Object.fromEntries(
    Object.entries(statuses).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  representation: {
    sourcePromptChars: summarize(sourcePromptLengths),
    compactPromptChars: summarize(compactPromptLengths),
    promptCharacterReduction:
      1 -
      compactPromptLengths.reduce((sum, value) => sum + value, 0) /
        sourcePromptLengths.reduce((sum, value) => sum + value, 0),
    targetChars: summarize(targetLengths),
    observationNodes: summarize(nodeCounts),
    valueCandidates: summarize(candidateCounts),
    outputGrammar: "T## P## U## Q## K## S#",
    nodeIndexAlphabet: "base36-two-character",
    generatedValues: false,
    generatedDomIds: false,
  },
  validation: {
    records: trainRecords.length + validationRecords.length,
    invalidSelections,
    exactRoundTrips: trainRecords.length + validationRecords.length,
    passed: invalidSelections === 0,
  },
  policy: {
    allowedUses: [
      "closed-grammar formulation experiments",
      "pointer-selection warm start",
      "controlled ablation experiments",
    ],
    prohibitedClaims: [
      "live-site accuracy",
      "model promotion without live adjudicated evidence",
      "held-out benchmark performance",
    ],
    maximumPostWarmStartPresentationShare: 0.5,
  },
};
await mkdir(path.dirname(cardPath), { recursive: true });
await writeFile(cardPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function readJsonl<T>(filename: string): Promise<T[]> {
  return (await readFile(filename, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function summarize(values: number[]): {
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
    mean:
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0,
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
  ]!;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
