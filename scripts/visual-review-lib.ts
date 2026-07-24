import type {
  ObservationBounds,
  ObservedNode,
  PageObservation
} from "../src/learning/contracts";
import type { ScreenshotCrop } from "./t5-training-lib";

export interface VisualReviewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualReviewMapping {
  cardNodeIds: string[];
  boxes: number;
  invalidBoxes: number;
  unmappedBoxes: number;
  duplicateMappings: number;
}

export function mapVisualReview(
  rawPrediction: string,
  pageId: string,
  imageCrop: ScreenshotCrop,
  sourceRegion: ObservationBounds,
  observation: PageObservation
): VisualReviewMapping {
  const parsed = parseJsonPrefix(rawPrediction);
  if (
    !parsed ||
    parsed.version !== 1 ||
    parsed.pageId !== pageId ||
    !Array.isArray(parsed.cardBoxes)
  ) {
    return {
      cardNodeIds: [],
      boxes: 0,
      invalidBoxes: 1,
      unmappedBoxes: 0,
      duplicateMappings: 0
    };
  }

  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const candidates = observation.nodes.filter((node) =>
    isPlausibleCardRoot(node, sourceRegion)
  );
  const mapped = new Set<string>();
  let invalidBoxes = 0;
  let unmappedBoxes = 0;
  let duplicateMappings = 0;
  let boxes = 0;

  for (const value of parsed.cardBoxes) {
    if (!isVisualReviewBox(value)) {
      invalidBoxes += 1;
      continue;
    }
    boxes += 1;
    const predicted = denormalizeBox(value, sourceRegion);
    const ranked = candidates
      .map((node) => ({ node, iou: intersectionOverUnion(predicted, node.bounds) }))
      .filter((entry) => entry.iou >= 0.15)
      .sort((left, right) => right.iou - left.iou);
    const bestIou = ranked[0]?.iou;
    if (bestIou === undefined) {
      unmappedBoxes += 1;
      continue;
    }
    const nearBest = ranked
      .filter((entry) => entry.iou >= bestIou * 0.9)
      .sort(
        (left, right) =>
          Number(right.node.role === "listitem") -
            Number(left.node.role === "listitem") ||
          nodeDepth(left.node, nodeMap) - nodeDepth(right.node, nodeMap) ||
          area(right.node.bounds) - area(left.node.bounds) ||
          left.node.id.localeCompare(right.node.id)
      );
    const nodeId = nearBest[0]!.node.id;
    if (mapped.has(nodeId)) duplicateMappings += 1;
    else mapped.add(nodeId);
  }

  return {
    cardNodeIds: [...mapped],
    boxes,
    invalidBoxes,
    unmappedBoxes,
    duplicateMappings
  };
}

function isVisualReviewBox(value: unknown): value is VisualReviewBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  if (
    !["x", "y", "width", "height"].every(
      (key) => typeof box[key] === "number" && Number.isFinite(box[key])
    )
  ) {
    return false;
  }
  const { x, y, width, height } = box as unknown as VisualReviewBox;
  return (
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1000 &&
    y + height <= 1000
  );
}

function denormalizeBox(
  box: VisualReviewBox,
  crop: ScreenshotCrop
): ObservationBounds {
  return {
    x: crop.x + (box.x / 1000) * crop.width,
    y: crop.y + (box.y / 1000) * crop.height,
    width: (box.width / 1000) * crop.width,
    height: (box.height / 1000) * crop.height
  };
}

function isPlausibleCardRoot(
  node: ObservedNode,
  region: ObservationBounds
): boolean {
  const centerY = node.bounds.y + node.bounds.height / 2;
  return (
    centerY >= region.y &&
    centerY < region.y + region.height &&
    node.bounds.width >= 80 &&
    node.bounds.width <= region.width * 0.65 &&
    node.bounds.height >= 80 &&
    node.bounds.height <= region.height * 1.5
  );
}

function intersectionOverUnion(
  left: ObservationBounds,
  right: ObservationBounds
): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) -
      Math.max(left.x, right.x)
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) -
      Math.max(left.y, right.y)
  );
  const intersection = width * height;
  const union = area(left) + area(right) - intersection;
  return union ? intersection / union : 0;
}

function nodeDepth(
  node: ObservedNode,
  nodeMap: Map<string, ObservedNode>
): number {
  let depth = 0;
  let parentId = node.parentId;
  const seen = new Set([node.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = nodeMap.get(parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function area(bounds: ObservationBounds): number {
  return bounds.width * bounds.height;
}

function parseJsonPrefix(value: string): Record<string, unknown> | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(value.slice(start, index + 1));
          return typeof parsed === "object" && parsed !== null
            ? (parsed as Record<string, unknown>)
            : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
