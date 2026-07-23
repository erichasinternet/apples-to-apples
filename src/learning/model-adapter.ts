import type {
  ExtractionModelAdapter,
  PageObservation,
  ValidatedPageExtraction
} from "./contracts";
import { validateModelExtraction } from "./evidence-validator";

export const EXTRACTION_INSTRUCTIONS = [
  "Identify product-card roots using only the supplied rendered-page observation.",
  "Extract only values visibly supported by evidence nodes inside each card.",
  "Cite the smallest useful evidence nodes for every field.",
  "Use valuePerPackage and packCount as separate facts; never calculate a total quantity.",
  "Do not calculate normalized unit prices.",
  "Abstain when the current variant, current price, quantity, or semantic unit is ambiguous.",
  "Return no confidence score."
].join("\n");

export async function runExtractionModel(
  adapter: ExtractionModelAdapter,
  observation: PageObservation
): Promise<ValidatedPageExtraction> {
  const output = await adapter.extract({
    observation,
    instructions: EXTRACTION_INSTRUCTIONS
  });
  return validateModelExtraction(output, observation);
}
