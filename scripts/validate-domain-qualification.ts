import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  expandTargets,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import {
  validateIdealDomainSplits,
  type IdealDomainSplits
} from "./ideal-dataset-lib";

const candidatePath = path.resolve(
  process.argv[2] ?? "benchmarks/live-sites/qualification-wave-01.json"
);
const existingPath = path.resolve("benchmarks/live-sites/targets.json");
const splitPath = path.resolve("benchmarks/ideal-domain-splits.json");
const [candidate, existing, splits] = await Promise.all([
  readJson<CorpusTargetManifest>(candidatePath),
  readJson<CorpusTargetManifest>(existingPath),
  readJson<IdealDomainSplits>(splitPath)
]);
const errors = validateIdealDomainSplits(splits);
const existingIds = new Set(existing.sites.map((site) => site.id));
const existingHosts = new Set(existing.sites.map((site) => site.hostname));
const candidateIds = new Set<string>();
const candidateHosts = new Set<string>();

for (const site of candidate.sites) {
  if (candidateIds.has(site.id)) errors.push(`duplicate candidate site id: ${site.id}`);
  if (candidateHosts.has(site.hostname)) {
    errors.push(`duplicate candidate hostname: ${site.hostname}`);
  }
  if (existingIds.has(site.id)) errors.push(`candidate site already exists: ${site.id}`);
  if (existingHosts.has(site.hostname)) {
    errors.push(`candidate hostname already exists: ${site.hostname}`);
  }
  candidateIds.add(site.id);
  candidateHosts.add(site.hostname);
  const searchUrl = new URL(
    site.searchUrlTemplate
      .replaceAll("{query}", "test")
      .replaceAll("{querySlug}", "test")
  );
  if (searchUrl.protocol !== "https:") {
    errors.push(`${site.id} search URL must use HTTPS`);
  }
  if (searchUrl.hostname !== site.hostname) {
    errors.push(`${site.id} hostname does not match its search URL`);
  }
}

const assigned = new Set([
  ...splits.training,
  ...splits.validation,
  ...splits.selection,
  ...splits.final,
  ...splits.retired
]);
for (const siteId of candidateIds) {
  if (assigned.has(siteId)) errors.push(`candidate is already assigned: ${siteId}`);
}

let targets = 0;
try {
  targets = expandTargets(candidate).length;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
}
const dimensions = new Set(
  Object.values(candidate.querySets ?? {})
    .flat()
    .map((query) => query.dimension)
);
const strata = new Set(candidate.sites.map((site) => site.stratum));
if (dimensions.size < 5) errors.push("qualification wave must cover all five dimensions");
if (strata.size < 8) errors.push("qualification wave must cover at least eight strata");

const report = {
  valid: errors.length === 0,
  candidatePath,
  sites: candidate.sites.length,
  targets,
  strata: strata.size,
  dimensions: [...dimensions].sort(),
  errors
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
