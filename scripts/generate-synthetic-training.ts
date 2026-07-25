import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { PageObservation } from "../src/learning/contracts";
import { capturePageObservation } from "../src/learning/page-observation";
import type { AnnotatedProduct, CorpusAnnotation } from "./live-corpus-lib";
import {
  buildT5TrainingRecords,
  countExtractionOutcomes,
  type T5DatasetSplit,
  type T5ExtractionTargetFormat,
  type T5TrainingRecord
} from "./t5-training-lib";
import {
  createSyntheticPage,
  syntheticStructuralFamily,
  SYNTHETIC_GENERATOR_VERSION,
  type SyntheticPage,
  type SyntheticProduct
} from "./synthetic-training-lib";
import { buildTrainingExample } from "./training-export-lib";

interface GeneratorOptions {
  outputDirectory: string;
  domains: number;
  pagesPerDomain: number;
  productsPerPage: number;
  validationDomains: number;
  seed: number;
  targetFormat: T5ExtractionTargetFormat;
}

interface ProductNodeReferences {
  card: string;
  title: string;
  price?: string;
  quantity?: string;
  native?: string;
}

const options = parseOptions(process.argv.slice(2));
const trainDomainCount = options.domains - options.validationDomains;
const domainAssignments = Array.from({ length: options.domains }, (_, index) => ({
  index,
  siteId: `synthetic-shop-${String(index + 1).padStart(2, "0")}`,
  split: (index < trainDomainCount ? "train" : "validation") as T5DatasetSplit
}));
const expectedPages = options.domains * options.pagesPerDomain;
const expectedProducts = expectedPages * options.productsPerPage;

await resetOutputDirectory(options.outputDirectory);
const assetsDirectory = path.join(options.outputDirectory, "assets");
const sourcesDirectory = path.join(options.outputDirectory, "sources");
await Promise.all([
  mkdir(assetsDirectory, { recursive: true }),
  mkdir(sourcesDirectory, { recursive: true })
]);

