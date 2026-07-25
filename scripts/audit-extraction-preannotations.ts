import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionPreannotation } from "./extraction-preannotation-lib";
import {
  auditExtractionPreannotation,
  type ExtractionQualityAudit
} from "./extraction-quality-audit-lib";

interface PreannotationReport {
  version: number;
  preannotations: ExtractionPreannotation[];
}

const inputPath = path.resolve(
  optionValue("--input") ??
    "benchmark-data/review/extraction-development-preannotations.json"
);
const outputPath = path.resolve(
  optionValue("--output") ??
    "benchmark-data/review/extraction-development-silver-audit.json"
);
const inputBytes = await readFile(inputPath);
const input = JSON.parse(inputBytes.toString("utf8")) as PreannotationReport;
const audits = input.preannotations.map(auditExtractionPreannotation);
const eligibleIds = audits
  .filter((audit) => audit.eligibleForSilverTraining)
  .map((audit) => audit.id);
const quarantined = audits.filter(
  (audit) => !audit.eligibleForSilverTraining
);
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  inputPath: path.relative(process.cwd(), inputPath),
  inputSha256: createHash("sha256").update(inputBytes).digest("hex"),
  policy:
    "Independent deterministic semantic audit for silver training only. Benchmark gold still requires dual review and adjudication.",
  eligibleForSilverTraining: quarantined.length < audits.length,
  eligibleForBenchmarkGold: false,
  counts: {
    cards: audits.length,
    eligible: eligibleIds.length,
    quarantined: quarantined.length,
    eligibleComparable: countOutcome(audits, true, "comparable"),
    eligibleAbstained: countOutcome(audits, true, "abstained"),
    quarantinedComparable: countOutcome(audits, false, "comparable"),
    quarantinedAbstained: countOutcome(audits, false, "abstained"),
    quarantineReasons: countReasons(quarantined),
    sites: countSites(audits)
  },
  eligibleIds,
  audits
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      eligibleForSilverTraining: report.eligibleForSilverTraining,
      counts: report.counts
    },
    null,
    2
  )}\n`
);

function countOutcome(
  audits: ExtractionQualityAudit[],
  eligible: boolean,
  outcome: ExtractionQualityAudit["outcome"]
): number {
  return audits.filter(
    (audit) =>
      audit.eligibleForSilverTraining === eligible && audit.outcome === outcome
  ).length;
}

function countReasons(
  audits: ExtractionQualityAudit[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reason of audits.flatMap((audit) => audit.reasons)) {
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function countSites(
  audits: ExtractionQualityAudit[]
): Record<string, { cards: number; eligible: number; quarantined: number }> {
  const counts: Record<
    string,
    { cards: number; eligible: number; quarantined: number }
  > = {};
  for (const audit of audits) {
    const site = (counts[audit.siteId] ??= {
      cards: 0,
      eligible: 0,
      quarantined: 0
    });
    site.cards += 1;
    site.eligible += Number(audit.eligibleForSilverTraining);
    site.quarantined += Number(!audit.eligibleForSilverTraining);
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
