import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  compareIndependentEvidenceReviews,
  validateEvidenceAdjudication,
  type EvidencePointerReview
} from "./evidence-review-lib";

const [observationArg, reviewAArg, reviewBArg, adjudicationArg] =
  process.argv.slice(2);
if (!observationArg || !reviewAArg || !reviewBArg) {
  throw new Error(
    "Usage: bun scripts/score-evidence-reviews.ts observation.json review-a.json review-b.json [adjudication.json]"
  );
}

const [observation, reviewA, reviewB] = await Promise.all([
  readJson<PageObservation>(observationArg),
  readJson<EvidencePointerReview>(reviewAArg),
  readJson<EvidencePointerReview>(reviewBArg)
]);
const agreement = compareIndependentEvidenceReviews(
  reviewA,
  reviewB,
  observation
);
const adjudication = adjudicationArg
  ? await readJson<EvidencePointerReview>(adjudicationArg)
  : undefined;
const adjudicationValidation = adjudication
  ? validateEvidenceAdjudication(
      adjudication,
      reviewA,
      reviewB,
      observation
    )
  : undefined;

process.stdout.write(
  `${JSON.stringify(
    {
      version: 1,
      inputs: {
        observation: path.resolve(observationArg),
        reviewA: path.resolve(reviewAArg),
        reviewB: path.resolve(reviewBArg),
        ...(adjudicationArg
          ? { adjudication: path.resolve(adjudicationArg) }
          : {})
      },
      agreement,
      ...(adjudicationValidation
        ? {
            adjudication: {
              valid: adjudicationValidation.valid,
              errors: adjudicationValidation.errors
            }
          }
        : {})
    },
    null,
    2
  )}\n`
);
if (adjudicationValidation && !adjudicationValidation.valid) {
  process.exitCode = 1;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(filename), "utf8")) as T;
}
