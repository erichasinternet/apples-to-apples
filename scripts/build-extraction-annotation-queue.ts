import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObservedNode, PageObservation } from "../src/learning/contracts";

interface SourceManifest {
  sources: Array<{
    bundleDirectory: string;
    reviewPath: string;
  }>;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    observationPath: string;
    imagePath: string;
  }>;
}

interface Review {
  reviewType: string;
  eligibleForTraining: boolean;
  retiredFromValidation: boolean;
  pages: Array<{
    pageId: string;
    siteId: string;
    productCardNodeIds: string[];
  }>;
}

const sourceManifestPath = path.resolve(
  optionValue("--sources") ??
    "benchmarks/reviews/adjudicated-development-sources.json"
);
const outputPath = path.resolve(
  optionValue("--output") ??
    "benchmark-data/review/extraction-development-annotation-queue.json"
);
const sourceManifest = await readJson<SourceManifest>(sourceManifestPath);
const queue: Array<Record<string, unknown>> = [];
let negativePages = 0;

for (const source of sourceManifest.sources) {
  const bundleDirectory = path.resolve(source.bundleDirectory);
  const reviewPath = path.resolve(source.reviewPath);
  const [manifest, review] = await Promise.all([
    readJson<BundleManifest>(path.join(bundleDirectory, "manifest.json")),
    readJson<Review>(reviewPath)
  ]);
  if (
    review.reviewType !== "adjudicated-development" ||
    !review.eligibleForTraining ||
    !review.retiredFromValidation
  ) {
    throw new Error(`${reviewPath}: source is not adjudicated training data`);
  }
  const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
  for (const reviewedPage of review.pages) {
    const page = pageMap.get(reviewedPage.pageId);
    if (!page) throw new Error(`${reviewedPage.pageId}: missing bundle page`);
    if (reviewedPage.productCardNodeIds.length === 0) negativePages += 1;
    const observation = await readJson<PageObservation>(
      path.join(bundleDirectory, page.observationPath)
    );
    const nodeMap = new Map(observation.nodes.map((node) => [node.id, node]));
    const children = buildChildren(observation.nodes);
    for (const cardNodeId of reviewedPage.productCardNodeIds) {
      const card = nodeMap.get(cardNodeId);
      if (!card) {
        throw new Error(`${reviewedPage.pageId}: unknown card ${cardNodeId}`);
      }
      const evidence = [card, ...collectDescendants(children, cardNodeId)]
        .map(toEvidenceCandidate)
        .filter((candidate) => candidate.content);
      queue.push({
        id: `${reviewedPage.pageId}:${cardNodeId}`,
        pageId: reviewedPage.pageId,
        siteId: reviewedPage.siteId,
        cardNodeId,
        source: {
          bundleDirectory: path.relative(process.cwd(), bundleDirectory),
          reviewPath: path.relative(process.cwd(), reviewPath),
          observationPath: page.observationPath,
          imagePath: page.imagePath
        },
        cardBounds: card.bounds,
        candidateCounts: {
          title: evidence.filter((entry) => entry.candidateTypes.includes("title"))
            .length,
          currentPrice: evidence.filter((entry) =>
            entry.candidateTypes.includes("current-price")
          ).length,
          nativeUnitPrice: evidence.filter((entry) =>
            entry.candidateTypes.includes("native-unit-price")
          ).length,
          packageQuantity: evidence.filter((entry) =>
            entry.candidateTypes.includes("package-quantity")
          ).length
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
}

queue.sort((left, right) =>
  String(left.id).localeCompare(String(right.id))
);
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  sourceManifest: path.relative(process.cwd(), sourceManifestPath),
  policy:
    "Candidate types are deterministic review aids, not labels. A reviewer must ground every accepted value in card-local evidence node IDs, explicitly abstain when comparison facts are unsupported, and obtain independent adjudication before training or benchmark use.",
  counts: {
    cards: queue.length,
    negativePages,
    withTitleCandidate: countCardsWith(queue, "title"),
    withCurrentPriceCandidate: countCardsWith(queue, "currentPrice"),
    withNativeUnitPriceCandidate: countCardsWith(queue, "nativeUnitPrice"),
    withPackageQuantityCandidate: countCardsWith(queue, "packageQuantity")
  },
  queue
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({ outputPath, counts: report.counts }, null, 2)}\n`
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

function toEvidenceCandidate(node: ObservedNode): {
  nodeId: string;
  tag: string;
  role?: string;
  content: string;
  bounds: ObservedNode["bounds"];
  candidateTypes: string[];
} {
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
    /(?:[$€£]\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*¢)\s*(?:\/|\bper\b)\s*(?:fl\s*oz|oz|lb|kg|g|ml|l|ct|count|ea|each)\b/i.test(
      content
    )
  ) {
    candidateTypes.push("native-unit-price");
  }
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:fl\s*oz|ounces?|oz|pounds?|lbs?|grams?|kg|ml|liters?|litres?|count|ct|pack|pk|each|ea)\b/i.test(
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

function countCardsWith(
  queue: Array<Record<string, unknown>>,
  field: string
): number {
  return queue.filter((item) => {
    const counts = item.candidateCounts as Record<string, number>;
    return (counts[field] ?? 0) > 0;
  }).length;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
