import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { T5TrainingRecord } from "./t5-training-lib";

const sourceDirectory = path.resolve(
  "benchmark-data/training/t5gemma2-silver-extraction"
);
const outputDirectory = path.resolve(
  "benchmark-data/inference/t5gemma2-extraction-pilot"
);
const records = await readJsonl<T5TrainingRecord>(
  path.join(sourceDirectory, "validation.jsonl")
);
const silver = domainBalanced(
  records.filter((record) =>
    record.captureId.startsWith("audited-silver")
  )
);
const synthetic = domainBalanced(
  records.filter(
    (record) => !record.captureId.startsWith("audited-silver")
  )
);
const selected = interleave(silver, synthetic, 0.5, 64).slice(0, 32);
if (
  selected.filter((record) =>
    record.captureId.startsWith("audited-silver")
  ).length !== 16
) {
  throw new Error("Expected 16 audited silver evaluation records.");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
const assets = [...new Set(selected.map((record) => record.imagePath))].sort();
await Promise.all(
  assets.map((relativePath) =>
    copyFile(
      path.join(sourceDirectory, relativePath),
      path.join(outputDirectory, relativePath)
    )
  )
);
const recordsText = serializeJsonl(selected);
await writeFile(
  path.join(outputDirectory, "extraction.jsonl"),
  recordsText,
  "utf8"
);
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  policy:
    "Frozen domain- and outcome-stratified extraction pilot cohort. Contains silver validation labels, never benchmark gold.",
  sourceDataset:
    "benchmark-data/training/t5gemma2-silver-extraction/dataset-manifest.json",
  records: selected.length,
  slices: {
    silver: summarize(
      selected.filter((record) =>
        record.captureId.startsWith("audited-silver")
      )
    ),
    synthetic: summarize(
      selected.filter(
        (record) => !record.captureId.startsWith("audited-silver")
      )
    )
  },
  files: { records: "extraction.jsonl" },
  sha256: createHash("sha256").update(recordsText).digest("hex")
};
await writeFile(
  path.join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify({ outputDirectory, ...manifest }, null, 2)}\n`
);

function domainBalanced(records: T5TrainingRecord[]): T5TrainingRecord[] {
  const sites = [...new Set(records.map((record) => record.siteId))].sort();
  const buckets = new Map(
    sites.map((siteId) => [
      siteId,
      outcomeBalanced(
        records.filter((record) => record.siteId === siteId)
      )
    ])
  );
  const selected: T5TrainingRecord[] = [];
  for (let index = 0; selected.length < records.length; index += 1) {
    let added = false;
    for (const siteId of sites) {
      const record = buckets.get(siteId)?.[index];
      if (record) {
        selected.push(record);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

function outcomeBalanced(records: T5TrainingRecord[]): T5TrainingRecord[] {
  const positive = records.filter(
    (record) => !targetProduct(record).abstainReason
  );
  const abstaining = records.filter(
    (record) => Boolean(targetProduct(record).abstainReason)
  );
  const selected: T5TrainingRecord[] = [];
  for (
    let index = 0;
    selected.length < records.length;
    index += 1
  ) {
    const positiveRecord = positive[index];
    const abstainingRecord = abstaining[index];
    if (positiveRecord) selected.push(positiveRecord);
    if (abstainingRecord) selected.push(abstainingRecord);
  }
  return selected;
}

function interleave(
  silver: T5TrainingRecord[],
  synthetic: T5TrainingRecord[],
  silverShare: number,
  limit: number
): T5TrainingRecord[] {
  const selected: T5TrainingRecord[] = [];
  let silverIndex = 0;
  let syntheticIndex = 0;
  while (selected.length < limit) {
    const expectedSilver = Math.round((selected.length + 1) * silverShare);
    if (silverIndex < expectedSilver) {
      selected.push(silver[silverIndex % silver.length]!);
      silverIndex += 1;
    } else {
      selected.push(synthetic[syntheticIndex % synthetic.length]!);
      syntheticIndex += 1;
    }
  }
  return selected;
}

function targetProduct(
  record: T5TrainingRecord
): { abstainReason?: string } {
  return JSON.parse(record.target).products[0] as {
    abstainReason?: string;
  };
}

function summarize(records: T5TrainingRecord[]) {
  return {
    records: records.length,
    sites: [...new Set(records.map((record) => record.siteId))].sort(),
    comparable: records.filter(
      (record) => !targetProduct(record).abstainReason
    ).length,
    abstained: records.filter((record) =>
      Boolean(targetProduct(record).abstainReason)
    ).length
  };
}

function serializeJsonl(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + "\n";
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
