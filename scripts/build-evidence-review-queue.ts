import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { selectIndependentCandidateRootIds } from "../src/learning/candidate-roots";
import {
  validateCaptureProvenance,
  type CaptureProvenance
} from "./capture-provenance-lib";
import { selectCapturedReviewPages } from "./evidence-review-queue-lib";

interface CaptureRun {
  version: number;
  runId: string;
  results: Array<{
    pageId: string;
    status: "captured" | "blocked" | "error";
  }>;
}

interface CapturePage {
  pageId: string;
  capturedAt: string;
  candidateCount: number;
  target: {
    hostname: string;
  };
}

interface CapturedCandidate {
  nodeId: string;
}

const options = parseOptions(process.argv.slice(2));
const run = await readJson<CaptureRun>(path.join(options.runDirectory, "run.json"));
const items = [];
for (const entry of selectCapturedReviewPages(run.results, options.pageIds)) {
  const pageDirectory = path.join(options.runDirectory, entry.pageId);
  const [page, observation, provenance] = await Promise.all([
    readJson<CapturePage>(path.join(pageDirectory, "page.json")),
    readJson<PageObservation>(path.join(pageDirectory, "observation.json")),
    readJson<CaptureProvenance>(path.join(pageDirectory, "provenance.json"))
  ]);
  const provenanceErrors = await validateCaptureProvenance(
    pageDirectory,
    provenance
  );
  if (provenanceErrors.length > 0) {
    throw new Error(
      `${entry.pageId}: invalid capture provenance: ${provenanceErrors.join("; ")}`
    );
  }
  const observationAsset = provenance.assets.find(
    (asset) => asset.path === "observation.json"
  );
  const screenshotAsset = provenance.assets.find(
    (asset) => asset.path === "annotation.png"
  );
  if (!observationAsset || !screenshotAsset) {
    throw new Error(`${entry.pageId}: review source assets are unavailable`);
  }
  const candidateAssets = provenance.assets
    .filter(
      (asset) =>
        asset.path.startsWith("cards/") && asset.path.endsWith(".json")
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const candidates = await Promise.all(
    candidateAssets.map((asset) =>
      readJson<CapturedCandidate>(path.join(pageDirectory, asset.path))
    )
  );
  const candidateCardNodeIds = candidates.map((candidate) => candidate.nodeId);
  const independentCandidateCardNodeIds = selectIndependentCandidateRootIds(
    observation.nodes,
    candidateCardNodeIds
  );
  if (
    candidateCardNodeIds.length !== page.candidateCount ||
    new Set(candidateCardNodeIds).size !== candidateCardNodeIds.length ||
    independentCandidateCardNodeIds.length !== candidateCardNodeIds.length ||
    candidateCardNodeIds.some(
      (nodeId) => !observation.nodes.some((node) => node.id === nodeId)
    )
  ) {
    throw new Error(
      `${entry.pageId}: captured candidate roots do not match page metadata`
    );
  }
  items.push({
    pageId: entry.pageId,
    source: {
      observationSha256: observationAsset.sha256,
      screenshotSha256: screenshotAsset.sha256,
      captureTimestamp: page.capturedAt,
      registrableDomain: page.target.hostname,
      cohort: options.cohort
    },
    observationPath: path.relative(
      path.dirname(options.outputPath),
      path.join(pageDirectory, "observation.json")
    ),
    screenshotPath: path.relative(
      path.dirname(options.outputPath),
      path.join(pageDirectory, "annotation.png")
    ),
    rootNodeId: observation.rootNodeId,
    candidateCardNodeIds,
    reviewTemplate: {
      version: 1,
      reviewId: `${options.reviewerId}--${run.runId}--${entry.pageId}`,
      pageId: entry.pageId,
      phase: "independent",
      reviewerId: options.reviewerId,
      completedAt: null,
      coverage: "complete-main-region",
      preannotationVisibility: "hidden",
      source: {
        observationSha256: observationAsset.sha256,
        screenshotSha256: screenshotAsset.sha256,
        captureTimestamp: page.capturedAt,
        registrableDomain: page.target.hostname,
        cohort: options.cohort
      },
      products: []
    }
  });
}

const payload = {
  version: 1,
  queueId: `${options.reviewerId}--${run.runId}`,
  reviewerId: options.reviewerId,
  cohort: options.cohort,
  sourceRunId: run.runId,
  sourceRunSha256: sha256(
    await readFile(path.join(options.runDirectory, "run.json"))
  ),
  labelVisibility: "no model or peer labels",
  items
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
await mkdir(path.dirname(options.outputPath), { recursive: true });
await writeFile(options.outputPath, serialized, "utf8");
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    queueId: payload.queueId,
    pages: items.length,
    sha256: sha256(serialized),
    output: options.outputPath
  })}\n`
);

function parseOptions(args: string[]): {
  runDirectory: string;
  outputPath: string;
  reviewerId: string;
  cohort: "training" | "validation" | "selection" | "final";
  pageIds: string[];
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/build-evidence-review-queue.ts --run <capture-run> --reviewer <id> --cohort <name> --output <queue.json> [--pages <page-id,...>]"
      );
    }
    values.set(key, value);
  }
  const runDirectory = values.get("--run");
  const reviewerId = values.get("--reviewer");
  const output = values.get("--output");
  const cohort = values.get("--cohort");
  if (
    !runDirectory ||
    !reviewerId ||
    !output ||
    !["training", "validation", "selection", "final"].includes(cohort ?? "")
  ) {
    throw new Error(
      "Required: --run, --reviewer, --cohort training|validation|selection|final, --output"
    );
  }
  return {
    runDirectory: path.resolve(runDirectory),
    outputPath: path.resolve(output),
    reviewerId,
    cohort: cohort as "training" | "validation" | "selection" | "final",
    pageIds: (values.get("--pages") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
