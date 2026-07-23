import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
if (positional.length < 2) {
  throw new Error(
    "Usage: bun run benchmark:model:validate -- <observation.json> <model-extraction.json> [--output <result.json>]"
  );
}

const observationPath = path.resolve(positional[0]!);
const extractionPath = path.resolve(positional[1]!);
const outputIndex = args.indexOf("--output");
const outputPath =
  outputIndex >= 0 && args[outputIndex + 1]
    ? path.resolve(args[outputIndex + 1]!)
    : undefined;
const [observation, extraction] = await Promise.all([
  readJson<PageObservation>(observationPath),
  readJson<unknown>(extractionPath)
]);
const result = validateModelExtraction(extraction, observation);
const report = {
  valid: result.valid,
  pageId: result.pageId,
  acceptedProducts: result.products.filter((product) => product.status === "accepted").length,
  abstainedProducts: result.products.filter((product) => product.status === "abstained").length,
  rejectedProducts: result.products.filter((product) => product.status === "rejected").length,
  issues: result.issues,
  products: result.products.map((product) => ({
    cardNodeId: product.extraction.cardNodeId,
    title: product.extraction.title.value,
    status: product.status,
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
  }))
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (outputPath) {
  await writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
if (!result.valid) {
  process.exitCode = 1;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
