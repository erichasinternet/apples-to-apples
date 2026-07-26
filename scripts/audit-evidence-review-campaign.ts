import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditEvidenceReviewCampaign } from "./evidence-review-campaign-lib";
import { loadEvidenceReviewCampaign } from "./evidence-review-campaign-io";

const options = parseOptions(process.argv.slice(2));
const report = auditEvidenceReviewCampaign(
  await loadEvidenceReviewCampaign({
    queueAPath: options.queueA,
    queueBPath: options.queueB,
    submissionsADirectory: options.submissionsA,
    submissionsBDirectory: options.submissionsB
  })
);
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, output, "utf8");
}
process.stdout.write(
  options.output
    ? `${JSON.stringify({
        valid: report.valid,
        pages: report.pages,
        candidateCards: report.candidateCards,
        reviewers: report.reviewers.map((reviewer) => ({
          reviewerId: reviewer.reviewerId,
          expected: reviewer.expected,
          valid: reviewer.valid,
          missing: reviewer.missingReviewIds.length,
          invalid: reviewer.invalid.length,
          unexpected: reviewer.unexpectedReviewIds.length
        })),
        pairedPages: report.pairedPages,
        pendingPages: report.pendingPages.length,
        readyForAdjudication: report.readyForAdjudication,
        output: options.output
      })}\n`
    : output
);
if (!report.valid) process.exitCode = 1;

function parseOptions(args: string[]): {
  queueA: string;
  queueB: string;
  submissionsA: string;
  submissionsB: string;
  output?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/audit-evidence-review-campaign.ts --queue-a queue-a.json --queue-b queue-b.json --submissions-a dir --submissions-b dir [--output report.json]"
      );
    }
    values.set(name, value);
  }
  const queueA = values.get("--queue-a");
  const queueB = values.get("--queue-b");
  const submissionsA = values.get("--submissions-a");
  const submissionsB = values.get("--submissions-b");
  if (!queueA || !queueB || !submissionsA || !submissionsB) {
    throw new Error(
      "Required: --queue-a, --queue-b, --submissions-a, --submissions-b"
    );
  }
  return {
    queueA: path.resolve(queueA),
    queueB: path.resolve(queueB),
    submissionsA: path.resolve(submissionsA),
    submissionsB: path.resolve(submissionsB),
    ...(values.get("--output")
      ? { output: path.resolve(values.get("--output")!) }
      : {})
  };
}
