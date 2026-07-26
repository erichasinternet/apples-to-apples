import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { enumerateEvidenceCandidates } from "../src/learning/evidence-pointer";
import {
  buildEvidenceSelectionPrompt,
  resolveEvidenceSelection,
  serializeEvidenceSelection,
} from "../src/learning/evidence-selection";
import type {
  ModelProductExtraction,
  PageObservation,
} from "../src/learning/contracts";
import {
  productEvidenceNodeIds,
  pruneObservationForModel,
} from "./t5-training-lib";

interface QueueItem {
  id: string;
  siteId: string;
  source: {
    bundleDirectory: string;
    observationPath: string;
  };
}

interface QueueReport {
  sourceCampaign: string;
  sourceCampaignSha256: string;
  sourceReviewStatus: string;
  queue: QueueItem[];
}

interface Preannotation {
  id: string;
  siteId: string;
  outcome: "comparable" | "abstained";
  extraction: ModelProductExtraction;
}

interface PreannotationReport {
  sourceReviewStatus: string;
  preannotations: Preannotation[];
}

interface AuditReport {
  eligibleForSilverTraining: boolean;
  eligibleForBenchmarkGold: boolean;
  eligibleIds: string[];
}

const queuePath = path.resolve(
  optionValue("--queue") ??
    "benchmark-data/review/g2-pilot-campaign-extraction-queue.json",
);
const preannotationPath = path.resolve(
  optionValue("--preannotations") ??
    "benchmark-data/review/g2-pilot-campaign-extraction-preannotations.json",
);
const auditPath = path.resolve(
  optionValue("--audit") ??
    "benchmark-data/review/g2-pilot-campaign-extraction-audit.json",
);
const outputPath = path.resolve(
  optionValue("--output") ??
    "benchmarks/reviews/g2-selection-representation-p00.json",
);

const [queueBytes, preannotationBytes, auditBytes] = await Promise.all([
  readFile(queuePath),
  readFile(preannotationPath),
  readFile(auditPath),
]);
const queueReport = JSON.parse(queueBytes.toString("utf8")) as QueueReport;
const preannotationReport = JSON.parse(
  preannotationBytes.toString("utf8"),
) as PreannotationReport;
const auditReport = JSON.parse(auditBytes.toString("utf8")) as AuditReport;
const queueById = new Map(queueReport.queue.map((item) => [item.id, item]));
const preannotationById = new Map(
  preannotationReport.preannotations.map((item) => [item.id, item]),
);
const observationCache = new Map<string, PageObservation>();
const promptLengths: number[] = [];
const targetLengths: number[] = [];
const nodeCounts: number[] = [];
const candidateCounts: number[] = [];
const statuses: Record<string, number> = {};
const sites: Record<
  string,
  { records: number; comparable: number; abstained: number }
> = {};
const failures: Array<{ id: string; reason: string }> = [];
let exactRoundTrips = 0;

for (const id of auditReport.eligibleIds) {
  const queueItem = queueById.get(id);
  const preannotation = preannotationById.get(id);
  if (!queueItem || !preannotation) {
    failures.push({ id, reason: "missing-source-record" });
    continue;
  }
  const observationPath = path.resolve(
    queueItem.source.bundleDirectory,
    queueItem.source.observationPath,
  );
  let observation = observationCache.get(observationPath);
  if (!observation) {
    observation = JSON.parse(
      await readFile(observationPath, "utf8"),
    ) as PageObservation;
    observationCache.set(observationPath, observation);
  }
  try {
    const evidenceNodeIds = productEvidenceNodeIds(preannotation.extraction);
    const modelObservation = pruneObservationForModel(
      observation,
      32,
      [preannotation.extraction.cardNodeId, ...evidenceNodeIds],
      evidenceNodeIds,
    );
    const prompt = buildEvidenceSelectionPrompt(
      modelObservation,
      preannotation.extraction.cardNodeId,
    );
    const target = serializeEvidenceSelection(
      preannotation.extraction,
      modelObservation,
    );
    const resolved = resolveEvidenceSelection(
      target,
      modelObservation,
      preannotation.extraction.cardNodeId,
    );
    const resolvedProduct = resolved.extraction?.products[0];
    if (!resolved.valid || !resolvedProduct) {
      throw new Error(
        `resolution:${resolved.issues.map((issue) => issue.code).join(",")}`,
      );
    }
    if (
      serializeEvidenceSelection(resolvedProduct, modelObservation) !== target
    ) {
      throw new Error("non-exact-round-trip");
    }
    exactRoundTrips += 1;
    promptLengths.push(prompt.length);
    targetLengths.push(target.length);
    nodeCounts.push(modelObservation.nodes.length);
    candidateCounts.push(
      enumerateEvidenceCandidates(
        modelObservation,
        preannotation.extraction.cardNodeId,
      ).length,
    );
    const status = target.slice(-1);
    statuses[status] = (statuses[status] ?? 0) + 1;
    const site = (sites[preannotation.siteId] ??= {
      records: 0,
      comparable: 0,
      abstained: 0,
    });
    site.records += 1;
    site.comparable += Number(preannotation.outcome === "comparable");
    site.abstained += Number(preannotation.outcome === "abstained");
  } catch (error) {
    failures.push({
      id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

const report = {
  version: 1,
  auditId: "g2-selection-representation-p00",
  targetFormat: "evidence-selection-v1",
  source: {
    campaign: queueReport.sourceCampaign,
    campaignSha256: queueReport.sourceCampaignSha256,
    queueSha256: sha256(queueBytes),
    preannotationSha256: sha256(preannotationBytes),
    auditSha256: sha256(auditBytes),
    sourceReviewStatus: queueReport.sourceReviewStatus,
  },
  records: {
    requested: auditReport.eligibleIds.length,
    exactRoundTrips,
    failures: failures.length,
    pages: observationCache.size,
    sites: Object.keys(sites).length,
  },
  statuses: Object.fromEntries(
    Object.entries(statuses).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  representation: {
    promptChars: summarize(promptLengths),
    targetChars: summarize(targetLengths),
    observationNodes: summarize(nodeCounts),
    valueCandidates: summarize(candidateCounts),
    outputGrammar: "T## P## U## Q## K## S#",
    generatedValues: false,
    generatedDomIds: false,
  },
  sites: Object.fromEntries(
    Object.entries(sites).sort(([left], [right]) => left.localeCompare(right)),
  ),
  failures,
  validation: {
    passed:
      failures.length === 0 &&
      exactRoundTrips === auditReport.eligibleIds.length,
  },
  eligibility: {
    silverTraining: auditReport.eligibleForSilverTraining,
    benchmarkGold: auditReport.eligibleForBenchmarkGold,
    reason:
      "Representation compatibility does not establish label correctness. The source remains unreviewed and requires independent review and adjudication.",
  },
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.validation.passed) process.exitCode = 1;

function summarize(values: number[]): {
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
} {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
    mean:
      values.length > 0
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : 0,
  };
}

function percentile(sorted: number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
  ]!;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
