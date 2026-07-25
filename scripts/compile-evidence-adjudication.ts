import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  compileAdjudicatedCorpusAnnotation,
  type EvidencePointerReview
} from "./evidence-review-lib";

const [observationArg, reviewAArg, reviewBArg, adjudicationArg, outputArg] =
  process.argv.slice(2);
if (
  !observationArg ||
  !reviewAArg ||
  !reviewBArg ||
  !adjudicationArg ||
  !outputArg
) {
  throw new Error(
    "Usage: bun scripts/compile-evidence-adjudication.ts observation.json review-a.json review-b.json adjudication.json annotation.json"
  );
}

const [observation, reviewA, reviewB, adjudication] = await Promise.all([
  readJson<PageObservation>(observationArg),
  readJson<EvidencePointerReview>(reviewAArg),
  readJson<EvidencePointerReview>(reviewBArg),
  readJson<EvidencePointerReview>(adjudicationArg)
]);
const annotation = compileAdjudicatedCorpusAnnotation(
  adjudication,
  reviewA,
  reviewB,
  observation
);
await writeFile(
  path.resolve(outputArg),
  `${JSON.stringify(annotation, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    pageId: annotation.pageId,
    products: annotation.products.length,
    comparable: annotation.products.filter((product) => product.comparable)
      .length,
    abstentions: annotation.products.filter((product) => !product.comparable)
      .length,
    output: path.resolve(outputArg)
  })}\n`
);

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(filename), "utf8")) as T;
}
