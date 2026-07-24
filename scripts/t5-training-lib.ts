import type {
  ModelPageExtraction,
  ModelProductExtraction,
  ObservationBounds,
  ObservedNode,
  PageObservation
} from "../src/learning/contracts";
import { cropObservationToRegion } from "../src/learning/observation-region";
import { slugify, type CorpusDomainSplits } from "./live-corpus-lib";
import type { TrainingExample } from "./training-export-lib";

export type T5DatasetSplit = "train" | "validation";
export type T5TrainingTask = "discover-products" | "extract-product";

export interface TrainingDomainSplits {
  version: number;
  seed: number;
  train: string[];
  validation: string[];
}

export interface ScreenshotCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface T5TrainingRecord {
  version: 1;
  id: string;
  split: T5DatasetSplit;
  task: T5TrainingTask;
  captureId: string;
  pageId: string;
  siteId: string;
  imagePath: string;
  imageCrop: ScreenshotCrop;
  prompt: string;
  target: string;
  metadata: {
    sourceRegion: ObservationBounds;
    nodeCount: number;
    cardCount: number;
    cardNodeId?: string;
    abstainedProducts: number;
  };
}

export interface T5RecordBuildOptions {
  captureId: string;
  split: T5DatasetSplit;
  imagePath: string;
  discoveryChunkHeight?: number;
  cardPadding?: number;
}

export function validateTrainingDomainSplits(
  domainSplits: CorpusDomainSplits,
  trainingSplits: TrainingDomainSplits
): string[] {
  const errors: string[] = [];
  if (trainingSplits.version !== 1) {
    errors.push(`Unsupported training split version: ${trainingSplits.version}`);
  }

  const development = new Set(domainSplits.development);
  const assigned = new Map<string, T5DatasetSplit>();
  for (const [split, sites] of [
    ["train", trainingSplits.train],
    ["validation", trainingSplits.validation]
  ] as const) {
    for (const siteId of sites) {
      if (!development.has(siteId)) {
        errors.push(`${split}: ${siteId} is not a development domain`);
      }
      const prior = assigned.get(siteId);
      if (prior) {
        errors.push(`${siteId} appears in both ${prior} and ${split}`);
      } else {
        assigned.set(siteId, split);
      }
    }
  }

  for (const siteId of development) {
    if (!assigned.has(siteId)) {
      errors.push(`Development domain is unassigned for training: ${siteId}`);
    }
  }
  if (assigned.size !== development.size) {
    errors.push(`Expected ${development.size} training assignments, found ${assigned.size}`);
  }
  return errors;
}

export function getTrainingSplit(
  siteId: string,
  splits: TrainingDomainSplits
): T5DatasetSplit | undefined {
  if (splits.train.includes(siteId)) return "train";
  if (splits.validation.includes(siteId)) return "validation";
  return undefined;
}

export function buildT5TrainingRecords(
  example: TrainingExample,
  options: T5RecordBuildOptions
): T5TrainingRecord[] {
  const observation = example.input.observation;
  const sourceRegion = observation.sourceRegion ?? {
    x: observation.viewport.scrollX,
    y: observation.viewport.scrollY,
    width: observation.viewport.width,
    height: observation.viewport.height
  };
  const chunkHeight = Math.max(320, options.discoveryChunkHeight ?? 900);
  const cardPadding = Math.max(0, options.cardPadding ?? 24);
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const records: T5TrainingRecord[] = [];

  for (
    let chunkY = sourceRegion.y, chunkIndex = 0;
    chunkY < sourceRegion.y + sourceRegion.height;
    chunkY += chunkHeight, chunkIndex += 1
  ) {
    const region = {
      x: sourceRegion.x,
      y: chunkY,
      width: sourceRegion.width,
      height: Math.min(chunkHeight, sourceRegion.y + sourceRegion.height - chunkY)
    };
    const chunkObservation = cropObservationToRegion(observation, region);
    const products = example.target.products.filter((product) => {
      const node = nodeMap.get(product.cardNodeId);
      if (!node) return false;
      const centerY = node.bounds.y + node.bounds.height / 2;
      return centerY >= region.y && centerY < region.y + region.height;
    });
    const target = {
      version: 1,
      pageId: example.pageId,
      cardNodeIds: products.map((product) => product.cardNodeId)
    };
    records.push({
      version: 1,
      id: `${options.captureId}--${slugify(example.pageId)}--discover-${chunkIndex}`,
      split: options.split,
      task: "discover-products",
      captureId: options.captureId,
      pageId: example.pageId,
      siteId: example.siteId,
      imagePath: options.imagePath,
      imageCrop: relativeCrop(region, sourceRegion),
      prompt: discoveryPrompt(chunkObservation),
      target: JSON.stringify(target),
      metadata: {
        sourceRegion: region,
        nodeCount: chunkObservation.nodes.length,
        cardCount: products.length,
        abstainedProducts: products.filter((product) => product.abstainReason).length
      }
    });
  }

  for (const product of example.target.products) {
    const cardNode = nodeMap.get(product.cardNodeId);
    if (!cardNode) {
      throw new Error(`Training product references missing card node ${product.cardNodeId}`);
    }
    const region = paddedRegion(cardNode.bounds, sourceRegion, cardPadding);
    const cardObservation = cropObservationToRegion(observation, region);
    const target: ModelPageExtraction = {
      version: 1,
      pageId: example.pageId,
      products: [product]
    };
    records.push({
      version: 1,
      id: `${options.captureId}--${slugify(example.pageId)}--extract-${slugify(product.cardNodeId)}`,
      split: options.split,
      task: "extract-product",
      captureId: options.captureId,
      pageId: example.pageId,
      siteId: example.siteId,
      imagePath: options.imagePath,
      imageCrop: relativeCrop(region, sourceRegion),
      prompt: extractionPrompt(cardObservation, product.cardNodeId),
      target: JSON.stringify(target),
      metadata: {
        sourceRegion: region,
        nodeCount: cardObservation.nodes.length,
        cardCount: 1,
        cardNodeId: product.cardNodeId,
        abstainedProducts: product.abstainReason ? 1 : 0
      }
    });
  }

  return records;
}

