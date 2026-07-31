import {
  HUGGINGFACE_DATASET_LICENSE,
  buildReleaseStatistics,
  findSensitiveText,
  renderHuggingFaceDatasetCard,
  toPublicTrainingRecord,
  validateSyntheticPointerManifest,
  validateSyntheticReleaseRecord,
  validateTrainingRecordTarget,
  type SyntheticPointerManifest
} from "../../scripts/huggingface-release-lib";
import type { T5TrainingRecord } from "../../scripts/t5-training-lib";

describe("Hugging Face synthetic dataset release", () => {
  it("accepts a synthetic record and adds public image provenance", () => {
    const manifest = makeManifest();
    const record = makeRecord();

    expect(validateSyntheticReleaseRecord(record, "train", manifest)).toEqual([]);
    expect(toPublicTrainingRecord(record, manifest)).toMatchObject({
      image:
        "hf://datasets/hotdogsalesman/unit-price-evidence-synthetic@v0.1.0/assets/synthetic-shop-01--page-01.png",
      provenance: {
        kind: "synthetic",
        generatorVersion: 2,
        seed: 20260724
      }
    });
  });

  it("rejects live domains, unsafe assets, split leakage, and sensitive text", () => {
    const manifest = makeManifest();
    const record = makeRecord({
      siteId: "walmart",
      pageId: "walmart--cat-litter",
      imagePath: "../live/walmart.png",
      prompt: "https://retailer.example account@example.com hf_abcdefghijklmnopqrstuvwxyz"
    });

    expect(validateSyntheticReleaseRecord(record, "validation", manifest)).toEqual(
      expect.arrayContaining([
        "record split does not match validation file",
        "site id is not synthetic",
        "page id is not synthetic or does not match site id",
        "image path is unsafe or not synthetic",
        "site id is not assigned to validation",
        "sensitive text: URL",
        "sensitive text: email address",
        "sensitive text: Hugging Face token"
      ])
    );
  });

  it("rejects a manifest containing a non-synthetic domain", () => {
    const manifest = makeManifest({
      domains: ["synthetic-shop-01", "walmart"]
    });

    expect(validateSyntheticPointerManifest(manifest)).toContain(
      "manifest contains a non-synthetic domain"
    );
  });

  it("renders a transparent card with license and prohibited claims", () => {
    const manifest = makeManifest();
    const card = renderHuggingFaceDatasetCard({
      releaseVersion: "0.1.0",
      sourceManifestSha256: "a".repeat(64),
      generatorVersion: manifest.generator.version,
      generatorSeed: manifest.generator.seed,
      statistics: buildReleaseStatistics(manifest)
    });

    expect(card).toContain(`license: ${HUGGINGFACE_DATASET_LICENSE}`);
    expect(card).toContain('pretty_name: "Unit Price Evidence: Synthetic"');
    expect(card).toContain("dtype: image");
    expect(card).toContain("num_examples: 2");
    expect(card).toContain("This is synthetic pretraining data");
    expect(card).toContain("live-site or universal shopping-site accuracy");
    expect(card).toMatch(/contains no\s+live retailer captures/);
    expect(card).toContain("seed `20260724`");
    expect(card).toContain('revision="v0.1.0"');
  });

  it("scans credentials without mistaking evidence pointer IDs for email", () => {
    expect(findSensitiveText(["CURRENT_PRICE n12@p0"])).toEqual([]);
    expect(
      findSensitiveText([
        "Bearer abcdefghijklmnopqrstuvwxyz",
        "-----BEGIN PRIVATE KEY-----"
      ])
    ).toEqual(["bearer token", "private key"]);
  });

  it("validates discovery targets against the serialized observation", () => {
    const observation =
      '{"pageId":"synthetic-shop-01--page-01","title":"Synthetic",' +
      '"region":{"x":0,"y":0,"width":100,"height":100},"rootNodeId":"n0",' +
      '"nodes":[{"id":"n0","tag":"main","bounds":{"x":0,"y":0,"width":100,"height":100},' +
      '"style":{"position":"static","fontSize":16,"fontWeight":400}},' +
      '{"id":"n1","parent":"n0","tag":"article","bounds":{"x":0,"y":0,"width":50,"height":50},' +
      '"style":{"position":"static","fontSize":16,"fontWeight":400}}]}';
    const record = makeRecord({
      task: "discover-products",
      prompt: `TASK: discover-products\nOBSERVATION: ${observation}`,
      target:
        '{"version":1,"pageId":"synthetic-shop-01--page-01","cardNodeIds":["n1"]}'
    });

    expect(validateTrainingRecordTarget(record)).toEqual([]);
    expect(
      validateTrainingRecordTarget({
        ...record,
        target:
          '{"version":1,"pageId":"synthetic-shop-01--page-01","cardNodeIds":["n9"]}'
      })
    ).toEqual(["discovery target references a missing observation node"]);
  });
});

function makeManifest(
  overrides: Partial<SyntheticPointerManifest> = {}
): SyntheticPointerManifest {
  return {
    version: 1,
    createdAt: "2026-07-25T00:00:00.000Z",
    datasetType: "synthetic-pretraining",
    targetFormat: "evidence-pointer",
    labelSource: "deterministic-generator-and-evidence-validator",
    generator: {
      version: 2,
      seed: 20260724,
      domains: 2,
      trainDomains: 1,
      validationDomains: 1,
      pagesPerDomain: 1,
      productsPerPage: 1,
      layouts: ["market-grid"]
    },
    pages: 2,
    uniquePages: 2,
    domains: ["synthetic-shop-01", "synthetic-shop-02"],
    domainSplits: {
      train: ["synthetic-shop-01"],
      validation: ["synthetic-shop-02"]
    },
    products: 2,
    comparableProducts: 1,
    abstainedProducts: 1,
    records: {
      train: 2,
      validation: 2,
      discovery: 2,
      extraction: 2
    },
    distributions: {
      dimensions: { mass: 1 },
      units: { oz: 1 },
      abstentionReasons: { "conditional-price": 1 },
      layouts: { "market-grid": 2 },
      extractionPatterns: { "current-price+package-quantity": 1 },
      challengeTags: { multipack: 1 },
      structuralFamilies: { family: 1 }
    },
    assets: [
      {
        path: "assets/synthetic-shop-01--page-01.png",
        sha256: "a".repeat(64)
      },
      {
        path: "assets/synthetic-shop-02--page-01.png",
        sha256: "b".repeat(64)
      }
    ],
    sha256: "c".repeat(64),
    ...overrides
  };
}

function makeRecord(
  overrides: Partial<T5TrainingRecord> = {}
): T5TrainingRecord {
  return {
    version: 1,
    id: "synthetic-20260724--synthetic-shop-01-page-01--extract-n1",
    task: "extract-product",
    captureId: "synthetic-20260724",
    pageId: "synthetic-shop-01--page-01",
    siteId: "synthetic-shop-01",
    imagePath: "assets/synthetic-shop-01--page-01.png",
    imageCrop: { x: 0, y: 0, width: 100, height: 100 },
    prompt: "TASK: extract-product\nCURRENT_PRICE n12@p0",
    metadata: {
      sourceRegion: { x: 0, y: 0, width: 100, height: 100 },
      nodeCount: 1,
      cardNodeId: "n1",
      targetFormat: "evidence-pointer"
    },
    split: "train",
    target:
      "CARD n1\nTITLE n2\nCURRENT_PRICE n12@p0\nNATIVE_UNIT_PRICE NONE\nPACKAGE_QUANTITY NONE\nPACK_COUNT NONE\nSTATUS comparable",
    ...overrides
  };
}
