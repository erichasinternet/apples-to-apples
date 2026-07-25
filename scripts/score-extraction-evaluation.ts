import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelPageExtraction } from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";
import {
  parseT5PromptObservation,
  type T5TrainingRecord
} from "./t5-training-lib";

interface Prediction {
  id: string;
  prediction: string;
}

interface PredictionMeta {
  records: number;
  recordsSha256: string;
}

interface EvaluationManifest {
  sha256: string;
}

interface SampleResult {
  id: string;
  siteId: string;
  slice: "silver" | "synthetic";
  targetAbstained: boolean;
  strictJson: boolean;
  recoverableJson: boolean;
  exact: boolean;
  fieldMatches: number;
  fieldTotal: number;
  abstentionClassMatch: boolean;
  abstentionReasonMatch: boolean;
  evidenceAccepted: boolean;
  targetComparable: boolean;
  normalizedMatch: boolean;
  issues: string[];
}

const bundleDirectory = path.resolve(
  optionValue("--bundle") ??
    "benchmark-data/inference/t5gemma2-extraction-pilot"
);
const predictionsPath = path.resolve(
  optionValue("--predictions") ??
    path.join(bundleDirectory, "predictions-replay.jsonl")
);
const outputPath = path.resolve(
  optionValue("--output") ??
    `${predictionsPath.slice(0, -".jsonl".length)}-score.json`
);
const [records, predictions, meta, manifest] = await Promise.all([
  readJsonl<T5TrainingRecord>(path.join(bundleDirectory, "extraction.jsonl")),
  readJsonl<Prediction>(predictionsPath),
  readJson<PredictionMeta>(`${predictionsPath}.meta.json`),
  readJson<EvaluationManifest>(path.join(bundleDirectory, "manifest.json"))
]);
if (
  meta.recordsSha256 !== manifest.sha256 ||
  meta.records !== records.length
) {
  throw new Error("Prediction provenance does not match the evaluation cohort.");
}
const predictionById = new Map(
  predictions.map((prediction) => [prediction.id, prediction])
);
if (
  predictionById.size !== predictions.length ||
  predictions.length !== records.length
) {
  throw new Error("Predictions must cover each evaluation record exactly once.");
}

