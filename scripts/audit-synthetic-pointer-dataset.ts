import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseT5PromptObservation,
  parseT5PromptCandidateCatalog,
  type T5TrainingRecord
} from "./t5-training-lib";
import {
  resolveEvidencePointer,
  serializeEvidenceCandidateCatalog
} from "../src/learning/evidence-pointer";
import type {
  IdealDatasetTargets
} from "./ideal-dataset-lib";

interface SyntheticManifest {
  version: number;
  targetFormat: string;
  generator: {
    version: number;
  };
  products: number;
  domainSplits: {
    train: string[];
    validation: string[];
  };
  distributions: {
    challengeTags: Record<string, number>;
    structuralFamilies: Record<string, number>;
  };
  sha256: string;
}

const directory = path.resolve(
  process.argv[2] ?? "benchmark-data/training/t5gemma2-synthetic-pointer"
);
const [manifest, targets, trainText, validationText] = await Promise.all([
  readJson<SyntheticManifest>(path.join(directory, "dataset-manifest.json")),
  readJson<IdealDatasetTargets>(
    path.resolve("benchmarks/ideal-dataset-targets.json")
  ),
  readFile(path.join(directory, "train.jsonl"), "utf8"),
  readFile(path.join(directory, "validation.jsonl"), "utf8")
]);
const train = parseJsonl(trainText);
const validation = parseJsonl(validationText);
const records = [...train, ...validation];
const errors: string[] = [];
if (manifest.targetFormat !== "evidence-pointer") {
  errors.push("targetFormat must be evidence-pointer");
}
if (manifest.generator.version < 2) {
  errors.push("generator version must support pointer challenge families");
}
if (manifest.products < targets.synthetic.targetProducts) {
  errors.push(
    `products: ${manifest.products} < ${targets.synthetic.targetProducts}`
  );
}
const familyCount = Object.keys(
  manifest.distributions.structuralFamilies
).length;
if (familyCount < targets.synthetic.minimumStructuralFamilies) {
  errors.push(
    `structuralFamilies: ${familyCount} < ${targets.synthetic.minimumStructuralFamilies}`
  );
}
for (const tag of Object.keys(
  targets.distribution.minimumProductChallengeCounts
)) {
  const actual = manifest.distributions.challengeTags[tag] ?? 0;
  if (actual < targets.synthetic.minimumExamplesPerRarePattern) {
    errors.push(
      `challenge.${tag}: ${actual} < ${targets.synthetic.minimumExamplesPerRarePattern}`
    );
  }
}
const overlap = manifest.domainSplits.train.filter((domain) =>
  manifest.domainSplits.validation.includes(domain)
);
if (overlap.length > 0) {
  errors.push(`cross-split domains: ${overlap.join(", ")}`);
}
const actualHash = createHash("sha256")
  .update(trainText)
  .update(validationText)
  .digest("hex");
if (actualHash !== manifest.sha256) {
  errors.push("training record hash does not match manifest");
}

let pointerRecords = 0;
let invalidPointers = 0;
for (const record of records) {
  if (record.task !== "extract-product") continue;
  pointerRecords += 1;
  if (record.metadata.targetFormat !== "evidence-pointer") {
    invalidPointers += 1;
    continue;
  }
  try {
    const observation = parseT5PromptObservation(record.prompt);
    const catalog = parseT5PromptCandidateCatalog(record.prompt);
    const cardNodeId = record.metadata.cardNodeId;
    const expectedCatalog = cardNodeId
      ? JSON.parse(
          serializeEvidenceCandidateCatalog(observation, cardNodeId)
        )
      : undefined;
    if (
      !cardNodeId ||
      JSON.stringify(catalog) !== JSON.stringify(expectedCatalog) ||
      !resolveEvidencePointer(record.target, observation).valid
    ) {
      invalidPointers += 1;
    }
  } catch {
    invalidPointers += 1;
  }
}
if (pointerRecords !== manifest.products) {
  errors.push(
    `pointer extraction records: ${pointerRecords} != ${manifest.products}`
  );
}
if (invalidPointers > 0) {
  errors.push(`invalid pointer records: ${invalidPointers}`);
}

const report = {
  valid: errors.length === 0,
  directory,
  products: manifest.products,
  pointerRecords,
  invalidPointers,
  structuralFamilies: familyCount,
  challengeTags: manifest.distributions.challengeTags,
  sha256: actualHash,
  errors
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;

function parseJsonl(value: string): T5TrainingRecord[] {
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T5TrainingRecord);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
