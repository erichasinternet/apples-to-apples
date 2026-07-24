import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObservedNode, PageObservation } from "../src/learning/contracts";
import type { T5InferenceRecord } from "./t5-training-lib";

interface Prediction {
  id: string;
  pageId: string;
  siteId: string;
  prediction: string;
}

interface BundleManifest {
  pages: Array<{
    pageId: string;
    siteId: string;
    sourceDirectory: string;
    observationPath: string;
    imagePath: string;
  }>;
}

interface Candidate {
  nodeId: string;
}

const bundle = path.resolve(
  process.argv[2] ?? "benchmark-data/inference/t5gemma2-heldout"
);
const predictionsPath = path.resolve(
  process.argv[3] ??
    path.join(bundle, "discovery-predictions-balanced-real-adapted.jsonl")
);
const outputPath = path.resolve(
  process.argv[4] ?? path.join(bundle, "discovery-review-queue.json")
);
const manifest = await readJson<BundleManifest>(path.join(bundle, "manifest.json"));
const records = await readJsonl<T5InferenceRecord>(path.join(bundle, "discovery.jsonl"));
const predictions = await readJsonl<Prediction>(predictionsPath);
const recordsById = new Map(records.map((record) => [record.id, record]));
const pageMap = new Map(manifest.pages.map((page) => [page.pageId, page]));
const observations = new Map<string, PageObservation>();
const references = new Map<string, Set<string>>();
const proposed = new Map<
  string,
  {
    pageId: string;
    siteId: string;
    nodeId: string;
    sourceChunkIds: Set<string>;
  }
>();
const malformedPredictions: string[] = [];

for (const page of manifest.pages) {
  const [observation, filenames] = await Promise.all([
    readJson<PageObservation>(path.join(bundle, page.observationPath)),
    readdir(path.join(page.sourceDirectory, "cards")).catch(() => [])
  ]);
  observations.set(page.pageId, observation);
  const candidates = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith(".json"))
      .map((filename) =>
        readJson<Candidate>(path.join(page.sourceDirectory, "cards", filename))
      )
  );
  references.set(page.pageId, new Set(candidates.map((candidate) => candidate.nodeId)));
}

for (const prediction of predictions) {
  const record = recordsById.get(prediction.id);
  const parsed = parseJsonPrefix(prediction.prediction);
  if (
    !record ||
    !parsed ||
    parsed.version !== 1 ||
    parsed.pageId !== prediction.pageId ||
    !Array.isArray(parsed.cardNodeIds)
  ) {
    malformedPredictions.push(prediction.id);
    continue;
  }
  for (const nodeId of parsed.cardNodeIds) {
    if (typeof nodeId !== "string") continue;
    const key = `${prediction.pageId}:${nodeId}`;
    const entry = proposed.get(key) ?? {
      pageId: prediction.pageId,
      siteId: prediction.siteId,
      nodeId,
      sourceChunkIds: new Set<string>()
    };
    entry.sourceChunkIds.add(record.id);
    proposed.set(key, entry);
  }
}

const queue = [...proposed.values()]
  .map((proposal) => {
    const page = pageMap.get(proposal.pageId);
    const observation = observations.get(proposal.pageId);
    const node = observation?.nodes.find((candidate) => candidate.id === proposal.nodeId);
    return {
      pageId: proposal.pageId,
      siteId: proposal.siteId,
      imagePath: page?.imagePath,
      nodeId: proposal.nodeId,
      status: node ? "needs-review" : "rejected-unknown-node",
      requiresHumanReview: Boolean(node),
      weakCollectorReference:
        references.get(proposal.pageId)?.has(proposal.nodeId) ?? false,
      sourceChunkIds: [...proposal.sourceChunkIds].sort(),
      ...(node
        ? {
            node: summarizeNode(node),
            descendantText: collectDescendantText(observation!, node.id)
          }
        : {})
    };
  })
  .sort(
    (left, right) =>
      left.pageId.localeCompare(right.pageId) || left.nodeId.localeCompare(right.nodeId)
  );

const report = {
  version: 1,
  policy:
    "Model roots are preannotations only. Two independent reviewers must accept product-card roots and adjudicate disagreements before training or benchmark use.",
  counts: {
    predictions: predictions.length,
    malformedPredictions: malformedPredictions.length,
    uniqueProposals: queue.length,
    needsReview: queue.filter((entry) => entry.requiresHumanReview).length,
    rejectedUnknownNode: queue.filter((entry) => !entry.requiresHumanReview).length,
    weakCollectorReferences: queue.filter((entry) => entry.weakCollectorReference).length
  },
  malformedPredictions,
  queue
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report.counts, null, 2)}\n`);

function summarizeNode(node: ObservedNode) {
  return {
    tag: node.tag,
    role: node.role,
    text: node.text,
    accessibleName: node.accessibleName,
    bounds: node.bounds,
    interactive: node.interactive
  };
}

function collectDescendantText(observation: PageObservation, rootId: string): string[] {
  const children = new Map<string, ObservedNode[]>();
  for (const node of observation.nodes) {
    if (!node.parentId) continue;
    const entries = children.get(node.parentId) ?? [];
    entries.push(node);
    children.set(node.parentId, entries);
  }
  const values: string[] = [];
  const pending = [...(children.get(rootId) ?? [])];
  while (pending.length > 0 && values.length < 12) {
    const node = pending.shift()!;
    const text = node.text?.trim() || node.accessibleName?.trim();
    if (text && !values.includes(text)) values.push(text.slice(0, 500));
    pending.push(...(children.get(node.id) ?? []));
  }
  return values;
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

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  return (await readFile(filePath, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}
