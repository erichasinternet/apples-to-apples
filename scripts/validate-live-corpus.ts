import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { boundsIntersect } from "../src/learning/observation-region";
import {
  LIVE_CORPUS_VERSION,
  calculateWorstCaseSampleSize,
  type CorpusAnnotation
} from "./live-corpus-lib";
import {
  validateCaptureProvenance,
  type CaptureProvenance
} from "./capture-provenance-lib";

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
    const [page, annotation, provenance] = await Promise.all([
      readJson<{
        pageId: string;
        candidateCount: number;
        mainHtmlSha256: string;
        observationNodeCount?: number;
        observationSha256?: string;
        mainScreenshotCaptured?: boolean;
        annotationRegion?: { x: number; y: number; width: number; height: number };
        annotationScreenshotCaptured?: boolean;
      }>(path.join(pageDirectory, "page.json")),
      readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json")),
      readJson<CaptureProvenance>(path.join(pageDirectory, "provenance.json"))
    ]);
    errors.push(
      ...(await validateCaptureProvenance(pageDirectory, provenance)).map(
        (error) => `${result.pageId}: ${error}`
      )
    );
    const mainHtml = await readFile(path.join(pageDirectory, "main.html"));

    if (page.pageId !== result.pageId || annotation.pageId !== result.pageId) {
      errors.push(`${result.pageId}: page id mismatch`);
    }
    if (page.mainHtmlSha256.length !== 64 || mainHtml.length === 0) {
      errors.push(`${result.pageId}: invalid main HTML capture`);
    }
    let observation: PageObservation | undefined;
    if (page.observationSha256) {
      observation = await readJson<PageObservation>(path.join(pageDirectory, "observation.json"));
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
    if (page.annotationScreenshotCaptured) {
      const screenshot = await stat(path.join(pageDirectory, "annotation.png"));
      if (!screenshot.isFile() || screenshot.size === 0) {
        errors.push(`${result.pageId}: invalid annotation screenshot`);
      } else if (page.annotationRegion) {
        const image = await readFile(path.join(pageDirectory, "annotation.png"));
        const dimensions = readPngDimensions(image);
        if (
          !dimensions ||
          Math.abs(dimensions.width - page.annotationRegion.width) > 1 ||
          Math.abs(dimensions.height - page.annotationRegion.height) > 1
        ) {
          errors.push(`${result.pageId}: annotation screenshot dimensions do not match its region`);
        }
      }
    }
    if (
      annotation.region &&
      page.annotationRegion &&
      JSON.stringify(annotation.region) !== JSON.stringify(page.annotationRegion)
    ) {
      errors.push(`${result.pageId}: annotation region does not match page metadata`);
    }
    if (annotation.coverage === "complete-main-region" && !annotation.region) {
      errors.push(`${result.pageId}: complete annotation lacks a bounded region`);
    }
    if (
      annotation.reviewStatus === "adjudicated" &&
      annotation.coverage === "complete-main-region" &&
      !annotation.reviewProvenance
    ) {
      errors.push(
        `${result.pageId}: adjudicated evidence annotation lacks independent-review provenance`
      );
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
      if (annotation.coverage === "complete-main-region") {
        if (!product.fieldEvidence) {
          errors.push(`${result.pageId}: complete annotation lacks field evidence for ${product.nodeId}`);
        }
        if (!product.comparable && !product.abstainReason) {
          errors.push(`${result.pageId}: complete annotation lacks abstain reason for ${product.nodeId}`);
        }
        const node = observation?.nodes.find((candidate) => candidate.id === product.nodeId);
        if (!node) {
          errors.push(`${result.pageId}: annotation references unknown node ${product.nodeId}`);
        } else if (annotation.region && !boundsIntersect(node.bounds, annotation.region)) {
          errors.push(`${result.pageId}: product ${product.nodeId} is outside the annotation region`);
        }
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

function readPngDimensions(value: Buffer): { width: number; height: number } | undefined {
  if (
    value.length < 24 ||
    value.toString("ascii", 1, 4) !== "PNG" ||
    value.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return undefined;
  }
  return {
    width: value.readUInt32BE(16),
    height: value.readUInt32BE(20)
  };
}
