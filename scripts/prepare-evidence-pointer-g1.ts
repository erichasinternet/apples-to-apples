import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ModelPageExtraction } from "../src/learning/contracts";
import {
  resolveEvidencePointer,
  serializeEvidencePointer
} from "../src/learning/evidence-pointer";
import {
  buildEvidencePointerPrompt,
  parseT5PromptObservation,
  type T5TrainingRecord
} from "./t5-training-lib";

const sourceDirectory = path.resolve(
  "benchmark-data/inference/t5gemma2-extraction-pilot"
);
const outputDirectory = path.resolve(
  "benchmark-data/inference/t5gemma2-evidence-pointer-g1"
);
const [records, sourceManifestBytes, baselineBytes] = await Promise.all([
  readJsonl<T5TrainingRecord>(
    path.join(sourceDirectory, "extraction.jsonl")
  ),
  readFile(path.join(sourceDirectory, "manifest.json")),
  readFile(
    path.join(
      sourceDirectory,
      "predictions-1b-explicit-contract-score.json"
    )
  )
]);
const sourceManifest = JSON.parse(
  sourceManifestBytes.toString("utf8")
) as { sha256: string };
const converted = records.map((record): T5TrainingRecord => {
  const observation = parseT5PromptObservation(record.prompt);
  const extraction = JSON.parse(record.target) as ModelPageExtraction;
  const product = extraction.products[0];
  if (!product) throw new Error(`${record.id}: target lacks a product`);
  const target = serializeEvidencePointer(product, observation);
  const resolved = resolveEvidencePointer(target, observation);
  if (!resolved.valid) {
    throw new Error(
      `${record.id}: pointer conversion failed: ${resolved.issues
        .map((issue) => issue.code)
        .join(", ")}`
    );
  }
  return {
    ...record,
    prompt: buildEvidencePointerPrompt(observation, product.cardNodeId),
    target,
    metadata: {
      ...record.metadata,
      targetFormat: "evidence-pointer"
    }
  };
});

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
const assets = [...new Set(converted.map((record) => record.imagePath))].sort();
await Promise.all(
  assets.map((asset) =>
    copyFile(
      path.join(sourceDirectory, asset),
      path.join(outputDirectory, asset)
    )
  )
);
const recordsText = `${converted
  .map((record) => JSON.stringify(record))
  .join("\n")}\n`;
const sha256 = hash(recordsText);
await writeFile(
  path.join(outputDirectory, "extraction.jsonl"),
  recordsText,
  "utf8"
);
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  purpose: "G1 causal output-formulation comparison",
  eligibility:
    "Diagnostic only. Live labels are audited silver, not dual-reviewed adjudicated gold.",
  sourceCohortSha256: sourceManifest.sha256,
  sourceManifestSha256: hash(sourceManifestBytes),
  jsonBaselineReportSha256: hash(baselineBytes),
  records: converted.length,
  liveSilverRecords: converted.filter((record) =>
    record.captureId.startsWith("audited-silver")
  ).length,
  syntheticRecords: converted.filter(
    (record) => !record.captureId.startsWith("audited-silver")
  ).length,
  targetFormat: "evidence-pointer",
  pointerTargetsValidated: converted.length,
  sha256
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify({ outputDirectory, ...manifest }, null, 2)}\n`
);

async function readJsonl<T>(filename: string): Promise<T[]> {
  return (await readFile(filename, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
