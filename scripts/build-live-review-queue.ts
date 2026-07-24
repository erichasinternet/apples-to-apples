import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ModelPageExtraction,
  ModelProductExtraction,
  PageObservation
} from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    observationPath: string;
  }>;
}

interface Prediction {
  id: string;
  pageId: string;
  siteId: string;
  prediction: string;
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-live"
);
const predictionsPath = path.resolve(
  process.argv[3] ?? path.join(bundle, "extraction-predictions.jsonl")
);
const outputDirectory = path.join(bundle, "review");
const manifest = await readJson<BundleManifest>(path.join(bundle, "manifest.json"));
const predictions = await readJsonl<Prediction>(predictionsPath);
const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
const observations = new Map<string, PageObservation>();
const acceptedByPage = new Map<string, ModelProductExtraction[]>();
const queue: Array<Record<string, unknown>> = [];
const counts = {
  predictions: predictions.length,
  parseFailures: 0,
  schemaFailures: 0,
  accepted: 0,
  abstained: 0,
  rejected: 0
};
const issueCounts = new Map<string, number>();

for (const prediction of predictions) {
  const page = pageMap.get(prediction.pageId);
  if (!page) throw new Error(`${prediction.id}: unknown page ${prediction.pageId}`);
  let observation = observations.get(page.pageId);
  if (!observation) {
    observation = await readJson<PageObservation>(
      path.join(bundle, page.observationPath)
    );
    observations.set(page.pageId, observation);
  }
  const parsed = parseJsonPrefix(prediction.prediction);
  if (!parsed) {
    counts.parseFailures += 1;
    queue.push({
      predictionId: prediction.id,
      pageId: prediction.pageId,
      siteId: prediction.siteId,
      status: "parse-failure",
      requiresHumanReview: false,
      rawPrediction: prediction.prediction
    });
    continue;
  }

  const validation = validateModelExtraction(parsed, observation);
  if (validation.products.length === 0) {
    counts.schemaFailures += 1;
    for (const issue of validation.issues) {
      issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
    }
    queue.push({
      predictionId: prediction.id,
      pageId: prediction.pageId,
      siteId: prediction.siteId,
      status: "schema-failure",
      requiresHumanReview: false,
      issues: validation.issues,
      rawPrediction: prediction.prediction
    });
    continue;
  }

  const product = validation.products[0]!;
  for (const issue of product.issues) {
    issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
  }
  if (product.status === "accepted") {
    counts.accepted += 1;
    const accepted = acceptedByPage.get(page.pageId) ?? [];
    accepted.push(product.extraction);
    acceptedByPage.set(page.pageId, accepted);
  } else if (product.status === "abstained") {
    counts.abstained += 1;
  } else {
    counts.rejected += 1;
  }
  queue.push({
    predictionId: prediction.id,
    pageId: prediction.pageId,
    siteId: prediction.siteId,
    cardNodeId: product.extraction.cardNodeId,
    status: product.status,
    requiresHumanReview: product.status !== "rejected",
    extraction: product.extraction,
    ...(product.normalized
      ? {
          normalized: {
            centsPerUnit: product.normalized.centsPerUnit,
            unit: product.normalized.unit,
            dimension: product.normalized.dimension,
            display: product.normalized.display
          }
        }
      : {}),
    issues: product.issues
  });
}

await mkdir(outputDirectory, { recursive: true });
for (const page of manifest.pages) {
  const extraction: ModelPageExtraction = {
    version: 1,
    pageId: page.pageId,
    products: acceptedByPage.get(page.pageId) ?? []
  };
  await writeFile(
    path.join(outputDirectory, `${page.pageId}.evidence-valid.json`),
    `${JSON.stringify(extraction, null, 2)}\n`,
    "utf8"
  );
}
const report = {
  version: 1,
  checkpoint: {
    discovery: "synthetic-pilot-80-real-discovery",
    extraction: "synthetic-pilot-60-replay"
  },
  policy:
    "Evidence-valid model outputs are preannotations only. Human review and independent adjudication are required before benchmark or training use.",
  counts,
  evidenceAcceptanceRate: counts.predictions
    ? counts.accepted / counts.predictions
    : null,
  issueCounts: Object.fromEntries(
    [...issueCounts.entries()].sort((left, right) => right[1] - left[1])
  ),
  queue
};
await writeFile(
  path.join(outputDirectory, "review-queue.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify(
    {
      outputDirectory,
      counts,
      evidenceAcceptanceRate: report.evidenceAcceptanceRate,
      issueCounts: report.issueCounts
    },
    null,
    2
  )}\n`
);

function parseJsonPrefix(value: string): unknown | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
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
