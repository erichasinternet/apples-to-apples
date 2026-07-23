import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";
import { cropObservationToRegion } from "../src/learning/observation-region";
import type { CorpusAnnotation } from "./live-corpus-lib";
import {
  evaluateValidatedModelPage,
  ratio,
  type ModelPageEvaluation
} from "./model-evaluation-lib";

interface RunManifest {
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

const args = process.argv.slice(2);
const runArg = args.find((arg) => !arg.startsWith("--"));
if (!runArg) {
  throw new Error(
    "Usage: bun run benchmark:model:evaluate -- <run-directory> [--allow-in-review] [--predictions <directory>]"
  );
}

const runDirectory = path.resolve(runArg);
const allowInReview = args.includes("--allow-in-review");
const predictionsIndex = args.indexOf("--predictions");
const predictionsDirectory =
  predictionsIndex >= 0 && args[predictionsIndex + 1]
    ? path.resolve(args[predictionsIndex + 1]!)
    : undefined;
const run = await readJson<RunManifest>(path.join(runDirectory, "run.json"));
const pages: Array<{ pageId: string; evaluation: ModelPageEvaluation }> = [];
const skippedPages: Array<{ pageId: string; reason: string }> = [];
const errors: Array<{ pageId: string; reason: string }> = [];
let invalidOutputPages = 0;

for (const result of run.results.filter((entry) => entry.status === "captured")) {
  const pageDirectory = path.join(runDirectory, result.pageId);
  const annotation = await readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json"));
  if (annotation.reviewStatus !== "adjudicated" && !(allowInReview && annotation.reviewStatus === "in-review")) {
    skippedPages.push({ pageId: result.pageId, reason: `annotation status is ${annotation.reviewStatus}` });
    continue;
  }

  const predictionPath = predictionsDirectory
    ? path.join(predictionsDirectory, `${result.pageId}.json`)
    : path.join(pageDirectory, "model-extraction.json");

  try {
    const [observation, output] = await Promise.all([
      readJson<PageObservation>(path.join(pageDirectory, "observation.json")),
      readJson<unknown>(predictionPath)
    ]);
    const evaluationObservation = annotation.region
      ? cropObservationToRegion(observation, annotation.region)
      : observation;
    const validation = validateModelExtraction(output, evaluationObservation);
    if (!validation.valid && validation.products.length === 0) {
      invalidOutputPages += 1;
    }
    pages.push({
      pageId: result.pageId,
      evaluation: evaluateValidatedModelPage(annotation.products, validation)
    });
  } catch (error) {
    errors.push({
      pageId: result.pageId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

const productEvaluations = pages.flatMap((page) => page.evaluation.products);
const comparable = productEvaluations.filter((product) => product.comparable);
const abstentions = productEvaluations.filter((product) => !product.comparable);
const labeledCards = sum(pages, (page) => page.evaluation.labeledCards);
const predictedCards = sum(pages, (page) => page.evaluation.predictedCards);
const truePositiveCards = sum(pages, (page) => page.evaluation.truePositiveCards);
const rejectedPredictions = sum(pages, (page) => page.evaluation.rejectedPredictions);
const falsePositiveDisplayedPrices = sum(
  pages,
  (page) => page.evaluation.falsePositiveDisplayedCardIds.length
);
const incorrectDisplayedPrices =
  productEvaluations.filter((product) => product.incorrectDisplayedPrice).length +
  falsePositiveDisplayedPrices;
const summary = {
  runDirectory,
  predictionsDirectory: predictionsDirectory ?? "page-local model-extraction.json files",
  annotationPolicy: allowInReview ? "adjudicated and in-review" : "adjudicated only",
  evaluatedPages: pages.length,
  skippedPages,
  errors,
  invalidOutputPages,
  labeledProducts: productEvaluations.length,
  comparableProducts: comparable.length,
  expectedAbstentions: abstentions.length,
  cardPrecision: ratio(truePositiveCards, predictedCards),
  cardRecall: ratio(truePositiveCards, labeledCards),
  exactNormalizedAccuracy: ratio(
    comparable.filter((product) => product.correctDecision).length,
    comparable.length
  ),
  abstentionAccuracy: ratio(
    abstentions.filter((product) => product.correctDecision).length,
    abstentions.length
  ),
  incorrectDisplayedPriceRate: ratio(
    incorrectDisplayedPrices,
    productEvaluations.length + falsePositiveDisplayedPrices
  ),
  rejectedPredictionRate: ratio(rejectedPredictions, predictedCards),
  failures: productEvaluations.filter((product) => !product.correctDecision),
  falsePositiveCards: pages.flatMap((page) =>
    page.evaluation.falsePositiveCardIds.map((nodeId) => ({ pageId: page.pageId, nodeId }))
  ),
  missedCards: pages.flatMap((page) =>
    page.evaluation.missedCardIds.map((nodeId) => ({ pageId: page.pageId, nodeId }))
  )
};
const serialized = `${JSON.stringify(summary, null, 2)}\n`;

await writeFile(path.join(runDirectory, "model-evaluation.json"), serialized, "utf8");
process.stdout.write(serialized);
if (errors.length > 0) {
  process.exitCode = 1;
}

function sum<T>(values: readonly T[], select: (value: T) => number): number {
  return values.reduce((total, value) => total + select(value), 0);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
