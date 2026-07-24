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

export interface T5InferenceRecord {
  version: 1;
  id: string;
  task: T5TrainingTask;
  captureId: string;
  pageId: string;
  siteId: string;
  imagePath: string;
  imageCrop: ScreenshotCrop;
  prompt: string;
  metadata: {
    sourceRegion: ObservationBounds;
    nodeCount: number;
    sourceNodeCount?: number;
    cardNodeId?: string;
    cardCount?: number;
    abstainedProducts?: number;
  };
}

export interface T5TrainingRecord extends T5InferenceRecord {
  split: T5DatasetSplit;
  target: string;
}

export interface T5InferenceBuildOptions {
  captureId: string;
  pageId: string;
  siteId: string;
  imagePath: string;
  discoveryChunkHeight?: number;
  cardPadding?: number;
  maxDiscoveryNodes?: number;
  maxExtractionNodes?: number;
  requiredDiscoveryNodeIds?: string[];
}

export interface T5RecordBuildOptions
  extends Omit<T5InferenceBuildOptions, "pageId" | "siteId"> {
  split: T5DatasetSplit;
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
  const sourceRegion = getSourceRegion(observation);
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const records: T5TrainingRecord[] = [];

  for (const input of buildT5DiscoveryRecords(observation, {
    ...options,
    pageId: example.pageId,
    siteId: example.siteId,
    requiredDiscoveryNodeIds: example.target.products.map(
      (product) => product.cardNodeId
    )
  })) {
    const region = input.metadata.sourceRegion;
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
      ...input,
      split: options.split,
      target: JSON.stringify(target),
      metadata: {
        ...input.metadata,
        cardCount: products.length,
        abstainedProducts: products.filter((product) => product.abstainReason).length
      }
    });
  }

  for (const product of example.target.products) {
    const input = buildT5ExtractionRecord(observation, product.cardNodeId, {
      ...options,
      pageId: example.pageId,
      siteId: example.siteId
    });
    const target: ModelPageExtraction = {
      version: 1,
      pageId: example.pageId,
      products: [product]
    };
    records.push({
      ...input,
      split: options.split,
      target: JSON.stringify(target),
      metadata: {
        ...input.metadata,
        cardCount: 1,
        abstainedProducts: product.abstainReason ? 1 : 0
      }
    });
  }

  return records;
}

export function buildT5DiscoveryRecords(
  observation: PageObservation,
  options: T5InferenceBuildOptions
): T5InferenceRecord[] {
  const sourceRegion = getSourceRegion(observation);
  const chunkHeight = Math.max(320, options.discoveryChunkHeight ?? 900);
  const records: T5InferenceRecord[] = [];
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
    const sourceObservation = cropObservationToRegion(observation, region);
    const requiredNodeIds = options.requiredDiscoveryNodeIds?.filter((nodeId) => {
      const node = sourceObservation.nodes.find((entry) => entry.id === nodeId);
      if (!node) return false;
      const centerY = node.bounds.y + node.bounds.height / 2;
      return centerY >= region.y && centerY < region.y + region.height;
    });
    const chunkObservation = pruneObservationForModel(
      sourceObservation,
      Math.max(8, options.maxDiscoveryNodes ?? 96),
      requiredNodeIds
    );
    records.push({
      version: 1,
      id: `${options.captureId}--${slugify(options.pageId)}--discover-${chunkIndex}`,
      task: "discover-products",
      captureId: options.captureId,
      pageId: options.pageId,
      siteId: options.siteId,
      imagePath: options.imagePath,
      imageCrop: relativeCrop(region, sourceRegion),
      prompt: discoveryPrompt(chunkObservation),
      metadata: {
        sourceRegion: region,
        nodeCount: chunkObservation.nodes.length,
        sourceNodeCount: sourceObservation.nodes.length
      }
    });
  }
  return records;
}

