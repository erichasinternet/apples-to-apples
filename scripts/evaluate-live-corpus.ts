import { JSDOM } from "jsdom";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractProductsFromDocument, type DomProduct } from "../src/content/extractor";
import { DEFAULT_PREFERENCES } from "../src/core/types";
import type { AnnotatedProduct, CorpusAnnotation } from "./live-corpus-lib";

interface RunManifest {
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

interface PageMetadata {
  finalUrl: string;
  target: {
    hostname: string;
    siteId: string;
  };
}

interface ProductEvaluation {
  pageId: string;
  nodeId: string;
  title: string;
  comparable: boolean;
  outputFound: boolean;
  correct: boolean;
  reason: string;
  predicted?: {
    title: string;
    centsPerUnit: number;
    unit: string;
    dimension: string;
  };
  expected?: {
    centsPerUnit: number;
    unit: string;
    dimension: string;
  };
}

const args = process.argv.slice(2);
const runArg = args.find((arg) => !arg.startsWith("--"));
if (!runArg) {
  throw new Error("Usage: bun run benchmark:evaluate -- <run-directory> [--allow-in-review]");
}

const runDirectory = path.resolve(runArg);
const allowInReview = args.includes("--allow-in-review");
const run = await readJson<RunManifest>(path.join(runDirectory, "run.json"));
const evaluations: ProductEvaluation[] = [];
const skippedPages: Array<{ pageId: string; reason: string }> = [];

for (const result of run.results.filter((entry) => entry.status === "captured")) {
  const pageDirectory = path.join(runDirectory, result.pageId);
  const [page, annotation, html] = await Promise.all([
    readJson<PageMetadata>(path.join(pageDirectory, "page.json")),
    readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json")),
    readFile(path.join(pageDirectory, "main.html"), "utf8")
  ]);

  if (annotation.reviewStatus !== "adjudicated" && !(allowInReview && annotation.reviewStatus === "in-review")) {
    skippedPages.push({ pageId: result.pageId, reason: `annotation status is ${annotation.reviewStatus}` });
    continue;
  }

  const dom = new JSDOM(html, { url: page.finalUrl });
  const document = dom.window.document;
  const priorDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });

  let predictions: DomProduct[];
  try {
    predictions = extractProductsFromDocument(document, DEFAULT_PREFERENCES, page.target.hostname);
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: priorDocument });
  }

  for (const label of annotation.products) {
    evaluations.push(evaluateProduct(result.pageId, label, predictions, document));
  }

  dom.window.close();
}

const comparable = evaluations.filter((evaluation) => evaluation.comparable);
const abstentions = evaluations.filter((evaluation) => !evaluation.comparable);
const summary = {
  runDirectory,
  annotationPolicy: allowInReview ? "adjudicated and in-review" : "adjudicated only",
  evaluatedPages: new Set(evaluations.map((evaluation) => evaluation.pageId)).size,
  skippedPages,
  labeledProducts: evaluations.length,
  comparableProducts: comparable.length,
  expectedAbstentions: abstentions.length,
  comparableOutputRecall: ratio(comparable.filter((evaluation) => evaluation.outputFound).length, comparable.length),
  exactNormalizedAccuracy: ratio(comparable.filter((evaluation) => evaluation.correct).length, comparable.length),
  abstentionAccuracy: ratio(abstentions.filter((evaluation) => evaluation.correct).length, abstentions.length),
  overallDecisionAccuracy: ratio(evaluations.filter((evaluation) => evaluation.correct).length, evaluations.length),
  failures: evaluations.filter((evaluation) => !evaluation.correct)
};

await writeFile(path.join(runDirectory, "evaluation.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function evaluateProduct(
  pageId: string,
  label: AnnotatedProduct,
  predictions: readonly DomProduct[],
  document: Document
): ProductEvaluation {
  const labelElement = document.querySelector<HTMLElement>(`[data-ata-benchmark-node="${label.nodeId}"]`);
  const prediction = labelElement
    ? predictions
        .filter(
          (candidate) =>
            candidate.element === labelElement ||
            candidate.element.contains(labelElement) ||
            labelElement.contains(candidate.element)
        )
        .sort((left, right) => left.element.textContent!.length - right.element.textContent!.length)[0]
    : undefined;

  if (!label.comparable) {
    return {
      pageId,
      nodeId: label.nodeId,
      title: label.title,
      comparable: false,
      outputFound: Boolean(prediction),
      correct: !prediction,
      reason: prediction ? "Expected abstention but the extractor emitted a normalized result." : "Correct abstention.",
      ...(prediction?.normalized ? { predicted: normalizedSummary(prediction) } : {})
    };
  }

  const expected = label.expectedNormalized;
  if (!expected) {
    throw new Error(`${pageId}/${label.nodeId} is comparable but lacks expectedNormalized`);
  }
  if (!prediction?.normalized) {
    return {
      pageId,
      nodeId: label.nodeId,
      title: label.title,
      comparable: true,
      outputFound: false,
      correct: false,
      reason: "Expected a normalized result but no overlapping output was found.",
      expected
    };
  }

  const predicted = normalizedSummary(prediction);
  const relativeError = Math.abs(predicted.centsPerUnit - expected.centsPerUnit) / expected.centsPerUnit;
  const unitMatches =
    predicted.unit === expected.unit &&
    predicted.dimension === expected.dimension;
  const correct = unitMatches && Number.isFinite(relativeError) && relativeError <= 0.005;

  return {
    pageId,
    nodeId: label.nodeId,
    title: label.title,
    comparable: true,
    outputFound: true,
    correct,
    reason: correct
      ? "Normalized value and semantic unit match."
      : !unitMatches
        ? `Semantic unit mismatch: predicted ${predicted.unit}, expected ${expected.unit}.`
        : `Normalized value differs by ${(relativeError * 100).toFixed(2)}%.`,
    predicted,
    expected
  };
}

function normalizedSummary(product: DomProduct): NonNullable<ProductEvaluation["predicted"]> {
  const normalized = product.normalized;
  if (!normalized) {
    throw new Error("Cannot summarize an unnormalized product.");
  }
  return {
    title: product.title,
    centsPerUnit: normalized.centsPerUnit,
    unit: normalized.unit,
    dimension: normalized.dimension
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