function discoveryPrompt(observation: PageObservation): string {
  return [
    "<start_of_image>",
    "TASK: discover-products",
    "Identify every product-card root whose vertical center is inside this region.",
    "Return JSON only: {\"version\":1,\"pageId\":\"...\",\"cardNodeIds\":[\"node-id\"]}.",
    "Do not extract fields and do not invent node IDs.",
    `OBSERVATION: ${serializeObservation(observation)}`
  ].join("\n");
}

function extractionPrompt(observation: PageObservation, cardNodeId: string): string {
  return [
    "<start_of_image>",
    "TASK: extract-product",
    `Extract visible facts for product card ${JSON.stringify(cardNodeId)}.`,
    "Return one model-extraction JSON object with evidence node IDs.",
    "Use an abstainReason when current price and comparable quantity are not visibly supported.",
    "Do not calculate normalized unit price and do not invent node IDs.",
    `OBSERVATION: ${serializeObservation(observation)}`
  ].join("\n");
}

function serializeObservation(observation: PageObservation): string {
  return JSON.stringify({
    pageId: observation.pageId,
    title: observation.title,
    region: observation.sourceRegion,
    rootNodeId: observation.rootNodeId,
    nodes: observation.nodes.map(compactNode)
  });
}

function compactNode(node: ObservedNode): Record<string, unknown> {
  return {
    id: node.id,
    ...(node.parentId ? { parent: node.parentId } : {}),
    tag: node.tag,
    ...(node.role ? { role: node.role } : {}),
    ...(node.text ? { text: node.text } : {}),
    ...(node.accessibleName ? { name: node.accessibleName } : {}),
    ...(node.attributes && Object.keys(node.attributes).length > 0
      ? { attributes: node.attributes }
      : {}),
    bounds: node.bounds,
    ...(node.interactive ? { interactive: true } : {}),
    style: {
      position: node.style.position,
      fontSize: node.style.fontSize,
      fontWeight: node.style.fontWeight
    }
  };
}

function paddedRegion(
  bounds: ObservationBounds,
  container: ObservationBounds,
  padding: number
): ObservationBounds {
  const left = Math.max(container.x, bounds.x - padding);
  const top = Math.max(container.y, bounds.y - padding);
  const right = Math.min(container.x + container.width, bounds.x + bounds.width + padding);
  const bottom = Math.min(container.y + container.height, bounds.y + bounds.height + padding);
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}

function relativeCrop(region: ObservationBounds, source: ObservationBounds): ScreenshotCrop {
  return {
    x: region.x - source.x,
    y: region.y - source.y,
    width: region.width,
    height: region.height
  };
}

export function countExtractionOutcomes(products: readonly ModelProductExtraction[]): {
  comparable: number;
  abstained: number;
} {
  return {
    comparable: products.filter((product) => !product.abstainReason).length,
    abstained: products.filter((product) => product.abstainReason).length
  };
}
