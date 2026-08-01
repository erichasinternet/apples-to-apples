import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  parseT5PromptCandidateCatalog,
  parseT5PromptObservation,
  type T5DatasetSplit,
  type T5TrainingRecord
} from "./t5-training-lib";
import {
  resolveEvidencePointer,
  serializeEvidenceCandidateCatalog
} from "../src/learning/evidence-pointer";

export const HUGGINGFACE_DATASET_LICENSE = "cdla-permissive-2.0";
export const HUGGINGFACE_DATASET_SLUG = "unit-price-evidence-synthetic";
export const HUGGINGFACE_DATASET_REPO =
  "hotdogsalesman/unit-price-evidence-synthetic";
export const HUGGINGFACE_SOURCE_REPOSITORY =
  "https://github.com/erichasinternet/apples-to-apples";
export const HUGGINGFACE_RELEASE_VERSION = "0.1.0";

export interface SyntheticPointerManifest {
  version: number;
  createdAt: string;
  datasetType: string;
  targetFormat: string;
  labelSource: string;
  generator: {
    version: number;
    seed: number;
    domains: number;
    trainDomains: number;
    validationDomains: number;
    pagesPerDomain: number;
    productsPerPage: number;
    layouts: string[];
  };
  pages: number;
  uniquePages: number;
  domains: string[];
  domainSplits: {
    train: string[];
    validation: string[];
  };
  products: number;
  comparableProducts: number;
  abstainedProducts: number;
  records: {
    train: number;
    validation: number;
    discovery: number;
    extraction: number;
  };
  distributions: {
    dimensions: Record<string, number>;
    units: Record<string, number>;
    abstentionReasons: Record<string, number>;
    layouts: Record<string, number>;
    extractionPatterns: Record<string, number>;
    challengeTags: Record<string, number>;
    structuralFamilies: Record<string, number>;
  };
  assets: Array<{
    path: string;
    sha256: string;
  }>;
  sha256: string;
}

export interface PublicTrainingRecord extends T5TrainingRecord {
  image: string;
  provenance: {
    kind: "synthetic";
    generatorVersion: number;
    seed: number;
  };
}

export interface ReleaseStatistics {
  records: {
    train: number;
    validation: number;
    discovery: number;
    extraction: number;
  };
  pages: number;
  products: number;
  comparableProducts: number;
  abstainedProducts: number;
  domains: {
    total: number;
    train: number;
    validation: number;
  };
  assets: number;
  structuralFamilies: number;
  dimensions: Record<string, number>;
  challengeTags: Record<string, number>;
}

export interface ReleaseFileManifest {
  version: 1;
  releaseVersion: string;
  dataset: string;
  license: string;
  createdAt: string;
  source: {
    datasetType: string;
    generatorVersion: number;
    generatorSeed: number;
    sourceManifestSha256: string;
    sourceRecordsSha256: string;
  };
  statistics: ReleaseStatistics;
  qualityGates: {
    syntheticOnly: true;
    evidencePointersValid: true;
    domainDisjoint: true;
    uniqueRecordIds: true;
    recordCountsMatch: true;
    assetsComplete: true;
    assetHashesMatch: true;
    sensitiveTextScanPassed: true;
    liveRetailerAssetsExcluded: true;
  };
  files: Record<string, { sha256: string; bytes: number }>;
}

const SYNTHETIC_SITE = /^synthetic-shop-\d+$/;
const SYNTHETIC_PAGE = /^synthetic-shop-\d+--page-\d+$/;
const SYNTHETIC_ASSET = /^assets\/synthetic-shop-\d+--page-\d+\.png$/;
const SENSITIVE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "URL", pattern: /\bhttps?:\/\/[^\s"'<>]+/i },
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  { label: "Hugging Face token", pattern: /\bhf_[A-Za-z0-9]{20,}\b/ },
  { label: "API key", pattern: /\b(?:ak|sk)-[A-Za-z0-9_-]{16,}\b/ },
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
  },
  {
    label: "cookie header",
    pattern: /\b(?:set-cookie|cookie):\s*[^;\n]+/i
  }
];

