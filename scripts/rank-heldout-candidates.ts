import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

interface SiteDefinition {
  id: string;
  hostname: string;
  stratum: string;
  queries: Array<{
    id: string;
    query: string;
    dimension: string;
  }>;
}

interface SiteManifest {
  sites?: SiteDefinition[];
}

interface QualificationReport {
  results?: Record<
    string,
    {
      status: string;
      reason?: string;
    }
  >;
}

const qualificationDirectory = path.resolve(
  "benchmarks/domain-qualification"
);
const liveSiteDirectory = path.resolve("benchmarks/live-sites");
const promotions = await readJson<{
  promotions: Array<{ siteId: string }>;
}>(path.join(qualificationDirectory, "promotions.json"));
const promoted = new Set(promotions.promotions.map((entry) => entry.siteId));
const retried = new Set<string>();
const liveFiles = await readdir(liveSiteDirectory);

for (const filename of liveFiles.filter(
  (entry) => entry.startsWith("heldout-") && entry.endsWith(".json")
)) {
  const manifest = await readJson<SiteManifest>(
    path.join(liveSiteDirectory, filename)
  );
  for (const site of manifest.sites ?? []) retried.add(site.id);
}

const siteDefinitions = new Map<
  string,
  SiteDefinition & { sourceManifest: string }
>();
for (const filename of liveFiles.filter(
  (entry) =>
    (entry.startsWith("qualification-wave-") || entry === "targets.json") &&
    entry.endsWith(".json")
)) {
  const manifest = await readJson<SiteManifest>(
    path.join(liveSiteDirectory, filename)
  );
  for (const site of manifest.sites ?? []) {
    if (!siteDefinitions.has(site.id)) {
      siteDefinitions.set(site.id, { ...site, sourceManifest: filename });
    }
  }
}

const latestResults = new Map<
  string,
  { report: string; status: string; reason: string }
>();
const qualificationFiles = (await readdir(qualificationDirectory))
  .filter((entry) => /^wave-.*\.json$/.test(entry))
  .sort();
for (const filename of qualificationFiles) {
  const report = await readJson<QualificationReport>(
    path.join(qualificationDirectory, filename)
  );
  for (const [siteId, result] of Object.entries(report.results ?? {})) {
    latestResults.set(siteId, {
      report: filename,
      status: result.status,
      reason: result.reason ?? ""
    });
  }
}

const candidates = [];
for (const [siteId, result] of latestResults) {
  const site = siteDefinitions.get(siteId);
  if (
    !site ||
    promoted.has(siteId) ||
    retried.has(siteId) ||
    result.status !== "rejected"
  ) {
    continue;
  }
  candidates.push({
    score: recoverabilityScore(result.reason),
    siteId,
    hostname: site.hostname,
    stratum: site.stratum,
    dimensions: [...new Set(site.queries.map((query) => query.dimension))],
    queries: site.queries,
    sourceManifest: site.sourceManifest,
    qualificationReport: result.report,
    priorReason: result.reason
  });
}
candidates.sort(
  (left, right) =>
    right.score - left.score || left.siteId.localeCompare(right.siteId)
);

process.stdout.write(
  `${JSON.stringify(
    {
      version: 1,
      promotedDomains: promoted.size,
      previouslyRetriedDomains: retried.size,
      candidates: candidates.length,
      results: candidates
    },
    null,
    2
  )}\n`
);

function recoverabilityScore(reason: string): number {
  let score = 0;
  if (/passed screening|passed the (desktop|narrow)|coherent/i.test(reason)) {
    score += 6;
  }
  if (/complete query|candidate|product root/i.test(reason)) score += 2;
  if (/obstruction|annotation|clipp|displaced/i.test(reason)) score += 2;
  if (/404|route|search|query evidence/i.test(reason)) score += 2;
  if (/timeout|bound|deadline/i.test(reason)) score += 1;
  if (
    /bot challenge|HTTP 403|DNS|redirected to Google|different registrable domain/i.test(
      reason
    )
  ) {
    score -= 5;
  }
  return score;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