let browser: Browser | undefined;
const records: T5TrainingRecord[] = [];
const assets: Array<{ path: string; sha256: string }> = [];
const layouts = new Set<string>();
const sourceHashes: Array<{
  pageId: string;
  htmlPath: string;
  htmlSha256: string;
  observationPath: string;
  observationSha256: string;
  annotationPath: string;
  annotationSha256: string;
}> = [];
const distributions = {
  dimensions: {} as Record<string, number>,
  units: {} as Record<string, number>,
  abstentionReasons: {} as Record<string, number>,
  layouts: {} as Record<string, number>,
  extractionPatterns: {} as Record<string, number>,
  challengeTags: {} as Record<string, number>,
  structuralFamilies: {} as Record<string, number>
};
let productCount = 0;
let pageCount = 0;
let comparableProducts = 0;
let abstainedProducts = 0;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 2600 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce"
  });
  const page = await context.newPage();

  for (const domain of domainAssignments) {
    for (let pageIndex = 0; pageIndex < options.pagesPerDomain; pageIndex += 1) {
      const synthetic = createSyntheticPage({
        seed: options.seed,
        domainIndex: domain.index,
        pageIndex,
        productsPerPage: options.productsPerPage,
        siteId: domain.siteId
      });
      const generated = await captureSyntheticPage(page, synthetic);
      const sourceDirectory = path.join(sourcesDirectory, synthetic.pageId);
      await mkdir(sourceDirectory, { recursive: true });
      const observationText = `${JSON.stringify(generated.observation, null, 2)}\n`;
      const annotationText = `${JSON.stringify(generated.annotation, null, 2)}\n`;
      const htmlPath = path.posix.join("sources", synthetic.pageId, "page.html");
      const observationPath = path.posix.join(
        "sources",
        synthetic.pageId,
        "observation.json"
      );
      const annotationPath = path.posix.join(
        "sources",
        synthetic.pageId,
        "annotation.json"
      );
      await Promise.all([
        writeFile(path.join(sourceDirectory, "page.html"), synthetic.html, "utf8"),
        writeFile(path.join(sourceDirectory, "observation.json"), observationText, "utf8"),
        writeFile(path.join(sourceDirectory, "annotation.json"), annotationText, "utf8")
      ]);

      const assetFilename = `${synthetic.pageId}.png`;
      const imagePath = path.posix.join("assets", assetFilename);
      const imageBuffer = await page
        .locator(`[data-synthetic-page="${synthetic.pageId}"]`)
        .screenshot({ animations: "disabled", caret: "hide", type: "png" });
      await writeFile(path.join(assetsDirectory, assetFilename), imageBuffer);
      assets.push({
        path: imagePath,
        sha256: createHash("sha256").update(imageBuffer).digest("hex")
      });

      const built = buildTrainingExample(
        synthetic.siteId,
        generated.observation,
        generated.annotation
      );
      if (!built.example) {
        throw new Error(
          `${synthetic.pageId}: generated labels failed evidence validation:\n${built.errors.join("\n")}`
        );
      }
      records.push(
        ...buildT5TrainingRecords(built.example, {
          captureId: `synthetic-${options.seed}`,
          split: domain.split,
          imagePath,
          extractionTargetFormat: options.targetFormat
        })
      );
      const outcomes = countExtractionOutcomes(built.example.target.products);
      comparableProducts += outcomes.comparable;
      abstainedProducts += outcomes.abstained;
      productCount += built.example.target.products.length;
      pageCount += 1;
      layouts.add(synthetic.layout);
      increment(distributions.layouts, synthetic.layout);
      for (const product of synthetic.products) {
        increment(
          distributions.structuralFamilies,
          syntheticStructuralFamily(synthetic.layout, product)
        );
        for (const tag of product.challengeTags ?? []) {
          increment(distributions.challengeTags, tag);
        }
        if (product.abstainReason) {
          increment(distributions.abstentionReasons, product.abstainReason);
        }
        const groundedQuantity = product.quantity ?? product.nativeUnitPrice;
        if (groundedQuantity) {
          increment(distributions.dimensions, groundedQuantity.dimension);
          increment(distributions.units, groundedQuantity.unit);
        }
        increment(
          distributions.extractionPatterns,
          product.abstainReason
            ? "abstention"
            : [
                "current-price",
                product.quantity ? "package-quantity" : undefined,
                product.nativeUnitPrice ? "native-unit-price" : undefined
              ]
                .filter(Boolean)
                .join("+")
        );
      }
      sourceHashes.push({
        pageId: synthetic.pageId,
        htmlPath,
        htmlSha256: sha256(synthetic.html),
        observationPath,
        observationSha256: sha256(observationText),
        annotationPath,
        annotationSha256: sha256(annotationText)
      });

      if (pageCount % 10 === 0 || pageCount === expectedPages) {
        process.stderr.write(
          `Generated ${pageCount}/${expectedPages} pages and ${productCount}/${expectedProducts} products\n`
        );
      }
    }
  }
  await context.close();
} finally {
  await browser?.close();
}

if (pageCount !== expectedPages || productCount !== expectedProducts) {
  throw new Error(
    `Generated ${pageCount}/${expectedPages} pages and ${productCount}/${expectedProducts} products`
  );
}

