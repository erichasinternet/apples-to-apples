import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  LIVE_CORPUS_VERSION,
  calculateWorstCaseSampleSize,
  type CorpusAnnotation
} from "./live-corpus-lib";

const runDirectory = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("Usage: bun run benchmark:validate -- benchmark-data/live/<run-id>");
}

const run = JSON.parse(await readFile(path.join(runDirectory, "run.json"), "utf8")) as {
  version: number;
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
};

if (run.version !== LIVE_CORPUS_VERSION) {
  throw new Error(`Unsupported run version: ${run.version}`);
}

let pages = 0;
let candidates = 0;
let observationPages = 0;
let observedNodes = 0;
let reviewedPages = 0;
let annotatedProducts = 0;
let comparableProducts = 0;
const errors: string[] = [];

for (const result of run.results.filter((entry) => entry.status === "captured")) {
  const pageDirectory = path.join(runDirectory, result.pageId);
  try {
    const [page, annotation] = await Promise.all([
      readJson<{
        pageId: string;
        candidateCount: number;
        mainHtmlSha256: string;
        observationNodeCount?: number;
        observationSha256?: string;
        mainScreenshotCaptured?: boolean;
      }>(path.join(pageDirectory, "page.json")),
      readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json"))
    ]);
    const mainHtml = await readFile(path.join(pageDirectory, "main.html"));

    if (page.pageId !== result.pageId || annotation.pageId !== result.pageId) {
      errors.push(`${result.pageId}: page id mismatch`);
    }
    if (page.mainHtmlSha256.length !== 64 || mainHtml.length === 0) {
      errors.push(`${result.pageId}: invalid main HTML capture`);
    }
    if (page.observationSha256) {
      const observation = await readJson<PageObservation>(path.join(pageDirectory, "observation.json"));
      const actualHash = createHash("sha256").update(JSON.stringify(observation)).digest("hex");
      if (
        observation.pageId !== result.pageId ||
        observation.nodes.length !== page.observationNodeCount ||
        actualHash !== page.observationSha256
      ) {
        errors.push(`${result.pageId}: invalid page observation`);
      }
      observationPages += 1;
      observedNodes += observation.nodes.length;
    }
    if (page.mainScreenshotCaptured) {
      const screenshot = await stat(path.join(pageDirectory, "main.png"));
      if (!screenshot.isFile() || screenshot.size === 0) {
        errors.push(`${result.pageId}: invalid main screenshot`);
      }
    }

    pages += 1;
    candidates += page.candidateCount;
    if (annotation.reviewStatus === "adjudicated") reviewedPages += 1;
    annotatedProducts += annotation.products.length;
    comparableProducts += annotation.products.filter((product) => product.comparable).length;

    for (const product of annotation.products) {
      if (!product.nodeId || !product.scope || !product.title || product.evidenceNodeIds.length === 0) {
        errors.push(`${result.pageId}: incomplete annotation for ${product.nodeId || "unknown node"}`);
      }
      if (product.comparable && !product.expectedNormalized) {
        errors.push(`${result.pageId}: comparable product lacks expectedNormalized`);
      }
      if (!product.comparable && !product.exclusionReason) {
        errors.push(`${result.pageId}: excluded product lacks exclusionReason`);
      }
    }
  } catch (error) {
    errors.push(`${result.pageId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const twoPointSixPercentTarget = calculateWorstCaseSampleSize(0.026, 1.96, 2);
const summary = {
  pages,
  candidates,
  observationPages,
  observedNodes,
  blockedPages: run.results.filter((entry) => entry.status === "blocked").length,
  failedPages: run.results.filter((entry) => entry.status === "error").length,
  reviewedPages,
  annotatedProducts,
  comparableProducts,
  targetProducts: twoPointSixPercentTarget,
  completion: twoPointSixPercentTarget === 0 ? 0 : annotatedProducts / twoPointSixPercentTarget,
  errors
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (errors.length > 0) {
  process.exitCode = 1;
}

async function readJson<T>(filename: string): Promise<T> {
  const file = await stat(filename);
  if (!file.isFile()) {
    throw new Error(`${filename} is not a file`);
  }
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
