import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface AuditPart {
  version: number;
  createdAt: string;
  root: string;
  policy: Record<string, string>;
  counts: Record<string, number>;
  byDimension: Record<string, number>;
  byReason: Record<string, number>;
  bySite: Record<string, { pages: number; outputs: number; findings: number }>;
  errors: unknown[];
  findings: unknown[];
  emittedOutputs: unknown[];
}

const partsDirectory = path.resolve(
  optionValue("--parts") ?? "artifacts/audits/unit-price-parts-2026-08-01"
);
const output = path.resolve(
  optionValue("--output") ?? "artifacts/audits/unit-price-false-positives.json"
);
const filenames = (await readdir(partsDirectory))
  .filter((filename) => /^part-\d+\.json$/.test(filename))
  .sort((left, right) => partOffset(left) - partOffset(right));

if (filenames.length === 0) {
  throw new Error(`No audit parts found in ${partsDirectory}`);
}

const parts = await Promise.all(
  filenames.map(async (filename) =>
    JSON.parse(await readFile(path.join(partsDirectory, filename), "utf8")) as AuditPart
  )
);
const first = parts[0]!;
const counts: Record<string, number> = {};
const byDimension: Record<string, number> = {};
const byReason: Record<string, number> = {};
const bySite: AuditPart["bySite"] = {};

for (const part of parts) {
  addNumbers(counts, part.counts);
  addNumbers(byDimension, part.byDimension);
  addNumbers(byReason, part.byReason);
  for (const [site, values] of Object.entries(part.bySite)) {
    const total = (bySite[site] ??= { pages: 0, outputs: 0, findings: 0 });
    total.pages += values.pages;
    total.outputs += values.outputs;
    total.findings += values.findings;
  }
}

const report: AuditPart = {
  version: first.version,
  createdAt: new Date().toISOString(),
  root: first.root,
  policy: first.policy,
  counts,
  byDimension: sortRecord(byDimension),
  byReason: sortRecord(byReason),
  bySite: Object.fromEntries(
    Object.entries(bySite).sort(
      (left, right) =>
        right[1].findings - left[1].findings || left[0].localeCompare(right[0])
    )
  ),
  errors: parts.flatMap((part) => part.errors),
  findings: parts.flatMap((part) => part.findings),
  emittedOutputs: parts.flatMap((part) => part.emittedOutputs)
};

await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(output.replace(/\.json$/i, ".md"), renderMarkdown(report), "utf8")
]);

process.stdout.write(
  `${JSON.stringify({ output, parts: parts.length, counts, errors: report.errors.length }, null, 2)}\n`
);

function addNumbers(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function renderMarkdown(reportValue: AuditPart): string {
  const reasons = Object.entries(reportValue.byReason)
    .map(([reason, count]) => `| ${reason} | ${count} |`)
    .join("\n");
  return `# Unit-price false-positive audit\n\nGenerated: ${reportValue.createdAt}\n\n## Scope\n\n- Saved pages discovered: ${reportValue.counts.discoveredPages}\n- Pages audited: ${reportValue.counts.auditedPages}\n- Unit prices emitted: ${reportValue.counts.emittedUnitPrices}\n- Confirmed false positives: ${reportValue.counts.confirmedFalsePositives}\n- Deterministic semantic errors: ${reportValue.counts.outputsWithSemanticErrors}\n- Review candidates: ${reportValue.counts.reviewCandidates}\n- Unreviewed outputs: ${reportValue.counts.unreviewedOutputs}\n- Replay errors: ${reportValue.errors.length}\n\nNo population accuracy claim is made until annotations have complete output coverage and adjudication.\n\n## Reasons\n\n| Reason | Count |\n| --- | ---: |\n${reasons || "| None | 0 |"}\n`;
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
  );
}

function partOffset(filename: string): number {
  return Number.parseInt(filename.match(/\d+/)?.[0] ?? "0", 10);
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
