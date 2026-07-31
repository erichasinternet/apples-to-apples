import { createHash } from "node:crypto";
import {
  constants,
  copyFile,
  mkdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { T5DatasetSplit, T5TrainingRecord } from "./t5-training-lib";
import {
  HUGGINGFACE_DATASET_LICENSE,
  HUGGINGFACE_DATASET_SLUG,
  HUGGINGFACE_RELEASE_VERSION,
  buildReleaseStatistics,
  readJson,
  renderDatasetLicense,
  renderHuggingFaceDatasetCard,
  sha256File,
  sha256Json,
  toPublicTrainingRecord,
  validateSyntheticPointerManifest,
  validateSyntheticReleaseRecord,
  validateTrainingRecordTarget,
  type ReleaseFileManifest,
  type SyntheticPointerManifest
} from "./huggingface-release-lib";
import { validateHuggingFaceRelease } from "./validate-huggingface-dataset";

interface Options {
  sourceDirectory: string;
  outputDirectory: string;
  releaseVersion: string;
}

interface TransformResult {
  records: number;
  discovery: number;
  extraction: number;
  referencedAssets: Set<string>;
  outputHash: { sha256: string; bytes: number };
}

const options = parseOptions(process.argv.slice(2));
const sourceManifestPath = path.join(
  options.sourceDirectory,
  "dataset-manifest.json"
);
const manifest = await readJson<SyntheticPointerManifest>(sourceManifestPath);
const manifestErrors = validateSyntheticPointerManifest(manifest);
if (manifestErrors.length > 0) {
  throw new Error(`Source manifest is not releaseable:\n${manifestErrors.join("\n")}`);
}

const temporaryDirectory = `${options.outputDirectory}.tmp-${process.pid}`;
await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(path.join(temporaryDirectory, "assets"), { recursive: true });

try {
  const recordIds = new Set<string>();
  const sourceRecordHash = createHash("sha256");
  const train = await transformSplit(
    "train",
    manifest,
    options.sourceDirectory,
    temporaryDirectory,
    recordIds,
    sourceRecordHash
  );
  const validation = await transformSplit(
    "validation",
    manifest,
    options.sourceDirectory,
    temporaryDirectory,
    recordIds,
    sourceRecordHash
  );
  const actualSourceRecordHash = sourceRecordHash.digest("hex");
  if (actualSourceRecordHash !== manifest.sha256) {
    throw new Error(
      `Source record hash mismatch: ${actualSourceRecordHash} != ${manifest.sha256}`
    );
  }
  assertRecordCounts(manifest, train, validation);

  const referencedAssets = new Set([
    ...train.referencedAssets,
    ...validation.referencedAssets
  ]);
  const expectedAssets = new Set(manifest.assets.map((asset) => asset.path));
  const missingReferences = [...expectedAssets].filter(
    (asset) => !referencedAssets.has(asset)
  );
  const unknownReferences = [...referencedAssets].filter(
    (asset) => !expectedAssets.has(asset)
  );
  if (missingReferences.length > 0 || unknownReferences.length > 0) {
    throw new Error(
      [
        missingReferences.length > 0
          ? `Unreferenced assets: ${missingReferences.slice(0, 10).join(", ")}`
          : undefined,
        unknownReferences.length > 0
          ? `Unknown assets: ${unknownReferences.slice(0, 10).join(", ")}`
          : undefined
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const copiedAssets = await copyAndVerifyAssets(
    manifest,
    options.sourceDirectory,
    temporaryDirectory
  );
  const assetManifestPath = path.join(temporaryDirectory, "asset-manifest.json");
  await writeFile(
    assetManifestPath,
    `${JSON.stringify({ version: 1, assets: copiedAssets }, null, 2)}\n`,
    "utf8"
  );

  const sourceManifestSha256 = await sha256Json(sourceManifestPath);
  const statistics = buildReleaseStatistics(manifest);
  await Promise.all([
    writeFile(
      path.join(temporaryDirectory, "README.md"),
      renderHuggingFaceDatasetCard({
        releaseVersion: options.releaseVersion,
        sourceManifestSha256,
        generatorVersion: manifest.generator.version,
        generatorSeed: manifest.generator.seed,
        statistics
      }),
      "utf8"
    ),
    writeFile(
      path.join(temporaryDirectory, "LICENSE.md"),
      renderDatasetLicense(),
      "utf8"
    )
  ]);

  const releaseFiles = await hashReleaseFiles(temporaryDirectory, {
    "train.jsonl": train.outputHash,
    "validation.jsonl": validation.outputHash
  });
  const releaseManifest: ReleaseFileManifest = {
    version: 1,
    releaseVersion: options.releaseVersion,
    dataset: HUGGINGFACE_DATASET_SLUG,
    license: HUGGINGFACE_DATASET_LICENSE,
    createdAt: manifest.createdAt,
    source: {
      datasetType: manifest.datasetType,
      generatorVersion: manifest.generator.version,
      generatorSeed: manifest.generator.seed,
      sourceManifestSha256,
      sourceRecordsSha256: manifest.sha256
    },
    statistics,
    qualityGates: {
      syntheticOnly: true,
      evidencePointersValid: true,
      domainDisjoint: true,
      uniqueRecordIds: true,
      recordCountsMatch: true,
      assetsComplete: true,
      assetHashesMatch: true,
      sensitiveTextScanPassed: true,
      liveRetailerAssetsExcluded: true
    },
    files: releaseFiles
  };
  await writeFile(
    path.join(temporaryDirectory, "release-manifest.json"),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
    "utf8"
  );

  await validateHuggingFaceRelease(temporaryDirectory);
  await rm(options.outputDirectory, { recursive: true, force: true });
  await mkdir(path.dirname(options.outputDirectory), { recursive: true });
  await rename(temporaryDirectory, options.outputDirectory);

  process.stdout.write(
    `${JSON.stringify(
      {
        valid: true,
        output: options.outputDirectory,
        releaseVersion: options.releaseVersion,
        records:
          releaseManifest.statistics.records.train +
          releaseManifest.statistics.records.validation,
        products: releaseManifest.statistics.products,
        pages: releaseManifest.statistics.pages,
        domains: releaseManifest.statistics.domains,
        assets: releaseManifest.statistics.assets,
        license: releaseManifest.license,
        sourceRecordsSha256: releaseManifest.source.sourceRecordsSha256
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  await rm(temporaryDirectory, { recursive: true, force: true });
  throw error;
}

async function transformSplit(
  split: T5DatasetSplit,
  manifest: SyntheticPointerManifest,
  sourceDirectory: string,
  outputDirectory: string,
  recordIds: Set<string>,
  sourceRecordHash: ReturnType<typeof createHash>
): Promise<TransformResult> {
  const inputPath = path.join(sourceDirectory, `${split}.jsonl`);
  const outputPath = path.join(outputDirectory, `${split}.jsonl`);
  const input = createReadStream(inputPath, "utf8");
  const output = createWriteStream(outputPath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const referencedAssets = new Set<string>();
  let records = 0;
  let discovery = 0;
  let extraction = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      sourceRecordHash.update(line).update("\n");
      const value = JSON.parse(line) as T5TrainingRecord;
      const errors = validateSyntheticReleaseRecord(value, split, manifest);
      errors.push(...validateTrainingRecordTarget(value));
      if (recordIds.has(value.id)) errors.push(`duplicate record id`);
      if (errors.length > 0) {
        throw new Error(`${inputPath}:${records + 1}: ${errors.join("; ")}`);
      }
      recordIds.add(value.id);
      referencedAssets.add(value.imagePath);
      records += 1;
      if (value.task === "discover-products") discovery += 1;
      if (value.task === "extract-product") extraction += 1;
      const serialized = `${JSON.stringify(
        toPublicTrainingRecord(value, manifest, options.releaseVersion)
      )}\n`;
      if (!output.write(serialized)) await once(output, "drain");
    }
  } finally {
    output.end();
    await once(output, "finish");
  }
  return {
    records,
    discovery,
    extraction,
    referencedAssets,
    outputHash: await sha256File(outputPath)
  };
}

async function copyAndVerifyAssets(
  manifest: SyntheticPointerManifest,
  sourceDirectory: string,
  outputDirectory: string
): Promise<Array<{ path: string; sha256: string; bytes: number }>> {
  const results: Array<{ path: string; sha256: string; bytes: number }> = [];
  const concurrency = 12;
  for (let index = 0; index < manifest.assets.length; index += concurrency) {
    const chunk = manifest.assets.slice(index, index + concurrency);
    results.push(
      ...(await Promise.all(
        chunk.map(async (asset) => {
          const source = path.join(sourceDirectory, asset.path);
          const destination = path.join(outputDirectory, asset.path);
          await mkdir(path.dirname(destination), { recursive: true });
          await copyFile(source, destination, constants.COPYFILE_FICLONE);
          const output = await sha256File(destination);
          if (output.sha256 !== asset.sha256) {
            throw new Error(`Asset hash mismatch: ${asset.path}`);
          }
          return {
            path: asset.path,
            sha256: output.sha256,
            bytes: output.bytes
          };
        })
      ))
    );
  }
  return results.sort((left, right) => left.path.localeCompare(right.path));
}

async function hashReleaseFiles(
  directory: string,
  known: Record<string, { sha256: string; bytes: number }>
): Promise<Record<string, { sha256: string; bytes: number }>> {
  return {
    ...known,
    "README.md": await sha256File(path.join(directory, "README.md")),
    "LICENSE.md": await sha256File(path.join(directory, "LICENSE.md")),
    "asset-manifest.json": await sha256File(
      path.join(directory, "asset-manifest.json")
    )
  };
}

function assertRecordCounts(
  manifest: SyntheticPointerManifest,
  train: TransformResult,
  validation: TransformResult
): void {
  const errors: string[] = [];
  if (train.records !== manifest.records.train) {
    errors.push(`train records: ${train.records} != ${manifest.records.train}`);
  }
  if (validation.records !== manifest.records.validation) {
    errors.push(
      `validation records: ${validation.records} != ${manifest.records.validation}`
    );
  }
  if (train.discovery + validation.discovery !== manifest.records.discovery) {
    errors.push(`discovery record count mismatch`);
  }
  if (
    train.extraction + validation.extraction !==
    manifest.records.extraction
  ) {
    errors.push(`extraction record count mismatch`);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]!;
    const value = args[index + 1];
    if (!key.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Expected --flag value, received ${key}`);
    }
    values.set(key, value);
    index += 1;
  }
  const releaseVersion =
    values.get("--version") ?? HUGGINGFACE_RELEASE_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
    throw new Error(`--version must use semantic versioning`);
  }
  const sourceDirectory = path.resolve(
    values.get("--source") ??
      "benchmark-data/training/t5gemma2-synthetic-pointer"
  );
  const outputDirectory = path.resolve(
    values.get("--output") ??
      `artifacts/huggingface/${HUGGINGFACE_DATASET_SLUG}-v${releaseVersion}`
  );
  if (
    outputDirectory === path.parse(outputDirectory).root ||
    outputDirectory === process.cwd() ||
    outputDirectory === sourceDirectory
  ) {
    throw new Error(`Unsafe output directory: ${outputDirectory}`);
  }
  return { sourceDirectory, outputDirectory, releaseVersion };
}
