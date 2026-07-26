import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Dimension } from "../src/core/types";
import type { ObservedNode, PageObservation } from "../src/learning/contracts";
import {
  validateEvidenceReviewQueue,
  type EvidenceReviewQueue
} from "./evidence-review-queue-lib";

interface EvidenceCandidate {
  nodeId: string;
  tag: string;
  role?: string;
  content: string;
  bounds: ObservedNode["bounds"];
  candidateTypes: string[];
}

interface QueueItem {
  id: string;
  pageId: string;
  siteId: string;
  cardNodeId: string;
  targetDimension: Dimension;
  source: {
    bundleDirectory: string;
    reviewPath: string;
    observationPath: string;
    imagePath: string;
  };
  cardBounds: ObservedNode["bounds"];
  candidateCounts: {
    title: number;
    currentPrice: number;
    nativeUnitPrice: number;
    packageQuantity: number;
  };
  evidence: EvidenceCandidate[];
  annotation: {
    status: "pending";
    eligibleForTraining: false;
    eligibleForBenchmarkGold: false;
    extraction: null;
    reviewer: null;
    note: null;
  };
}

const campaignPath = path.resolve(
  optionValue("--campaign") ??
    "benchmark-data/review/g2-pilot-expansion-wave-02-reviewer-a-campaign.json"
);
const outputPath = path.resolve(
  optionValue("--output") ??
    "benchmark-data/review/g2-pilot-campaign-extraction-queue.json"
);
const campaignBytes = await readFile(campaignPath);
const campaign = JSON.parse(campaignBytes.toString("utf8")) as EvidenceReviewQueue;
const campaignErrors = validateEvidenceReviewQueue(campaign);
if (campaignErrors.length > 0) {
  throw new Error(`Invalid review campaign: ${campaignErrors.join("; ")}`);
}

const campaignDirectory = path.dirname(campaignPath);
const queue: QueueItem[] = [];
for (const item of campaign.items) {
  const observationPath = path.resolve(campaignDirectory, item.observationPath);
  const observationBytes = await readFile(observationPath);
  const observationSha256 = sha256(observationBytes);
  if (observationSha256 !== item.source.observationSha256) {
    throw new Error(`${item.pageId}: observation hash does not match campaign`);
  }
  const observation = JSON.parse(
    observationBytes.toString("utf8")
  ) as PageObservation;
  const capturePage = JSON.parse(
    await readFile(path.join(path.dirname(observationPath), "page.json"), "utf8")
  ) as {
    pageId: string;
    target: { dimension: Dimension };
  };
  if (
    capturePage.pageId !== item.pageId ||
    !isDimension(capturePage.target.dimension)
  ) {
    throw new Error(`${item.pageId}: capture target dimension is invalid`);
  }
  const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
  const children = buildChildren(observation.nodes);
  for (const cardNodeId of item.candidateCardNodeIds) {
    const card = nodeMap.get(cardNodeId);
    if (!card) throw new Error(`${item.pageId}: unknown card ${cardNodeId}`);
    const evidence = [card, ...collectDescendants(children, cardNodeId)]
      .map(toEvidenceCandidate)
      .filter((candidate) => candidate.content);
    queue.push({
      id: `${item.pageId}:${cardNodeId}`,
      pageId: item.pageId,
      siteId: siteId(item.pageId),
      cardNodeId,
      targetDimension: capturePage.target.dimension,
      source: {
        bundleDirectory: path.relative(process.cwd(), campaignDirectory),
        reviewPath: path.relative(process.cwd(), campaignPath),
        observationPath: item.observationPath,
        imagePath: item.screenshotPath
      },
      cardBounds: card.bounds,
      candidateCounts: {
        title: countCandidates(evidence, "title"),
        currentPrice: countCandidates(evidence, "current-price"),
        nativeUnitPrice: countCandidates(evidence, "native-unit-price"),
        packageQuantity: countCandidates(evidence, "package-quantity")
      },
      evidence,
      annotation: {
        status: "pending",
        eligibleForTraining: false,
        eligibleForBenchmarkGold: false,
        extraction: null,
        reviewer: null,
        note: null
      }
    });
  }
}