records.sort((left, right) => left.id.localeCompare(right.id));
const trainRecords = records.filter((record) => record.split === "train");
const validationRecords = records.filter((record) => record.split === "validation");
const trainText = serializeJsonl(trainRecords);
const validationText = serializeJsonl(validationRecords);
await Promise.all([
  writeFile(path.join(options.outputDirectory, "train.jsonl"), trainText, "utf8"),
  writeFile(path.join(options.outputDirectory, "validation.jsonl"), validationText, "utf8")
]);

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  datasetType: "synthetic-pretraining",
  targetFormat: options.targetFormat,
  labelSource: "deterministic-generator-and-evidence-validator",
  generator: {
    version: SYNTHETIC_GENERATOR_VERSION,
    seed: options.seed,
    domains: options.domains,
    trainDomains: trainDomainCount,
    validationDomains: options.validationDomains,
    pagesPerDomain: options.pagesPerDomain,
    productsPerPage: options.productsPerPage,
    layouts: [...layouts].sort()
  },
  sourceRuns: [`synthetic-v${SYNTHETIC_GENERATOR_VERSION}-${options.seed}`],
  files: {
    train: "train.jsonl",
    validation: "validation.jsonl"
  },
  strict: true,
  allowSingleReview: false,
  discoveryChunkHeight: 900,
  cardPadding: 24,
  pages: pageCount,
  uniquePages: pageCount,
  domains: domainAssignments.map((domain) => domain.siteId),
  domainSplits: {
    train: domainAssignments
      .filter((domain) => domain.split === "train")
      .map((domain) => domain.siteId),
    validation: domainAssignments
      .filter((domain) => domain.split === "validation")
      .map((domain) => domain.siteId)
  },
  products: productCount,
  comparableProducts,
  abstainedProducts,
  records: {
    train: trainRecords.length,
    validation: validationRecords.length,
    discovery: records.filter((record) => record.task === "discover-products").length,
    extraction: records.filter((record) => record.task === "extract-product").length
  },
  distributions,
  assets: assets.sort((left, right) => left.path.localeCompare(right.path)),
  sourceHashes: sourceHashes.sort((left, right) => left.pageId.localeCompare(right.pageId)),
  sha256: createHash("sha256").update(trainText).update(validationText).digest("hex")
};
await writeFile(
  path.join(options.outputDirectory, "dataset-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify(
    {
      valid: true,
      output: options.outputDirectory,
      targetFormat: manifest.targetFormat,
      generatorVersion: manifest.generator.version,
      pages: manifest.pages,
      products: manifest.products,
      comparableProducts: manifest.comparableProducts,
      abstainedProducts: manifest.abstainedProducts,
      structuralFamilies: Object.keys(
        manifest.distributions.structuralFamilies
      ).length,
      challengeTags: manifest.distributions.challengeTags,
      sha256: manifest.sha256
    },
    null,
    2
  )}\n`
);

async function captureSyntheticPage(
  page: Page,
  synthetic: SyntheticPage
): Promise<{ observation: PageObservation; annotation: CorpusAnnotation }> {
  await page.setContent(synthetic.html, { waitUntil: "load" });
  const observation = await page.evaluate(capturePageObservation, {
    pageId: synthetic.pageId,
    maxNodes: 10_000
  });
  const root = observation.nodes.find((node) => node.id === observation.rootNodeId);
  if (!root || observation.truncated) {
    throw new Error(`${synthetic.pageId}: invalid or truncated observation`);
  }

  const references = await page.evaluate(() => {
    const nodeId = (element: Element | null): string | undefined =>
      element?.getAttribute("data-ata-benchmark-node") ?? undefined;
    return [...document.querySelectorAll<HTMLElement>("[data-synth-card]")].map(
      (card) => {
        const key = card.getAttribute("data-synth-card") ?? "";
        return {
          key,
          card: nodeId(card),
          title: nodeId(card.querySelector(`[data-synth-title="${key}"]`)),
          price: nodeId(card.querySelector(`[data-synth-price="${key}"]`)),
          quantity: nodeId(card.querySelector(`[data-synth-quantity="${key}"]`)),
          native: nodeId(card.querySelector(`[data-synth-native="${key}"]`))
        };
      }
    );
  });
  const referenceMap = new Map(
    references.map((reference) => [
      reference.key,
      requireReferences(synthetic.pageId, reference)
    ])
  );
  const products = synthetic.products.map((product) =>
    annotateProduct(product, referenceMap.get(product.key))
  );
  const region = {
    x: Math.round(root.bounds.x),
    y: Math.round(root.bounds.y),
    width: Math.round(root.bounds.width),
    height: Math.round(root.bounds.height)
  };
  return {
    observation,
    annotation: {
      version: 1,
      pageId: synthetic.pageId,
      reviewStatus: "adjudicated",
      coverage: "complete-main-region",
      region,
      annotators: [
        `synthetic-generator-v${SYNTHETIC_GENERATOR_VERSION}`,
        "deterministic-evidence-validator-v1"
      ],
      products
    }
  };
}

function requireReferences(
  pageId: string,
  reference: {
    key: string;
    card: string | undefined;
    title: string | undefined;
    price: string | undefined;
    quantity: string | undefined;
    native: string | undefined;
  }
): ProductNodeReferences {
  if (!reference.card || !reference.title) {
    throw new Error(`${pageId}/${reference.key}: missing card or title node`);
  }
  return {
    card: reference.card,
    title: reference.title,
    ...(reference.price ? { price: reference.price } : {}),
    ...(reference.quantity ? { quantity: reference.quantity } : {}),
    ...(reference.native ? { native: reference.native } : {})
  };
}

function annotateProduct(
  product: SyntheticProduct,
  references: ProductNodeReferences | undefined
): AnnotatedProduct {
  if (!references) {
    throw new Error(`Missing node references for ${product.key}`);
  }
  const evidenceNodeIds = [
    references.title,
    references.price,
    references.quantity,
    references.native
  ].filter((value): value is string => Boolean(value));
  if (!product.comparable) {
    if (!product.abstainReason) {
      throw new Error(`${product.key}: non-comparable product lacks an abstention reason`);
    }
    return {
      nodeId: references.card,
      scope: product.scope ?? "primary-results",
      comparable: false,
      ...(product.challengeTags ? { challengeTags: product.challengeTags } : {}),
      title: product.title,
      evidenceNodeIds,
      fieldEvidence: { title: [references.title] },
      abstainReason: product.abstainReason,
      notes: "Programmatic abstention example."
    };
  }
  if (product.priceCents === undefined || !references.price) {
    throw new Error(`${product.key}: comparable product lacks price evidence`);
  }
  return {
    nodeId: references.card,
    scope: product.scope ?? "primary-results",
    comparable: true,
    ...(product.challengeTags ? { challengeTags: product.challengeTags } : {}),
    title: product.title,
    evidenceNodeIds,
    fieldEvidence: {
      title: [references.title],
      currentPrice: [references.price],
      ...(product.quantity && references.quantity
        ? { packageQuantity: [references.quantity] }
        : {}),
      ...(product.nativeUnitPrice && references.native
        ? { nativeUnitPrice: [references.native] }
        : {})
    },
    currentPriceCents: product.priceCents,
    ...(product.quantity
      ? {
          packageQuantity: {
            valuePerPackage: product.quantity.valuePerPackage,
            packCount: product.quantity.packCount,
            unit: product.quantity.unit,
            dimension: product.quantity.dimension
          }
        }
      : {}),
    ...(product.nativeUnitPrice
      ? {
          nativeUnitPrice: {
            centsPerUnit: product.nativeUnitPrice.centsPerUnit,
            unit: product.nativeUnitPrice.unit,
            dimension: product.nativeUnitPrice.dimension
          }
        }
      : {})
  };
}

function parseOptions(args: string[]): GeneratorOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (!flag.startsWith("--")) throw new Error(`Unexpected argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    values.set(flag, value);
    index += 1;
  }
  const domains = integerOption(values, "--domains", 200);
  const pagesPerDomain = integerOption(values, "--pages-per-domain", 5);
  const productsPerPage = integerOption(values, "--products-per-page", 20);
  const validationDomains = integerOption(values, "--validation-domains", 40);
  const seed = integerOption(values, "--seed", 20260724);
  const targetFormat =
    values.get("--target-format") ?? "evidence-pointer";
  if (!["json", "evidence-pointer"].includes(targetFormat)) {
    throw new Error("--target-format must be json or evidence-pointer");
  }
  if (domains < 2 || validationDomains < 1 || validationDomains >= domains) {
    throw new Error("Synthetic generation requires disjoint train and validation domains.");
  }
  if (pagesPerDomain < 1 || productsPerPage < 6) {
    throw new Error("Synthetic generation requires pages and at least six products per page.");
  }
  return {
    outputDirectory: path.resolve(
      values.get("--output") ?? "benchmark-data/training/t5gemma2-synthetic"
    ),
    domains,
    pagesPerDomain,
    productsPerPage,
    validationDomains,
    seed,
    targetFormat: targetFormat as T5ExtractionTargetFormat
  };
}

function integerOption(values: ReadonlyMap<string, string>, flag: string, fallback: number): number {
  const value = Number.parseInt(values.get(flag) ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${flag}`);
  }
  return value;
}

async function resetOutputDirectory(outputDirectory: string): Promise<void> {
  const parsed = path.parse(outputDirectory);
  if (outputDirectory === parsed.root || outputDirectory === process.cwd()) {
    throw new Error(`Refusing to clear unsafe output directory: ${outputDirectory}`);
  }
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
}

function serializeJsonl(values: readonly unknown[]): string {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function increment(values: Record<string, number>, key: string): void {
  values[key] = (values[key] ?? 0) + 1;
}
