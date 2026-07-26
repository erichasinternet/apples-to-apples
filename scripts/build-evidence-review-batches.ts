import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildEvidenceReviewBatchPairs,
  type EvidenceReviewBatchSource
} from "./evidence-review-batch-lib";
import type { EvidenceReviewQueue } from "./evidence-review-queue-lib";

const options = parseOptions(process.argv.slice(2));
const [sourceA, sourceB] = await Promise.all([
  readSource(options.queueA),
  readSource(options.queueB)
]);
const batches = buildEvidenceReviewBatchPairs({
  sourceA,
  sourceB,
  outputDirectory: options.outputDirectory,
  pagesPerBatch: options.pagesPerBatch
});
await mkdir(options.outputDirectory, { recursive: true });

const manifestBatches = [];
for (const batch of batches) {
  const suffix = String(batch.batchNumber).padStart(2, "0");
  const queueAPath = path.join(
    options.outputDirectory,
    `${sourceA.queue.reviewerId}--batch-${suffix}.json`
  );
  const queueBPath = path.join(
    options.outputDirectory,
    `${sourceB.queue.reviewerId}--batch-${suffix}.json`
  );
  const serializedA = `${JSON.stringify(batch.queueA, null, 2)}\n`;
  const serializedB = `${JSON.stringify(batch.queueB, null, 2)}\n`;
  await Promise.all([
    writeFile(queueAPath, serializedA, "utf8"),
    writeFile(queueBPath, serializedB, "utf8")
  ]);
  manifestBatches.push({
    batchId: `${options.campaignId}--batch-${suffix}`,
    batchNumber: batch.batchNumber,
    pageIds: batch.pageIds,
    pages: batch.pageIds.length,
    candidateCards: batch.candidateCards,
    reviewerQueues: [
      {
        reviewerId: batch.queueA.reviewerId,
        queueId: batch.queueA.queueId,
        path: path.relative(process.cwd(), queueAPath),
        sha256: sha256(serializedA)
      },
      {
        reviewerId: batch.queueB.reviewerId,
        queueId: batch.queueB.queueId,
        path: path.relative(process.cwd(), queueBPath),
        sha256: sha256(serializedB)
      }
    ]
  });
}

const manifest = {
  version: 1,
  campaignId: options.campaignId,
  createdAt: new Date().toISOString(),
  sourceCampaigns: [
    sourceManifestEntry(sourceA),
    sourceManifestEntry(sourceB)
  ],
  policy: {
    pagesPerBatch: options.pagesPerBatch,
    ordering: "page-id-ascending",
    pairedPageAssignments: true,
    reviewerIdentityPreserved: true,
    reviewIdsPreserved: true,
    labelVisibility: "no model or peer labels"
  },
  totals: {
    batches: manifestBatches.length,
    pages: manifestBatches.reduce((total, batch) => total + batch.pages, 0),
    candidateCards: manifestBatches.reduce(
      (total, batch) => total + batch.candidateCards,
      0
    )
  },
  batches: manifestBatches,
  eligibility: {
    dualReviewed: false,
    adjudicated: false,
    reason:
      "Batch generation preserves campaign integrity but does not replace independent review or adjudication."
  }
};
await mkdir(path.dirname(options.manifestPath), { recursive: true });
await writeFile(
  options.manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    campaignId: options.campaignId,
    ...manifest.totals,
    manifest: options.manifestPath
  })}\n`
);

async function readSource(filename: string): Promise<EvidenceReviewBatchSource> {
  const bytes = await readFile(filename);
  return {
    filename,
    sha256: sha256(bytes),
    queue: JSON.parse(bytes.toString("utf8")) as EvidenceReviewQueue
  };
}

function sourceManifestEntry(source: EvidenceReviewBatchSource): {
  reviewerId: string;
  queueId: string;
  path: string;
  sha256: string;
  pages: number;
} {
  return {
    reviewerId: source.queue.reviewerId,
    queueId: source.queue.queueId,
    path: path.relative(process.cwd(), source.filename),
    sha256: source.sha256,
    pages: source.queue.items.length
  };
}

function parseOptions(args: string[]): {
  queueA: string;
  queueB: string;
  outputDirectory: string;
  manifestPath: string;
  campaignId: string;
  pagesPerBatch: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/build-evidence-review-batches.ts --queue-a reviewer-a.json --queue-b reviewer-b.json --output-dir batches --manifest manifest.json --campaign-id campaign --pages-per-batch 10"
      );
    }
    values.set(key, value);
  }
  const queueA = values.get("--queue-a");
  const queueB = values.get("--queue-b");
  const outputDirectory = values.get("--output-dir");
  const manifestPath = values.get("--manifest");
  const campaignId = values.get("--campaign-id");
  const pagesPerBatch = Number(values.get("--pages-per-batch") ?? "10");
  if (!queueA || !queueB || !outputDirectory || !manifestPath || !campaignId) {
    throw new Error("Both queues, output paths, and campaign ID are required.");
  }
  return {
    queueA: path.resolve(queueA),
    queueB: path.resolve(queueB),
    outputDirectory: path.resolve(outputDirectory),
    manifestPath: path.resolve(manifestPath),
    campaignId,
    pagesPerBatch
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
