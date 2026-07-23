import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  getDomainSplit,
  validateDomainSplits,
  type CorpusAnnotation,
  type CorpusDomainSplits,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import { buildTrainingExample, type TrainingExample } from "./training-export-lib";

interface RunManifest {
  results: Array<{ pageId: string; status: "captured" | "blocked" | "error" }>;
}

interface PageMetadata {
  target: {
    siteId: string;
  };
}

const args = process.argv.slice(2);
const runArg = args.find((arg) => !arg.startsWith("--"));
if (!runArg) {
  throw new Error(
    "Usage: bun run benchmark:training:export -- <run-directory> [--output <dataset.jsonl>] [--allow-single-review]"
  );
}

const runDirectory = path.resolve(runArg);
const outputIndex = args.indexOf("--output");
const outputPath =
  outputIndex >= 0 && args[outputIndex + 1]
    ? path.resolve(args[outputIndex + 1]!)
    : path.join(runDirectory, "development-training.jsonl");
const allowSingleReview = args.includes("--allow-single-review");
const [run, manifest, splits] = await Promise.all([
  readJson<RunManifest>(path.join(runDirectory, "run.json")),
  readJson<CorpusTargetManifest>(path.resolve("benchmarks/live-sites/targets.json")),
  readJson<CorpusDomainSplits>(path.resolve("benchmarks/live-sites/domain-splits.json"))
]);
const splitErrors = validateDomainSplits(manifest, splits);
if (splitErrors.length > 0) {
  throw new Error(`Invalid domain splits:\n${splitErrors.join("\n")}`);
}

const examples: TrainingExample[] = [];
const skippedPages: Array<{ pageId: string; reason: string }> = [];
const errors: Array<{ pageId: string; reasons: string[] }> = [];
const assetDirectory = outputPath.replace(/\.jsonl$/i, "") + ".assets";

for (const result of run.results.filter((entry) => entry.status === "captured")) {
  const pageDirectory = path.join(runDirectory, result.pageId);
  const page = await readJson<PageMetadata>(path.join(pageDirectory, "page.json"));
  const split = getDomainSplit(page.target.siteId, splits);
  if (split !== "development") {
    skippedPages.push({ pageId: result.pageId, reason: `domain belongs to ${split ?? "no"} split` });
    continue;
  }

  const [observation, annotation] = await Promise.all([
    readJson<PageObservation>(path.join(pageDirectory, "observation.json")),
    readJson<CorpusAnnotation>(path.join(pageDirectory, "annotation.json"))
  ]);
  const built = buildTrainingExample(page.target.siteId, observation, annotation, {
    allowSingleReview
  });
  if (!built.example) {
    errors.push({ pageId: result.pageId, reasons: built.errors });
    continue;
  }
  const annotationScreenshot = path.join(pageDirectory, "annotation.png");
  const assetFilename = `${result.pageId}.png`;
  await mkdir(assetDirectory, { recursive: true });
  try {
    await copyFile(annotationScreenshot, path.join(assetDirectory, assetFilename));
    built.example.input.screenshotPath = path.relative(
      path.dirname(outputPath),
      path.join(assetDirectory, assetFilename)
    );
  } catch (error) {
    errors.push({
      pageId: result.pageId,
      reasons: [`Annotation screenshot is unavailable: ${error instanceof Error ? error.message : String(error)}`]
    });
    continue;
  }
  examples.push(built.example);
}

if (errors.length > 0) {
  process.stderr.write(`${JSON.stringify({ errors }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const serialized = examples.map((example) => JSON.stringify(example)).join("\n") + (examples.length > 0 ? "\n" : "");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
  const datasetHash = createHash("sha256").update(serialized).digest("hex");
  const report = {
    version: 1,
    createdAt: new Date().toISOString(),
    sourceRun: runDirectory,
    outputPath,
    split: "development",
    allowSingleReview,
    examples: examples.length,
    pages: examples.map((example) => example.pageId),
    domains: [...new Set(examples.map((example) => example.siteId))].sort(),
    assetDirectory,
    skippedPages,
    sha256: datasetHash
  };
  await writeFile(`${outputPath}.manifest.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
