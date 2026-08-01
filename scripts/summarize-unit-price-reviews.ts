import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface AuditOutput {
  capture: string;
  pageId: string;
  siteId: string;
  title: string;
  display: string;
  dimension: string;
  source: string;
}

interface AuditReport {
  emittedOutputs: AuditOutput[];
}

interface Review {
  model: string;
  promptVersion: number;
  signatureId: string;
  outputIndexes: number[];
  decision: "valid" | "invalid" | "uncertain";
  reason: string;
  raw: string;
}

const auditPath = path.resolve(
  optionValue("--audit") ?? "artifacts/audits/unit-price-false-positives.json"
);
const reviewsPath = path.resolve(
  optionValue("--reviews") ?? "artifacts/audits/unit-price-semantic-reviews.jsonl"
);
const outputPath = path.resolve(
  optionValue("--output") ?? "artifacts/audits/unit-price-semantic-review-summary.json"
);

const audit = JSON.parse(await readFile(auditPath, "utf8")) as AuditReport;
const reviews = (await readFile(reviewsPath, "utf8"))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Review);
const byOutput = new Map<number, Review>();
const duplicateAssignments: number[] = [];
for (const review of reviews) {
  for (const index of review.outputIndexes) {
    if (byOutput.has(index)) duplicateAssignments.push(index);
    byOutput.set(index, review);
  }
}

const counts = {
  auditOutputs: audit.emittedOutputs.length,
  uniqueEvidenceSetsReviewed: reviews.length,
  outputsReviewed: byOutput.size,
  valid: 0,
  invalid: 0,
  uncertain: 0,
  missing: 0,
  invalidModelResponses: 0
};
const byReason: Record<string, number> = {};
const bySite: Record<string, { reviewed: number; invalid: number; uncertain: number }> = {};
const flagged: Array<AuditOutput & Pick<Review, "decision" | "reason" | "raw" | "signatureId">> = [];

for (const [index, output] of audit.emittedOutputs.entries()) {
  const review = byOutput.get(index);
  if (!review) {
    counts.missing += 1;
    continue;
  }
  counts[review.decision] += 1;
  if (review.reason === "invalid-model-response") counts.invalidModelResponses += 1;
  byReason[review.reason] = (byReason[review.reason] ?? 0) + 1;
  const site = (bySite[output.siteId] ??= { reviewed: 0, invalid: 0, uncertain: 0 });
  site.reviewed += 1;
  if (review.decision !== "valid") site[review.decision] += 1;
  if (review.decision !== "valid") {
    flagged.push({
      ...output,
      decision: review.decision,
      reason: review.reason,
      raw: review.raw,
      signatureId: review.signatureId
    });
  }
}

const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  policy: {
    reviewType: "independent-model-semantic-review",
    limitations:
      "Model review is a systematic second opinion, not human adjudication or benchmark gold. Deterministic audits separately verify arithmetic and conversion invariants.",
    completionRule:
      "Complete only when every emitted output maps to exactly one reviewed evidence signature and no model response is unparsable."
  },
  reviewer: reviews[0]
    ? { model: reviews[0].model, promptVersion: reviews[0].promptVersion }
    : null,
  complete:
    counts.missing === 0 &&
    counts.outputsReviewed === counts.auditOutputs &&
    counts.invalidModelResponses === 0 &&
    duplicateAssignments.length === 0,
  counts,
  duplicateAssignments,
  byReason: sortRecord(byReason),
  bySite: Object.fromEntries(
    Object.entries(bySite).sort(
      (left, right) =>
        right[1].invalid - left[1].invalid ||
        right[1].uncertain - left[1].uncertain ||
        left[0].localeCompare(right[0])
    )
  ),
  flagged
};

await mkdir(path.dirname(outputPath), { recursive: true });
await Promise.all([
  writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(outputPath.replace(/\.json$/i, ".md"), renderMarkdown(report), "utf8")
]);
process.stdout.write(
  `${JSON.stringify({ outputPath, complete: report.complete, counts, flagged: flagged.length }, null, 2)}\n`
);

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sortRecord<T extends number>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  );
}

function renderMarkdown(reportValue: {
  complete: boolean;
  counts: typeof counts;
  flagged: typeof flagged;
}): string {
  const lines = [
    "# Unit-price semantic review",
    "",
    `- Complete: ${reportValue.complete ? "yes" : "no"}`,
    `- Outputs reviewed: ${reportValue.counts.outputsReviewed}/${reportValue.counts.auditOutputs}`,
    `- Unique evidence sets reviewed: ${reportValue.counts.uniqueEvidenceSetsReviewed}`,
    `- Valid: ${reportValue.counts.valid}`,
    `- Invalid: ${reportValue.counts.invalid}`,
    `- Uncertain: ${reportValue.counts.uncertain}`,
    `- Invalid model responses: ${reportValue.counts.invalidModelResponses}`,
    "",
    "Model review is not human adjudication. Flagged cases require rule analysis and representative visual verification before release.",
    "",
    "## Flagged examples",
    ""
  ];
  for (const item of reportValue.flagged.slice(0, 100)) {
    lines.push(`- **${item.siteId}** ${item.title} -> ${item.display} (${item.reason})`);
  }
  return `${lines.join("\n")}\n`;
}
