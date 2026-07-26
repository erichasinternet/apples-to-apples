import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEvidenceAdjudicationQueue } from "./evidence-adjudication-queue-lib";
import { loadEvidenceReviewCampaign } from "./evidence-review-campaign-io";

const options = parseOptions(process.argv.slice(2));
const campaign = await loadEvidenceReviewCampaign(options);
const queue = buildEvidenceAdjudicationQueue({
  ...campaign,
  adjudicatorId: options.adjudicatorId,
  queueAPath: options.queueAPath,
  outputPath: options.outputPath
});
await mkdir(path.dirname(options.outputPath), { recursive: true });
await writeFile(
  options.outputPath,
  `${JSON.stringify(queue, null, 2)}\n`,
  { encoding: "utf8", flag: "wx" }
);
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    queueId: queue.queueId,
    reviewerId: queue.reviewerId,
    pages: queue.items.length,
    cards: queue.items.reduce(
      (total, item) => total + item.candidateCardNodeIds.length,
      0
    ),
    disagreements: queue.items.reduce(
      (total, item) => total + item.agreement.disagreements.length,
      0
    ),
    output: options.outputPath
  })}\n`
);

function parseOptions(args: string[]): {
  queueAPath: string;
  queueBPath: string;
  submissionsADirectory: string;
  submissionsBDirectory: string;
  adjudicatorId: string;
  outputPath: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/build-evidence-adjudication-queue.ts --queue-a queue-a.json --queue-b queue-b.json --submissions-a dir --submissions-b dir --adjudicator id --output queue.json"
      );
    }
    values.set(name, value);
  }
  const queueAPath = values.get("--queue-a");
  const queueBPath = values.get("--queue-b");
  const submissionsADirectory = values.get("--submissions-a");
  const submissionsBDirectory = values.get("--submissions-b");
  const adjudicatorId = values.get("--adjudicator");
  const outputPath = values.get("--output");
  if (
    !queueAPath ||
    !queueBPath ||
    !submissionsADirectory ||
    !submissionsBDirectory ||
    !adjudicatorId ||
    !outputPath
  ) {
    throw new Error(
      "Required: --queue-a, --queue-b, --submissions-a, --submissions-b, --adjudicator, --output"
    );
  }
  return {
    queueAPath: path.resolve(queueAPath),
    queueBPath: path.resolve(queueBPath),
    submissionsADirectory: path.resolve(submissionsADirectory),
    submissionsBDirectory: path.resolve(submissionsBDirectory),
    adjudicatorId,
    outputPath: path.resolve(outputPath)
  };
}