const samples = records.map((record) =>
  scoreSample(record, predictionById.get(record.id))
);
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  cohortSha256: manifest.sha256,
  predictionsPath: path.relative(process.cwd(), predictionsPath),
  records: samples.length,
  overall: summarize(samples),
  slices: {
    silver: summarize(samples.filter((sample) => sample.slice === "silver")),
    synthetic: summarize(
      samples.filter((sample) => sample.slice === "synthetic")
    )
  },
  sites: Object.fromEntries(
    [...new Set(samples.map((sample) => sample.siteId))]
      .sort()
      .map((siteId) => [
        siteId,
        summarize(samples.filter((sample) => sample.siteId === siteId))
      ])
  ),
  samples
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      cohortSha256: report.cohortSha256,
      overall: report.overall,
      slices: report.slices,
      sites: report.sites
    },
    null,
    2
  )}\n`
);

function scoreSample(
  record: T5TrainingRecord,
  prediction: Prediction | undefined
): SampleResult {
  if (!prediction) throw new Error(`${record.id}: missing prediction`);
  const observation = parseT5PromptObservation(record.prompt);
  const target = JSON.parse(record.target) as ModelPageExtraction;
  const targetValidation = validateModelExtraction(target, observation);
  if (!targetValidation.valid) {
    throw new Error(
      `${record.id}: target fails evidence validation: ${targetValidation.issues
        .map((issue) => `${issue.code}/${issue.field}`)
        .join(", ")}`
    );
  }
  const strictJson = parseStrict(prediction.prediction) !== undefined;
  const parsed = parseJsonPrefix(prediction.prediction);
  const validation =
    parsed === undefined
      ? undefined
      : validateModelExtraction(parsed, observation);
  const targetProduct = target.products[0]!;
  const predictedProduct =
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    "products" in parsed &&
    Array.isArray(parsed.products)
      ? parsed.products[0]
      : undefined;
  const fields = [
    "cardNodeId",
    "title",
    "currentPrice",
    "nativeUnitPrice",
    "packageQuantity",
    "abstainReason"
  ] as const;
  const fieldMatches = fields.filter(
    (field) =>
      JSON.stringify(readField(predictedProduct, field)) ===
      JSON.stringify(readField(targetProduct, field))
  ).length;
  const predictedAbstained =
    Boolean(
      predictedProduct &&
        typeof predictedProduct === "object" &&
        "abstainReason" in predictedProduct
    );
  const targetAbstained = Boolean(targetProduct.abstainReason);
  const targetNormalized = targetValidation.products[0]?.normalized;
  const predictedNormalized = validation?.products[0]?.normalized;
  const targetComparable = Boolean(targetNormalized);
  const normalizedMatch =
    Boolean(targetNormalized && predictedNormalized) &&
    targetNormalized!.compareKey === predictedNormalized!.compareKey &&
    Math.abs(
      targetNormalized!.centsPerUnit - predictedNormalized!.centsPerUnit
    ) /
      targetNormalized!.centsPerUnit <=
      0.02;
  return {
    id: record.id,
    siteId: record.siteId,
    slice: record.captureId.startsWith("audited-silver")
      ? "silver"
      : "synthetic",
    targetAbstained,
    strictJson,
    recoverableJson: parsed !== undefined,
    exact: JSON.stringify(parsed) === JSON.stringify(target),
    fieldMatches,
    fieldTotal: fields.length,
    abstentionClassMatch: predictedAbstained === targetAbstained,
    abstentionReasonMatch:
      targetAbstained &&
      readField(predictedProduct, "abstainReason") ===
        targetProduct.abstainReason,
    evidenceAccepted: validation?.valid === true,
    targetComparable,
    normalizedMatch,
    issues:
      validation?.issues.map(
        (issue) => `${issue.code}/${issue.field}`
      ) ?? ["invalid-json"]
  };
}

function summarize(samples: SampleResult[]) {
  const comparable = samples.filter((sample) => sample.targetComparable);
  const abstained = samples.filter((sample) => sample.targetAbstained);
  return {
    records: samples.length,
    strictJsonRate: rate(samples, (sample) => sample.strictJson),
    recoverableJsonRate: rate(
      samples,
      (sample) => sample.recoverableJson
    ),
    exactRate: rate(samples, (sample) => sample.exact),
    fieldAccuracy:
      samples.reduce((sum, sample) => sum + sample.fieldMatches, 0) /
      Math.max(
        1,
        samples.reduce((sum, sample) => sum + sample.fieldTotal, 0)
      ),
    abstentionClassAccuracy: rate(
      samples,
      (sample) => sample.abstentionClassMatch
    ),
    abstentionReasonAccuracy: rate(
      abstained,
      (sample) => sample.abstentionReasonMatch
    ),
    evidenceAcceptanceRate: rate(
      samples,
      (sample) => sample.evidenceAccepted
    ),
    normalizedPricingCoverage: rate(
      comparable,
      (sample) => sample.evidenceAccepted && sample.normalizedMatch
    ),
    normalizedPricingAccuracy: rate(
      comparable.filter((sample) => sample.evidenceAccepted),
      (sample) => sample.normalizedMatch
    ),
    targetComparable: comparable.length,
    targetAbstained: abstained.length
  };
}

function rate<T>(values: T[], predicate: (value: T) => boolean): number {
  return values.filter(predicate).length / Math.max(1, values.length);
}

function parseStrict(value: string): unknown | undefined {
  try {
    return JSON.parse(value.trim());
  } catch {
    return undefined;
  }
}

function parseJsonPrefix(value: string): unknown | undefined {
  const strict = parseStrict(value);
  if (strict !== undefined) return strict;
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try {
        return JSON.parse(value.slice(start, index + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function readField(value: unknown, field: string): unknown {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    field in value
    ? (value as Record<string, unknown>)[field]
    : "__missing__";
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
