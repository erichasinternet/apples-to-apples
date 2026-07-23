import type { AnnotatedProduct } from "./live-corpus-lib";
import type { ValidatedPageExtraction, ValidatedProductExtraction } from "../src/learning/contracts";

export interface ModelProductEvaluation {
  nodeId: string;
  title: string;
  comparable: boolean;
  predictionStatus: ValidatedProductExtraction["status"] | "missing";
  correctDecision: boolean;
  incorrectDisplayedPrice: boolean;
  reason: string;
}

export interface ModelPageEvaluation {
  labeledCards: number;
  predictedCards: number;
  truePositiveCards: number;
  falsePositiveCardIds: string[];
  falsePositiveDisplayedCardIds: string[];
  missedCardIds: string[];
  rejectedPredictions: number;
  products: ModelProductEvaluation[];
}

export function evaluateValidatedModelPage(
  labels: readonly AnnotatedProduct[],
  validation: ValidatedPageExtraction
): ModelPageEvaluation {
  const predictionsByCard = new Map(
    validation.products.map((product) => [product.extraction.cardNodeId, product])
  );
  const labelIds = new Set(labels.map((label) => label.nodeId));
  const predictedIds = new Set(validation.products.map((product) => product.extraction.cardNodeId));
  const products = labels.map((label) => evaluateLabel(label, predictionsByCard.get(label.nodeId)));

  return {
    labeledCards: labelIds.size,
    predictedCards: predictedIds.size,
    truePositiveCards: [...predictedIds].filter((nodeId) => labelIds.has(nodeId)).length,
    falsePositiveCardIds: [...predictedIds].filter((nodeId) => !labelIds.has(nodeId)),
    falsePositiveDisplayedCardIds: validation.products
      .filter((product) => product.status === "accepted" && !labelIds.has(product.extraction.cardNodeId))
      .map((product) => product.extraction.cardNodeId),
    missedCardIds: [...labelIds].filter((nodeId) => !predictedIds.has(nodeId)),
    rejectedPredictions: validation.products.filter((product) => product.status === "rejected").length,
    products
  };
}

function evaluateLabel(
  label: AnnotatedProduct,
  prediction: ValidatedProductExtraction | undefined
): ModelProductEvaluation {
  if (!label.comparable) {
    const incorrectDisplayedPrice = prediction?.status === "accepted";
    return {
      nodeId: label.nodeId,
      title: label.title,
      comparable: false,
      predictionStatus: prediction?.status ?? "missing",
      correctDecision: !incorrectDisplayedPrice,
      incorrectDisplayedPrice,
      reason: incorrectDisplayedPrice
        ? "Expected abstention, but the model emitted a validated unit price."
        : prediction?.status === "abstained"
          ? "Correct explicit abstention."
          : prediction?.status === "rejected"
            ? "No price would be displayed because evidence validation rejected the output."
            : "No unit price was emitted."
    };
  }

  const expected = label.expectedNormalized;
  if (!expected) {
    throw new Error(`${label.nodeId} is comparable but lacks expectedNormalized`);
  }
  if (prediction?.status !== "accepted" || !prediction.normalized) {
    return {
      nodeId: label.nodeId,
      title: label.title,
      comparable: true,
      predictionStatus: prediction?.status ?? "missing",
      correctDecision: false,
      incorrectDisplayedPrice: false,
      reason:
        prediction?.status === "rejected"
          ? "Comparable product output failed evidence validation."
          : "Comparable product did not receive a validated unit price."
    };
  }

  const relativeError =
    Math.abs(prediction.normalized.centsPerUnit - expected.centsPerUnit) /
    expected.centsPerUnit;
  const correct =
    prediction.normalized.unit === expected.unit &&
    prediction.normalized.dimension === expected.dimension &&
    Number.isFinite(relativeError) &&
    relativeError <= 0.005;

  return {
    nodeId: label.nodeId,
    title: label.title,
    comparable: true,
    predictionStatus: "accepted",
    correctDecision: correct,
    incorrectDisplayedPrice: !correct,
    reason: correct
      ? "Normalized value and semantic unit match."
      : prediction.normalized.unit !== expected.unit ||
          prediction.normalized.dimension !== expected.dimension
        ? `Semantic unit mismatch: predicted ${prediction.normalized.unit}, expected ${expected.unit}.`
        : `Normalized value differs by ${(relativeError * 100).toFixed(2)}%.`
  };
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
