import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseT5PromptObservation,
  type T5TrainingRecord
} from "./t5-training-lib";
import {
  scoreEvidencePointer,
  type EvidencePointerScore
} from "../src/learning/evidence-pointer";

interface Prediction {
  id: string;
  prediction: string;
}

const bundle = path.resolve(
  option("--bundle") ??
    "benchmark-data/inference/t5gemma2-evidence-pointer-g1"
);
const predictionsPath = path.resolve(
  option("--predictions") ?? path.join(bundle, "predictions.jsonl")
);
const outputPath = path.resolve(
  option("--output") ??
    `${predictionsPath.slice(0, -".jsonl".length)}-score.json`
);
const [records, predictions, manifest] = await Promise.all([
  readJsonl<T5TrainingRecord>(path.join(bundle, "extraction.jsonl")),
  readJsonl<Prediction>(predictionsPath),
  readJson<{ sha256: string }>(path.join(bundle, "manifest.json"))
]);
const predictionById = new Map(
  predictions.map((prediction) => [prediction.id, prediction.prediction])
);
if (
  predictionById.size !== predictions.length ||
  predictions.length !== records.length
) {
  throw new Error("Predictions must cover every record exactly once.");
}
const samples = records.map((record) => {
  const prediction = predictionById.get(record.id);
  if (prediction === undefined) throw new Error(`${record.id}: missing prediction`);
  return {
    id: record.id,
    siteId: record.siteId,
    slice: record.captureId.startsWith("audited-silver")
      ? ("live-silver" as const)
      : ("synthetic" as const),
    ...scoreEvidencePointer(
      prediction,
      record.target,
      parseT5PromptObservation(record.prompt)
    )
  };
});
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  cohortSha256: manifest.sha256,
  predictions: path.relative(process.cwd(), predictionsPath),
  overall: summarize(samples),
  slices: {
    liveSilver: summarize(
      samples.filter((sample) => sample.slice === "live-silver")
    ),
    synthetic: summarize(
      samples.filter((sample) => sample.slice === "synthetic")
    )
  },
  samples
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      cohortSha256: report.cohortSha256,
      overall: report.overall,
      slices: report.slices
    },
    null,
    2
  )}\n`
);

function summarize(
  samples: Array<EvidencePointerScore & { siteId: string }>
): Record<string, number> {
  const comparable = samples.filter((sample) => sample.targetComparable);
  const accepted = samples.filter(
    (sample) => sample.acceptedCorrect || sample.acceptedIncorrect
  );
  return {
    records: samples.length,
    grammarValidity: rate(samples, (sample) => sample.syntaxValid),
    pointerExact: rate(samples, (sample) => sample.pointerExact),
    fieldAccuracy:
      samples.reduce((sum, sample) => sum + sample.pointerFieldsCorrect, 0) /
      Math.max(
        1,
        samples.reduce((sum, sample) => sum + sample.pointerFieldsTotal, 0)
      ),
    evidenceAcceptance: rate(samples, (sample) => sample.evidenceAccepted),
    eligibleComparable: comparable.length,
    acceptedCorrect: samples.filter((sample) => sample.acceptedCorrect).length,
    acceptedIncorrect: samples.filter((sample) => sample.acceptedIncorrect)
      .length,
    acceptedCoverage: rate(
      comparable,
      (sample) => sample.acceptedCorrect
    ),
    acceptedPrecision: rate(
      accepted,
      (sample) => sample.acceptedCorrect
    ),
    abstentionClassAccuracy: rate(
      samples,
      (sample) => sample.abstentionClassMatch
    ),
    abstentionReasonAccuracy: rate(
      samples.filter((sample) => !sample.targetComparable),
      (sample) => sample.abstentionReasonMatch
    )
  };
}

function rate<T>(values: T[], predicate: (value: T) => boolean): number {
  return values.length > 0
    ? values.filter(predicate).length / values.length
    : 0;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

async function readJsonl<T>(filename: string): Promise<T[]> {
  return (await readFile(filename, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
