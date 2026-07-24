import type {
  ObservationBounds,
  ObservedNode,
  PageObservation
} from "../src/learning/contracts";

export interface MarkupTitleMapping {
  cardNodeIds: string[];
  titleCandidates: number;
  matchedTitles: number;
  unmatchedTitles: number;
  duplicateMappings: number;
}

interface EvidenceMatch {
  node: ObservedNode;
  score: number;
}

export function mapPix2StructMarkup(
  rawPrediction: string,
  sourceRegion: ObservationBounds,
  observation: PageObservation
): MarkupTitleMapping {
  const titles = extractImageAltTexts(rawPrediction);
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const evidenceNodes = observation.nodes.filter(
    (node) => evidenceStrings(node).length > 0
  );
  const matchedEvidence = titles
    .map((title) => bestEvidenceMatch(title, evidenceNodes))
    .filter((match): match is EvidenceMatch => match !== undefined);
  const matchedIds = new Set(matchedEvidence.map((match) => match.node.id));
  const mapped = new Set<string>();
  let duplicateMappings = 0;

  for (const match of matchedEvidence) {
    const root = selectCardRoot(
      match.node,
      matchedIds,
      sourceRegion,
      observation.nodes,
      nodeMap
    );
    if (!root) continue;
    if (mapped.has(root.id)) duplicateMappings += 1;
    else mapped.add(root.id);
  }

  return {
    cardNodeIds: [...mapped],
    titleCandidates: titles.length,
    matchedTitles: matchedEvidence.length,
    unmatchedTitles: titles.length - matchedEvidence.length,
    duplicateMappings
  };
}

export function extractImageAltTexts(rawPrediction: string): string[] {
  const values = [];
  const pattern = /\bimg_alt=([^>]+)>/g;
  for (const match of rawPrediction.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value && normalizeText(value).split(" ").length >= 2) values.push(value);
  }
  return [...new Set(values)];
}

function bestEvidenceMatch(
  title: string,
  nodes: ObservedNode[]
): EvidenceMatch | undefined {
  let best: EvidenceMatch | undefined;
  for (const node of nodes) {
    const score = Math.max(
      ...evidenceStrings(node).map((value) => textSimilarity(title, value))
    );
    if (
      score < 0.58 ||
      (best &&
        (score < best.score ||
          (score === best.score &&
            evidencePreference(node) <= evidencePreference(best.node))))
    ) {
      continue;
    }
    best = { node, score };
  }
  return best;
}

function evidenceStrings(node: ObservedNode): string[] {
  return [
    node.accessibleName,
    node.text,
    node.attributes?.alt,
    node.attributes?.ariaLabel
  ].filter((value): value is string => Boolean(value?.trim()));
}

function evidencePreference(node: ObservedNode): number {
  return (
    Number(node.tag === "img") * 4 +
    Number(Boolean(node.attributes?.alt)) * 2 +
    Number(Boolean(node.accessibleName))
  );
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return 1;
  }
  const leftTokens = new Set(normalizedLeft.split(" "));
  const rightTokens = new Set(normalizedRight.split(" "));
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function selectCardRoot(
  evidenceNode: ObservedNode,
  matchedEvidenceIds: Set<string>,
  sourceRegion: ObservationBounds,
  nodes: ObservedNode[],
  nodeMap: Map<string, ObservedNode>
): ObservedNode | undefined {
  const chain = ancestorChain(evidenceNode, nodeMap).filter((node) =>
    plausibleRoot(node, sourceRegion)
  );
  const semantic = chain.find(
    (node) => node.role === "listitem" || node.tag === "li" || node.tag === "article"
  );
  if (semantic) return semantic;

  const isolated = chain.filter(
    (node) => containedMatches(node, matchedEvidenceIds, nodeMap) === 1
  );
  if (isolated.length === 0) return undefined;
  return [...isolated].sort(
    (left, right) =>
      repetitionScore(right, nodes, sourceRegion) -
        repetitionScore(left, nodes, sourceRegion) ||
      area(right.bounds) - area(left.bounds) ||
      left.id.localeCompare(right.id)
  )[0];
}

function ancestorChain(
  node: ObservedNode,
  nodeMap: Map<string, ObservedNode>
): ObservedNode[] {
  const chain = [];
  const seen = new Set<string>();
  let current: ObservedNode | undefined = node;
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentId ? nodeMap.get(current.parentId) : undefined;
  }
  return chain;
}

function containedMatches(
  candidate: ObservedNode,
  matchedEvidenceIds: Set<string>,
  nodeMap: Map<string, ObservedNode>
): number {
  let count = 0;
  for (const nodeId of matchedEvidenceIds) {
    let current = nodeMap.get(nodeId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === candidate.id) {
        count += 1;
        break;
      }
      seen.add(current.id);
      current = current.parentId ? nodeMap.get(current.parentId) : undefined;
    }
  }
  return count;
}

function plausibleRoot(
  node: ObservedNode,
  region: ObservationBounds
): boolean {
  const centerY = node.bounds.y + node.bounds.height / 2;
  return (
    centerY >= region.y &&
    centerY < region.y + region.height &&
    node.bounds.width >= 80 &&
    node.bounds.width <= region.width * 0.65 &&
    node.bounds.height >= 100 &&
    node.bounds.height <= region.height * 1.5
  );
}

function repetitionScore(
  candidate: ObservedNode,
  nodes: ObservedNode[],
  region: ObservationBounds
): number {
  return nodes.filter(
    (node) =>
      node.id !== candidate.id &&
      node.tag === candidate.tag &&
      node.role === candidate.role &&
      plausibleRoot(node, region) &&
      ratio(node.bounds.width, candidate.bounds.width) >= 0.8 &&
      ratio(node.bounds.height, candidate.bounds.height) >= 0.7
  ).length;
}

function ratio(left: number, right: number): number {
  return Math.min(left, right) / Math.max(left, right);
}

function area(bounds: ObservationBounds): number {
  return bounds.width * bounds.height;
}
