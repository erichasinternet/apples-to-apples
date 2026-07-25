import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  preannotateExtraction,
  type ExtractionPreannotation,
  type ExtractionQueueItem
} from "./extraction-preannotation-lib";

interface QueueReport {
  version: number;
  queue: Array<
    ExtractionQueueItem & {
      source: {
        bundleDirectory: string;
        observationPath: string;
      };
    }
  >;
}

const queuePath = path.resolve(
  optionValue("--queue") ??
    "benchmark-data/review/extraction-development-annotation-queue.json"
);
const outputPath = path.resolve(
  optionValue("--output") ??
    "benchmark-data/review/extraction-development-preannotations.json"
);
const queueBytes = await readFile(queuePath);
const queue = JSON.parse(queueBytes.toString("utf8")) as QueueReport;
const observationCache = new Map<string, PageObservation>();
const preannotations: ExtractionPreannotation[] = [];

for (const item of queue.queue) {
  const observationPath = path.resolve(
    item.source.bundleDirectory,
    item.source.observationPath
  );
  let observation = observationCache.get(observationPath);
  if (!observation) {
    observation = JSON.parse(
      await readFile(observationPath, "utf8")
    ) as PageObservation;
    observationCache.set(observationPath, observation);
  }
  preannotations.push(preannotateExtraction(item, observation));
}

const counts = {
  cards: preannotations.length,
  comparable: preannotations.filter((item) => item.outcome === "comparable")
    .length,
  abstained: preannotations.filter((item) => item.outcome === "abstained")
    .length,
  invalid: preannotations.filter((item) => !item.evidenceValidation.valid)
    .length,
  methods: countBy(preannotations, (item) => item.method),
  abstentionReasons: countBy(
    preannotations.filter((item) => item.outcome === "abstained"),
    (item) => item.extraction.abstainReason ?? "missing"
  ),
  sites: siteCounts(preannotations)
};
const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  queuePath: path.relative(process.cwd(), queuePath),
  queueSha256: createHash("sha256").update(queueBytes).digest("hex"),
  policy:
    "Deterministic high-precision silver preannotations. Outputs must pass card-local evidence validation. They are never benchmark gold and require independent quality sampling before training eligibility.",
  eligibleForSilverTraining: false,
  eligibleForBenchmarkGold: false,
  counts,
  preannotations
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      eligibleForSilverTraining: report.eligibleForSilverTraining,
      counts
    },
    null,
    2
  )}\n`
);

function countBy<T>(
  values: T[],
  key: (value: T) => string
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const name = key(value);
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function siteCounts(
  values: ExtractionPreannotation[]
): Record<
  string,
  { cards: number; comparable: number; abstained: number; invalid: number }
> {
  const counts: Record<
    string,
    { cards: number; comparable: number; abstained: number; invalid: number }
  > = {};
  for (const value of values) {
    const site = (counts[value.siteId] ??= {
      cards: 0,
      comparable: 0,
      abstained: 0,
      invalid: 0
    });
    site.cards += 1;
    site.comparable += Number(value.outcome === "comparable");
    site.abstained += Number(value.outcome === "abstained");
    site.invalid += Number(!value.evidenceValidation.valid);
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
