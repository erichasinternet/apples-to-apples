import { parseUnit } from "../src/core/units";
import type {
  ModelPageExtraction,
  ModelProductExtraction,
  PageObservation
} from "../src/learning/contracts";
import { validateModelExtraction } from "../src/learning/evidence-validator";
import { EXTRACTION_INSTRUCTIONS } from "../src/learning/model-adapter";
import { cropObservationToRegion } from "../src/learning/observation-region";
import type { CorpusAnnotation } from "./live-corpus-lib";

export interface TrainingExample {
  version: 1;
  split: "development";
  pageId: string;
  siteId: string;
  input: {
    instructions: string;
    observation: PageObservation;
    screenshotPath?: string;
  };
  target: ModelPageExtraction;
}

export interface TrainingExampleResult {
  example?: TrainingExample;
  errors: string[];
}

export function buildTrainingExample(
  siteId: string,
  observation: PageObservation,
  annotation: CorpusAnnotation,
  options: { allowSingleReview?: boolean } = {}
): TrainingExampleResult {
  const errors: string[] = [];
  if (annotation.pageId !== observation.pageId) {
    errors.push("Annotation and observation page ids do not match.");
  }
  if (annotation.reviewStatus !== "adjudicated") {
    errors.push(`Annotation status must be adjudicated, received ${annotation.reviewStatus}.`);
  }
  if (annotation.coverage !== "complete-main-region") {
    errors.push(`Annotation coverage must be complete-main-region, received ${annotation.coverage ?? "missing"}.`);
  }
  if (!annotation.region) {
    errors.push("Annotation region is required for training export.");
  }
  if (!options.allowSingleReview && annotation.annotators.length < 2) {
    errors.push("At least two annotators are required for training export.");
  }

  const products: ModelProductExtraction[] = [];
  for (const [index, product] of annotation.products.entries()) {
    if (!product.fieldEvidence) {
      errors.push(`Product ${index} (${product.nodeId}) lacks fieldEvidence.`);
      continue;
    }

    const modelProduct: ModelProductExtraction = {
      cardNodeId: product.nodeId,
      title: {
        value: product.title,
        evidenceNodeIds: product.fieldEvidence.title
      }
    };

    if (!product.comparable) {
      if (!product.abstainReason) {
        errors.push(`Product ${index} (${product.nodeId}) lacks abstainReason.`);
        continue;
      }
      modelProduct.abstainReason = product.abstainReason;
      products.push(modelProduct);
      continue;
    }

    if (product.currentPriceCents !== undefined) {
      if (!product.fieldEvidence.currentPrice) {
        errors.push(`Product ${index} (${product.nodeId}) lacks currentPrice evidence.`);
      } else {
        modelProduct.currentPrice = {
          cents: product.currentPriceCents,
          currency: "USD",
          evidenceNodeIds: product.fieldEvidence.currentPrice
        };
      }
    }

    if (product.nativeUnitPrice) {
      const definition = parseUnit(product.nativeUnitPrice.unit);
      if (!definition) {
        errors.push(`Product ${index} (${product.nodeId}) has unknown native unit ${product.nativeUnitPrice.unit}.`);
      } else if (!product.fieldEvidence.nativeUnitPrice) {
        errors.push(`Product ${index} (${product.nodeId}) lacks nativeUnitPrice evidence.`);
      } else {
        modelProduct.nativeUnitPrice = {
          centsPerUnit: product.nativeUnitPrice.centsPerUnit,
          unit: definition.unit,
          dimension: product.nativeUnitPrice.dimension ?? definition.dimension,
          evidenceNodeIds: product.fieldEvidence.nativeUnitPrice
        };
      }
    }

    if (product.packageQuantity) {
      const definition = parseUnit(product.packageQuantity.unit);
      if (!definition) {
        errors.push(`Product ${index} (${product.nodeId}) has unknown package unit ${product.packageQuantity.unit}.`);
      } else if (definition.dimension !== product.packageQuantity.dimension) {
        errors.push(
          `Product ${index} (${product.nodeId}) package unit ${definition.unit} does not match ${product.packageQuantity.dimension}.`
        );
      } else if (!product.fieldEvidence.packageQuantity) {
        errors.push(`Product ${index} (${product.nodeId}) lacks packageQuantity evidence.`);
      } else {
        modelProduct.packageQuantity = {
          valuePerPackage: product.packageQuantity.valuePerPackage,
          packCount: product.packageQuantity.packCount,
          unit: definition.unit,
          dimension: definition.dimension,
          evidenceNodeIds: product.fieldEvidence.packageQuantity
        };
      }
    }

    if (!modelProduct.nativeUnitPrice && !(modelProduct.currentPrice && modelProduct.packageQuantity)) {
      errors.push(
        `Product ${index} (${product.nodeId}) needs native unit price or current price plus factored package quantity.`
      );
    }
    products.push(modelProduct);
  }

  if (errors.length > 0) {
    return { errors };
  }

  if (!annotation.region) {
    return { errors };
  }
  const croppedObservation = cropObservationToRegion(observation, annotation.region);
  const target: ModelPageExtraction = {
    version: 1,
    pageId: observation.pageId,
    products
  };
  const validation = validateModelExtraction(target, croppedObservation);
  if (!validation.valid) {
    return {
      errors: validation.issues.map(
        (issue) => `${issue.productIndex ?? "page"}/${issue.field}: ${issue.message}`
      )
    };
  }

  return {
    errors: [],
    example: {
      version: 1,
      split: "development",
      pageId: observation.pageId,
      siteId,
      input: {
        instructions: EXTRACTION_INSTRUCTIONS,
        observation: croppedObservation
      },
      target
    }
  };
}
