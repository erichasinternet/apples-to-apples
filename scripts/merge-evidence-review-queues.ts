import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  mergeEvidenceReviewQueues,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueSource
} from "./evidence-review-queue-lib";

const { output, inputs } = parseOptions(process.argv.slice(2));
const sources = await Promise.all(
  inputs.map(async (filename): Promise<EvidenceReviewQueueSource> => {
    const resolved = path.resolve(filename);
    const value = await readFile(resolved);
    return {
      filename: resolved,
      sha256: sha256(value),
      queue: JSON.parse(value.toString("utf8")) as EvidenceReviewQueue
    };
  })
);
const campaign = mergeEvidenceReviewQueues(sources, output);
const serialized = `${JSON.stringify(campaign, null, 2)}\n`;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, serialized, "utf8");
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    queueId: campaign.queueId,
    reviewerId: campaign.reviewerId,
    pages: campaign.items.length,
    sha256: sha256(serialized),
    output
  })}\n`
);

function parseOptions(args: string[]): { output: string; inputs: string[] } {
  const outputIndex = args.indexOf("--output");
  const outputValue = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
  if (!outputValue) {
    throw new Error(
      "Usage: bun scripts/merge-evidence-review-queues.ts --output campaign.json queue-a.json queue-b.json [...]"
    );
  }
  const inputs = args.filter(
    (_, index) => index !== outputIndex && index !== outputIndex + 1
  );
  if (inputs.length < 2 || inputs.some((value) => value.startsWith("--"))) {
    throw new Error("At least two source queue paths are required.");
  }
  return { output: path.resolve(outputValue), inputs };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
