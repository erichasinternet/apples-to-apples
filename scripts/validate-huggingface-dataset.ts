import path from "node:path";
import {
  HUGGINGFACE_DATASET_LICENSE,
  HUGGINGFACE_DATASET_SLUG,
  findSensitiveText,
  huggingFaceAssetUri,
  isSafeSyntheticAssetPath,
  readJson,
  scanJsonl,
  sha256File,
  validateTrainingRecordTarget,
  type PublicTrainingRecord,
  type ReleaseFileManifest
} from "./huggingface-release-lib";

interface AssetManifest {
  version: 1;
  assets: Array<{
    path: string;
    sha256: string;
    bytes: number;
  }>;
}

export async function validateHuggingFaceRelease(
  directory: string
): Promise<void> {
  const release = await readJson<ReleaseFileManifest>(
    path.join(directory, "release-manifest.json")
  );
  const assets = await readJson<AssetManifest>(
    path.join(directory, "asset-manifest.json")
  );
  const errors: string[] = [];
  if (release.dataset !== HUGGINGFACE_DATASET_SLUG) {
    errors.push(`unexpected dataset slug`);
  }
  if (release.license !== HUGGINGFACE_DATASET_LICENSE) {
    errors.push(`dataset license must be ${HUGGINGFACE_DATASET_LICENSE}`);
  }
  if (!Object.values(release.qualityGates).every(Boolean)) {
    errors.push(`release manifest contains an unpassed quality gate`);
  }
  const expectedAssets = new Map(
    assets.assets.map((asset) => [asset.path, asset])
  );
  if (expectedAssets.size !== release.statistics.assets) {
    errors.push(`asset manifest count does not match release statistics`);
  }
  const recordIds = new Set<string>();
  const referencedAssets = new Set<string>();
  const taskCounts = { discovery: 0, extraction: 0 };
  for (const split of ["train", "validation"] as const) {
    let count = 0;
    await scanJsonl(path.join(directory, `${split}.jsonl`), (value, line) => {
      const record = value as PublicTrainingRecord;
      count += 1;
      if (record.split !== split) {
        errors.push(`${split}.jsonl:${line}: split mismatch`);
      }
      if (recordIds.has(record.id)) {
        errors.push(`${split}.jsonl:${line}: duplicate id ${record.id}`);
      }
      recordIds.add(record.id);
      if (
        record.provenance?.kind !== "synthetic" ||
        record.provenance.generatorVersion !==
          release.source.generatorVersion ||
        record.provenance.seed !== release.source.generatorSeed
      ) {
        errors.push(`${split}.jsonl:${line}: invalid provenance`);
      }
      if (
        record.image !==
          huggingFaceAssetUri(record.imagePath, release.releaseVersion) ||
        !isSafeSyntheticAssetPath(record.imagePath)
      ) {
        errors.push(`${split}.jsonl:${line}: invalid image reference`);
      } else {
        referencedAssets.add(record.imagePath);
      }
      if (!/^synthetic-shop-\d+$/.test(record.siteId)) {
        errors.push(`${split}.jsonl:${line}: non-synthetic domain`);
      }
      if (record.task === "discover-products") taskCounts.discovery += 1;
      else if (record.task === "extract-product") taskCounts.extraction += 1;
      else errors.push(`${split}.jsonl:${line}: unsupported task`);
      errors.push(
        ...validateTrainingRecordTarget(record).map(
          (error) => `${split}.jsonl:${line}: ${error}`
        )
      );
      const sensitive = findSensitiveText([
        record.id,
        record.siteId,
        record.pageId,
        record.prompt,
        record.target
      ]);
      if (sensitive.length > 0) {
        errors.push(
          `${split}.jsonl:${line}: sensitive text: ${sensitive.join(", ")}`
        );
      }
    });
    if (count !== release.statistics.records[split]) {
      errors.push(`${split} record count does not match release statistics`);
    }
  }
  if (taskCounts.discovery !== release.statistics.records.discovery) {
    errors.push(`discovery record count does not match release statistics`);
  }
  if (taskCounts.extraction !== release.statistics.records.extraction) {
    errors.push(`extraction record count does not match release statistics`);
  }
  if (
    referencedAssets.size !== expectedAssets.size ||
    [...referencedAssets].some((asset) => !expectedAssets.has(asset))
  ) {
    errors.push(`record image references do not match asset manifest`);
  }
  for (const asset of assets.assets) {
    if (!isSafeSyntheticAssetPath(asset.path)) {
      errors.push(`unsafe asset path: ${asset.path}`);
      continue;
    }
    const actual = await sha256File(path.join(directory, asset.path));
    if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes) {
      errors.push(`asset integrity mismatch: ${asset.path}`);
    }
  }
  for (const [relativePath, expected] of Object.entries(release.files)) {
    const actual = await sha256File(path.join(directory, relativePath));
    if (
      actual.sha256 !== expected.sha256 ||
      actual.bytes !== expected.bytes
    ) {
      errors.push(`release file integrity mismatch: ${relativePath}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Hugging Face release:\n${errors.join("\n")}`);
  }
}

if (import.meta.main) {
  const directory = path.resolve(
    process.argv[2] ??
      "artifacts/huggingface/unit-price-evidence-synthetic-v0.1.0"
  );
  await validateHuggingFaceRelease(directory);
  process.stdout.write(
    `${JSON.stringify({ valid: true, directory }, null, 2)}\n`
  );
}