export function validateSyntheticPointerManifest(
  manifest: SyntheticPointerManifest
): string[] {
  const errors: string[] = [];
  if (manifest.datasetType !== "synthetic-pretraining") {
    errors.push(`datasetType must be synthetic-pretraining`);
  }
  if (manifest.targetFormat !== "evidence-pointer") {
    errors.push(`targetFormat must be evidence-pointer`);
  }
  if (
    manifest.labelSource !==
    "deterministic-generator-and-evidence-validator"
  ) {
    errors.push(`labelSource is not the deterministic synthetic generator`);
  }
  if (manifest.generator.version < 2) {
    errors.push(`generator version must be at least 2`);
  }
  if (
    manifest.domains.some((siteId) => !SYNTHETIC_SITE.test(siteId)) ||
    manifest.domainSplits.train.some((siteId) => !SYNTHETIC_SITE.test(siteId)) ||
    manifest.domainSplits.validation.some(
      (siteId) => !SYNTHETIC_SITE.test(siteId)
    )
  ) {
    errors.push(`manifest contains a non-synthetic domain`);
  }
  const train = new Set(manifest.domainSplits.train);
  const overlap = manifest.domainSplits.validation.filter((siteId) =>
    train.has(siteId)
  );
  if (overlap.length > 0) {
    errors.push(`cross-split domains: ${overlap.join(", ")}`);
  }
  if (
    manifest.domainSplits.train.length !== manifest.generator.trainDomains ||
    manifest.domainSplits.validation.length !==
      manifest.generator.validationDomains
  ) {
    errors.push(`domain split counts do not match generator metadata`);
  }
  if (
    manifest.records.train + manifest.records.validation !==
    manifest.records.discovery + manifest.records.extraction
  ) {
    errors.push(`record totals are internally inconsistent`);
  }
  if (manifest.records.extraction !== manifest.products) {
    errors.push(`extraction record count does not match products`);
  }
  if (
    manifest.comparableProducts + manifest.abstainedProducts !==
    manifest.products
  ) {
    errors.push(`product outcome counts do not match products`);
  }
  if (manifest.assets.length !== manifest.pages) {
    errors.push(`asset count does not match pages`);
  }
  for (const asset of manifest.assets) {
    if (!isSafeSyntheticAssetPath(asset.path)) {
      errors.push(`unsafe or non-synthetic asset path: ${asset.path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      errors.push(`invalid asset hash: ${asset.path}`);
    }
  }
  return errors;
}

export function validateSyntheticReleaseRecord(
  value: unknown,
  expectedSplit: T5DatasetSplit,
  manifest: SyntheticPointerManifest
): string[] {
  const record = value as Partial<T5TrainingRecord>;
  const errors: string[] = [];
  if (!record || typeof record !== "object") {
    return ["record must be an object"];
  }
  if (record.version !== 1) errors.push(`version must be 1`);
  if (
    record.task !== "discover-products" &&
    record.task !== "extract-product"
  ) {
    errors.push(`unsupported task`);
  }
  if (record.split !== expectedSplit) {
    errors.push(`record split does not match ${expectedSplit} file`);
  }
  if (typeof record.id !== "string" || !record.id.startsWith("synthetic-")) {
    errors.push(`record id is not synthetic`);
  }
  if (
    typeof record.captureId !== "string" ||
    record.captureId !== `synthetic-${manifest.generator.seed}`
  ) {
    errors.push(`capture id is not the expected synthetic run`);
  }
  if (
    typeof record.siteId !== "string" ||
    !SYNTHETIC_SITE.test(record.siteId)
  ) {
    errors.push(`site id is not synthetic`);
  }
  if (
    typeof record.pageId !== "string" ||
    !SYNTHETIC_PAGE.test(record.pageId) ||
    (record.siteId && !record.pageId.startsWith(`${record.siteId}--`))
  ) {
    errors.push(`page id is not synthetic or does not match site id`);
  }
  if (
    typeof record.imagePath !== "string" ||
    !isSafeSyntheticAssetPath(record.imagePath)
  ) {
    errors.push(`image path is unsafe or not synthetic`);
  }
  if (
    typeof record.siteId === "string" &&
    !manifest.domainSplits[expectedSplit].includes(record.siteId)
  ) {
    errors.push(`site id is not assigned to ${expectedSplit}`);
  }
  if (typeof record.prompt !== "string" || record.prompt.length === 0) {
    errors.push(`prompt is missing`);
  }
  if (typeof record.target !== "string" || record.target.length === 0) {
    errors.push(`target is missing`);
  }
  if (!record.metadata || typeof record.metadata !== "object") {
    errors.push(`metadata is missing`);
  }
  const sensitive = findSensitiveText(
    [record.id, record.prompt, record.target].filter(
      (entry): entry is string => typeof entry === "string"
    )
  );
  errors.push(...sensitive.map((finding) => `sensitive text: ${finding}`));
  return errors;
}

export function toPublicTrainingRecord(
  record: T5TrainingRecord,
  manifest: SyntheticPointerManifest,
  releaseVersion = HUGGINGFACE_RELEASE_VERSION
): PublicTrainingRecord {
  return {
    ...record,
    image: huggingFaceAssetUri(record.imagePath, releaseVersion),
    provenance: {
      kind: "synthetic",
      generatorVersion: manifest.generator.version,
      seed: manifest.generator.seed
    }
  };
}

export function huggingFaceAssetUri(
  imagePath: string,
  releaseVersion: string
): string {
  return `hf://datasets/${HUGGINGFACE_DATASET_REPO}@v${releaseVersion}/${imagePath}`;
}

export function validateTrainingRecordTarget(
  record: T5TrainingRecord
): string[] {
  try {
    const observation = parseT5PromptObservation(record.prompt);
    if (observation.pageId !== record.pageId) {
      return ["prompt observation page id does not match record"];
    }
    if (record.task === "discover-products") {
      const target = JSON.parse(record.target) as {
        version?: unknown;
        pageId?: unknown;
        cardNodeIds?: unknown;
      };
      if (
        target.version !== 1 ||
        target.pageId !== record.pageId ||
        !Array.isArray(target.cardNodeIds) ||
        target.cardNodeIds.some((nodeId) => typeof nodeId !== "string")
      ) {
        return ["invalid discovery target shape"];
      }
      const nodeIds = new Set(observation.nodes.map((node) => node.id));
      const cards = target.cardNodeIds as string[];
      if (new Set(cards).size !== cards.length) {
        return ["discovery target contains duplicate node ids"];
      }
      if (cards.some((nodeId) => !nodeIds.has(nodeId))) {
        return ["discovery target references a missing observation node"];
      }
      return [];
    }
    if (record.task === "extract-product") {
      if (
        record.metadata.targetFormat !== "evidence-pointer" ||
        !record.metadata.cardNodeId
      ) {
        return ["extraction record lacks evidence-pointer metadata"];
      }
      const catalog = parseT5PromptCandidateCatalog(record.prompt);
      const expected = JSON.parse(
        serializeEvidenceCandidateCatalog(
          observation,
          record.metadata.cardNodeId
        )
      ) as unknown;
      if (JSON.stringify(catalog) !== JSON.stringify(expected)) {
        return ["candidate catalog does not match serialized observation"];
      }
      const resolved = resolveEvidencePointer(record.target, observation);
      if (!resolved.valid) {
        return [
          `invalid evidence pointer: ${resolved.issues
            .map((issue) => issue.code)
            .join(", ")}`
        ];
      }
      return [];
    }
    return ["unsupported training task"];
  } catch (error) {
    return [
      `target validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    ];
  }
}

export function findSensitiveText(values: readonly string[]): string[] {
  const findings = new Set<string>();
  for (const value of values) {
    for (const candidate of SENSITIVE_PATTERNS) {
      if (candidate.pattern.test(value)) findings.add(candidate.label);
    }
  }
  return [...findings].sort();
}

export function isSafeSyntheticAssetPath(value: string): boolean {
  return (
    SYNTHETIC_ASSET.test(value) &&
    value === path.posix.normalize(value) &&
    !value.includes("..")
  );
}

export function buildReleaseStatistics(
  manifest: SyntheticPointerManifest
): ReleaseStatistics {
  return {
    records: { ...manifest.records },
    pages: manifest.pages,
    products: manifest.products,
    comparableProducts: manifest.comparableProducts,
    abstainedProducts: manifest.abstainedProducts,
    domains: {
      total: manifest.domains.length,
      train: manifest.domainSplits.train.length,
      validation: manifest.domainSplits.validation.length
    },
    assets: manifest.assets.length,
    structuralFamilies: Object.keys(
      manifest.distributions.structuralFamilies
    ).length,
    dimensions: { ...manifest.distributions.dimensions },
    challengeTags: { ...manifest.distributions.challengeTags }
  };
}

export function renderHuggingFaceDatasetCard(input: {
  releaseVersion: string;
  sourceManifestSha256: string;
  generatorVersion: number;
  generatorSeed: number;
  statistics: ReleaseStatistics;
}): string {
  const { statistics } = input;
  const challengeRows = Object.entries(statistics.challengeTags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, count]) => `| \`${tag}\` | ${count.toLocaleString("en-US")} |`)
    .join("\n");
  const dimensionRows = Object.entries(statistics.dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([dimension, count]) =>
        `| \`${dimension}\` | ${count.toLocaleString("en-US")} |`
    )
    .join("\n");
  return `---
pretty_name: "Unit Price Evidence: Synthetic"
language:
- en
license: ${HUGGINGFACE_DATASET_LICENSE}
task_categories:
- image-text-to-text
- document-question-answering
tags:
- synthetic
- ecommerce
- unit-pricing
- document-understanding
- evidence-grounding
size_categories:
- 10K<n<100K
configs:
- config_name: default
  data_files:
  - split: train
    path: train.jsonl
  - split: validation
    path: validation.jsonl
dataset_info:
  features:
  - name: version
    dtype: int64
  - name: id
    dtype: string
  - name: task
    dtype: string
  - name: captureId
    dtype: string
  - name: pageId
    dtype: string
  - name: siteId
    dtype: string
  - name: imagePath
    dtype: string
  - name: imageCrop
    struct:
    - name: x
      dtype: int64
    - name: y
      dtype: int64
    - name: width
      dtype: int64
    - name: height
      dtype: int64
  - name: prompt
    dtype: string
  - name: metadata
    dtype: json
  - name: split
    dtype: string
  - name: target
    dtype: string
  - name: image
    dtype: image
  - name: provenance
    struct:
    - name: kind
      dtype: string
    - name: generatorVersion
      dtype: int64
    - name: seed
      dtype: int64
  splits:
  - name: train
    num_examples: ${statistics.records.train}
  - name: validation
    num_examples: ${statistics.records.validation}
---

# Unit Price Evidence: Synthetic

This dataset contains rendered synthetic shopping pages and evidence-pointer
targets for product-card discovery and unit-price field extraction. It was built
to warm-start small encoder-decoder models without redistributing retailer HTML,
screenshots, product data, account data, or browsing history.

## Release

- Version: \`${input.releaseVersion}\`
- Source code: [\`erichasinternet/apples-to-apples\`](${HUGGINGFACE_SOURCE_REPOSITORY})
- Source manifest SHA-256: \`${input.sourceManifestSha256}\`
- Records: ${(
    statistics.records.train + statistics.records.validation
  ).toLocaleString("en-US")}
- Products: ${statistics.products.toLocaleString("en-US")}
- Pages and images: ${statistics.pages.toLocaleString("en-US")}
- Synthetic domains: ${statistics.domains.total.toLocaleString("en-US")}
- Structural families: ${statistics.structuralFamilies.toLocaleString("en-US")}
- Comparable products: ${statistics.comparableProducts.toLocaleString("en-US")}
- Abstention products: ${statistics.abstainedProducts.toLocaleString("en-US")}

Train and validation domains are disjoint: ${statistics.domains.train.toLocaleString(
    "en-US"
  )} train domains and ${statistics.domains.validation.toLocaleString(
    "en-US"
  )} validation domains.

## Tasks

Each record is one of:

- \`discover-products\`: identify product-card root node IDs in a rendered
  observation region.
- \`extract-product\`: select exact title, current-price, native-unit-price,
  package-quantity, and pack-count evidence pointers, or emit a defined
  abstention.

The target deliberately contains pointers rather than normalized values. A
deterministic runtime owns parsing, arithmetic, unit conversion, and final
evidence validation.

## Record Schema

| Field | Description |
| --- | --- |
| \`id\` | Stable synthetic record identifier |
| \`task\` | \`discover-products\` or \`extract-product\` |
| \`siteId\`, \`pageId\` | Synthetic domain and page identifiers |
| \`image\` | Versioned Hugging Face URI for the rendered synthetic page image |
| \`imagePath\` | Portable path to the same image within the release |
| \`imageCrop\` | Region associated with the prompt |
| \`prompt\` | Task contract, candidates, and site-independent rendered-node observation |
| \`target\` | JSON discovery target or seven-line extraction evidence pointer |
| \`metadata\` | Region and record-shape metadata |
| \`provenance\` | Generator version, seed, and synthetic source declaration |

## Coverage

### Dimensions

| Dimension | Products |
| --- | ---: |
${dimensionRows}

### Challenge Families

| Challenge | Examples |
| --- | ---: |
${challengeRows}

The generator also varies layouts, card scope, title placement, split prices,
sale prices, multipacks, native and derived unit prices, decimal quantities, and
abstention cases.

## Generation and Validation

Pages are generated deterministically with generator version
\`${input.generatorVersion}\` and seed \`${input.generatorSeed}\`, rendered in
Chromium, observed through a generic rendered-node serializer, and labeled from
known source structure. Every extraction target is resolved against its candidate
catalog. Release validation enforces:

- synthetic-only domains and assets;
- disjoint train and validation domains;
- unique record IDs and exact manifest counts;
- complete image references and SHA-256 asset verification;
- evidence-pointer validity;
- absence of URLs, email addresses, credentials, cookies, and private keys; and
- exclusion of raw and derived live-retailer captures.

\`release-manifest.json\` and \`asset-manifest.json\` contain the reproducibility
metadata and content hashes.

## Loading

The JSONL files load directly with
[\`datasets\`](https://huggingface.co/docs/datasets). The \`image\` column uses
a versioned \`hf://\` URI so it decodes as an image in both the Dataset Viewer
and \`datasets\`. The separate \`imagePath\` column keeps a portable relative
path for local pipelines without embedding the same page image into every
product record.

\`\`\`python
from datasets import load_dataset

dataset = load_dataset(
    "${HUGGINGFACE_DATASET_REPO}",
    revision="v${input.releaseVersion}",
)
\`\`\`

## Intended Uses

- Synthetic warm-start training for product discovery and evidence selection.
- Pipeline, parser, and data-loader testing.
- Controlled ablations for unit-price extraction.
- Research on grounded structured extraction from rendered shopping interfaces.

## Limitations and Prohibited Claims

This is synthetic pretraining data, not a real-site benchmark. It must not be
used by itself to claim:

- live-site or universal shopping-site accuracy;
- production readiness;
- model promotion on held-out domains; or
- demographic, geographic, retailer, or market representativeness.

The pages are English-language, use USD-like prices, and intentionally cover a
designed distribution rather than the frequency distribution of the public web.
They do not reproduce every accessibility tree, virtualization strategy,
international price convention, anti-bot page, variant interaction, or malformed
DOM encountered in production.

## Privacy and Rights

All examples, product names, brands, domains, page layouts, labels, and rendered
images are generated by the Apples to Apples project. This release contains no
live retailer captures or user browsing data.

## License

The dataset artifacts in this release are licensed under the Community Data
License Agreement - Permissive - Version 2.0 (CDLA-Permissive-2.0). The license
applies to the dataset package only; it does not change the license of the
application source repository.

## Citation

\`\`\`bibtex
@dataset{unit_price_evidence_synthetic_${input.releaseVersion.replace(
    /\W/g,
    "_"
  )},
  title = {Unit Price Evidence: Synthetic},
  author = {Apples to Apples contributors},
  year = {2026},
  version = {${input.releaseVersion}}
}
\`\`\`
`;
}

export function renderDatasetLicense(): string {
  return `# Community Data License Agreement - Permissive - Version 2.0

This is the Community Data License Agreement - Permissive, Version 2.0 (the "agreement"). Data Provider(s) and Data Recipient(s) agree as follows:

## 1. Provision of the Data

1.1. A Data Recipient may use, modify, and share the Data made available by Data Provider(s) under this agreement if that Data Recipient follows the terms of this agreement.

1.2. This agreement does not impose any restriction on a Data Recipient's use, modification, or sharing of any portions of the Data that are in the public domain or that may be used, modified, or shared under any other legal exception or limitation.

## 2. Conditions for Sharing Data

2.1. A Data Recipient may share Data, with or without modifications, so long as the Data Recipient makes available the text of this agreement with the shared Data.

## 3. No Restrictions on Results

3.1. This agreement does not impose any restriction or obligations with respect to the use, modification, or sharing of Results.

## 4. No Warranty; Limitation of Liability

4.1. All Data Recipients receive the Data subject to the following terms:

THE DATA IS PROVIDED ON AN "AS IS" BASIS, WITHOUT REPRESENTATIONS, WARRANTIES OR CONDITIONS OF ANY KIND, EITHER EXPRESS OR IMPLIED INCLUDING, WITHOUT LIMITATION, ANY WARRANTIES OR CONDITIONS OF TITLE, NON-INFRINGEMENT, MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.
NO DATA PROVIDER SHALL HAVE ANY LIABILITY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING WITHOUT LIMITATION LOST PROFITS), HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE DATA OR RESULTS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.

## 5. Definitions

5.1. "Data" means the material received by a Data Recipient under this agreement.

5.2. "Data Provider" means any person who is the source of Data provided under this agreement and in reliance on a Data Recipient's agreement to its terms.

5.3. "Data Recipient" means any person who receives Data directly or indirectly from a Data Provider and agrees to the terms of this agreement.

5.4. "Results" means any outcome obtained by computational analysis of Data, including for example machine learning models and models' insights.

---

SPDX-License-Identifier: CDLA-Permissive-2.0

This license applies only to this generated dataset release. It does not
relicense the application source repository, live retailer captures, or any
other artifact not included in this release.
`;
}

export async function sha256File(
  filename: string
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function sha256Json(filename: string): Promise<string> {
  return (await sha256File(filename)).sha256;
}

export async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

export async function scanJsonl(
  filename: string,
  onRecord: (value: unknown, lineNumber: number) => void | Promise<void>
): Promise<void> {
  const input = createReadStream(filename, "utf8");
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`${filename}:${lineNumber}: invalid JSON`);
    }
    await onRecord(value, lineNumber);
  }
}