queue.sort((left, right) => left.id.localeCompare(right.id));
const counts = {
  pages: campaign.items.length,
  cards: queue.length,
  withTitleCandidate: countCardsWith(queue, "title"),
  withCurrentPriceCandidate: countCardsWith(queue, "currentPrice"),
  withNativeUnitPriceCandidate: countCardsWith(queue, "nativeUnitPrice"),
  withPackageQuantityCandidate: countCardsWith(queue, "packageQuantity"),
  targetDimensions: countBy(queue, (item) => item.targetDimension)
};
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  sourceCampaign: path.relative(process.cwd(), campaignPath),
  sourceCampaignSha256: sha256(campaignBytes),
  sourceQueueId: campaign.queueId,
  sourceReviewerId: campaign.reviewerId,
  sourceReviewStatus: "unreviewed-capture",
  policy:
    "Frozen card roots are unreviewed capture candidates, not product labels. Deterministic outputs remain quarantined preannotations and cannot enter training or benchmark gold without independent review and adjudication.",
  eligibleForSilverTraining: false,
  eligibleForBenchmarkGold: false,
  counts,
  queue
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      sourceQueueId: campaign.queueId,
      eligibleForSilverTraining: false,
      eligibleForBenchmarkGold: false,
      counts
    },
    null,
    2
  )}\n`
);

function buildChildren(nodes: ObservedNode[]): Map<string, ObservedNode[]> {
  const children = new Map<string, ObservedNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const values = children.get(node.parentId) ?? [];
    values.push(node);
    children.set(node.parentId, values);
  }
  return children;
}

function collectDescendants(
  children: Map<string, ObservedNode[]>,
  rootId: string
): ObservedNode[] {
  const descendants: ObservedNode[] = [];
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length > 0) {
    const node = pending.shift()!;
    descendants.push(node);
    pending.push(...(children.get(node.id) ?? []));
  }
  return descendants;
}

function toEvidenceCandidate(node: ObservedNode): EvidenceCandidate {
  const content = [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" | ")
    .slice(0, 1000);
  const candidateTypes: string[] = [];
  if (
    /^h[1-6]$/i.test(node.tag) ||
    (node.tag === "a" && content.length >= 8) ||
    Boolean(node.attributes?.alt)
  ) {
    candidateTypes.push("title");
  }
  if (/(?:[$€£]\s*\d|\d[\d,.]*\s*¢)/i.test(content)) {
    candidateTypes.push("current-price");
  }
  if (
    /(?:[$€£]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*¢)\s*(?:\/|\bper\b)\s*(?:fl\s*oz|oz|lb|kg|g|ml|l|ct|count|ea|each|sq\s*ft|sq\s*m|ft|in|yd|m)\b/i.test(
      content
    )
  ) {
    candidateTypes.push("native-unit-price");
  }
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:fl\s*oz|ounces?|oz|pounds?|lbs?|grams?|kg|ml|liters?|litres?|count|ct|pack|pk|each|ea|sq\s*ft|square\s+feet|feet|foot|ft|inches?|in|yards?|yd|meters?|metres?|m)\b/i.test(
      content
    )
  ) {
    candidateTypes.push("package-quantity");
  }
  return {
    nodeId: node.id,
    tag: node.tag,
    ...(node.role ? { role: node.role } : {}),
    content,
    bounds: node.bounds,
    candidateTypes
  };
}

function countCandidates(
  evidence: EvidenceCandidate[],
  type: string
): number {
  return evidence.filter((entry) => entry.candidateTypes.includes(type)).length;
}

function countCardsWith(
  queue: QueueItem[],
  field: keyof QueueItem["candidateCounts"]
): number {
  return queue.filter((item) => item.candidateCounts[field] > 0).length;
}

function siteId(pageId: string): string {
  const marker = pageId.lastIndexOf("--");
  if (marker <= 0) throw new Error(`${pageId}: page id lacks a site prefix`);
  return pageId.slice(0, marker);
}

function isDimension(value: string): value is Dimension {
  return ["mass", "volume", "count", "length", "area"].includes(value);
}

function countBy<T>(
  values: T[],
  key: (value: T) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