export function buildT5ExtractionRecord(
  observation: PageObservation,
  cardNodeId: string,
  options: T5InferenceBuildOptions
): T5InferenceRecord {
  const sourceRegion = getSourceRegion(observation);
  const cardNode = observation.nodes.find((node) => node.id === cardNodeId);
  if (!cardNode) {
    throw new Error(`Product references missing card node ${cardNodeId}`);
  }
  const region = paddedRegion(
    cardNode.bounds,
    sourceRegion,
    Math.max(0, options.cardPadding ?? 24)
  );
  const sourceObservation = cropObservationToRegion(observation, region);
  const cardObservation = pruneObservationForModel(
    sourceObservation,
    Math.max(8, options.maxExtractionNodes ?? 32),
    cardNodeId
  );
  return {
    version: 1,
    id: `${options.captureId}--${slugify(options.pageId)}--extract-${slugify(cardNodeId)}`,
    task: "extract-product",
    captureId: options.captureId,
    pageId: options.pageId,
    siteId: options.siteId,
    imagePath: options.imagePath,
    imageCrop: relativeCrop(region, sourceRegion),
    prompt: extractionPrompt(cardObservation, cardNodeId),
    metadata: {
      sourceRegion: region,
      nodeCount: cardObservation.nodes.length,
      sourceNodeCount: sourceObservation.nodes.length,
      cardNodeId
    }
  };
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
  const x = Math.max(0, Math.floor(region.x - source.x));
  const y = Math.max(0, Math.floor(region.y - source.y));
  const right = Math.ceil(region.x - source.x + region.width);
  const bottom = Math.ceil(region.y - source.y + region.height);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

function getSourceRegion(observation: PageObservation): ObservationBounds {
  if (observation.sourceRegion) return observation.sourceRegion;
  const rootNode = observation.nodes.find((node) => node.id === observation.rootNodeId);
  if (rootNode) return rootNode.bounds;
  return {
    x: observation.viewport.scrollX,
    y: observation.viewport.scrollY,
    width: observation.viewport.width,
    height: observation.viewport.height
  };
}

export function pruneObservationForModel(
  observation: PageObservation,
  maxNodes: number,
  requiredNodeIds?: string | readonly string[]
): PageObservation {
  if (observation.nodes.length <= maxNodes) return observation;
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const indexMap = new Map(observation.nodes.map((node, index) => [node.id, index]));
  const included = new Set<string>();

  const addPath = (nodeId: string, required = false): boolean => {
    const path: string[] = [];
    let current = nodeMap.get(nodeId);
    while (current && !included.has(current.id)) {
      path.push(current.id);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
    if (!required && included.size + path.length > maxNodes) return false;
    for (const id of path) included.add(id);
    return true;
  };

  addPath(observation.rootNodeId);
  const required =
    typeof requiredNodeIds === "string" ? [requiredNodeIds] : (requiredNodeIds ?? []);
  for (const requiredNodeId of required) addPath(requiredNodeId, true);

  const ranked = observation.nodes
    .map((node) => ({
      node,
      score: modelSignalScore(node),
      index: indexMap.get(node.id) ?? 0
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  for (const { node } of ranked) {
    if (included.size >= maxNodes) break;
    addPath(node.id);
  }

  if (included.size < maxNodes) {
    for (const node of observation.nodes) {
      if (included.size >= maxNodes) break;
      if (included.has(node.id)) continue;
      const parentIncluded = node.parentId ? included.has(node.parentId) : false;
      if (parentIncluded) included.add(node.id);
    }
  }

  return {
    ...observation,
    nodes: observation.nodes.filter((node) => included.has(node.id)),
    truncated: observation.truncated || included.size < observation.nodes.length
  };
}

function modelSignalScore(node: ObservedNode): number {
  const content = [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  let score = 0;
  if (/[$€£]\s*\d|\d[\d,.]*\s*¢/i.test(content)) score += 100;
  if (
    /\b\d+(?:\.\d+)?\s*(?:fl\s*oz|ounces?|oz|pounds?|lbs?|grams?|kg|ml|liters?|litres?|count|ct|pack|pk|each|ea)\b/i.test(
      content
    )
  ) {
    score += 80;
  }
  if (/^(?:h[1-6]|img)$/i.test(node.tag)) score += 35;
  if (node.tag === "a" && content) score += 30;
  if (node.interactive && /\b(?:add|buy|cart|select|choose)\b/i.test(content)) score += 25;
  if (content.length >= 4 && content.length <= 240) score += 10;
  return score;
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
