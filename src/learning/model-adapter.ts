import type {
  ExtractionModelAdapter,
  PageObservation,
  ValidatedPageExtraction
} from "./contracts";
import {
  resolveEvidencePointer,
  serializeEvidenceCandidateCatalog,
  type ResolvedEvidencePointer
} from "./evidence-pointer";
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

export const EVIDENCE_POINTER_INSTRUCTIONS = [
  "Select evidence node IDs for exactly one supplied product card.",
  "Return exactly seven plain-text lines in this order:",
  "CARD node-id",
  "TITLE node-id[,node-id]",
  "CURRENT_PRICE listed-candidate-id or NONE",
  "NATIVE_UNIT_PRICE listed-candidate-id or NONE",
  "PACKAGE_QUANTITY listed-candidate-id or NONE",
  "PACK_COUNT listed-candidate-id or NONE",
  "STATUS comparable or one allowed abstention reason",
  "Allowed abstentions: insufficient-evidence, conditional-price, price-range, unselected-variant, ambiguous-quantity, unsupported-unit, not-a-product.",
  "Every title node and deterministic candidate ID must occur in the supplied input.",
  "For an abstention, use NONE for every price and quantity field.",
  "Do not emit prices, quantities, units, calculations, JSON, Markdown, or confidence."
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

export async function runEvidencePointerModel(
  adapter: ExtractionModelAdapter,
  observation: PageObservation,
  cardNodeId: string
): Promise<ResolvedEvidencePointer> {
  const output = await adapter.extract({
    observation,
    instructions: [
      EVIDENCE_POINTER_INSTRUCTIONS,
      `CANDIDATES: ${serializeEvidenceCandidateCatalog(observation, cardNodeId)}`
    ].join("\n")
  });
  return resolveEvidencePointer(output, observation);
}
