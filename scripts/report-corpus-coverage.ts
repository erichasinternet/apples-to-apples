import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  expandTargets,
  getDomainSplit,
  validateDomainSplits,
  type CorpusDomainSplits,
  type CorpusTargetManifest
} from "./live-corpus-lib";

const [manifest, splits] = await Promise.all([
  readJson<CorpusTargetManifest>(path.resolve("benchmarks/live-sites/targets.json")),
  readJson<CorpusDomainSplits>(path.resolve("benchmarks/live-sites/domain-splits.json"))
]);
const errors = validateDomainSplits(manifest, splits);
const targets = expandTargets(manifest);
const splitCounts = {
  development: splits.development.length,
  selection: splits.selection.length,
  heldOut: splits.heldOut.length
};
const pagesBySplit = {
  development: targets.filter((target) => getDomainSplit(target.siteId, splits) === "development").length,
  selection: targets.filter((target) => getDomainSplit(target.siteId, splits) === "selection").length,
  heldOut: targets.filter((target) => getDomainSplit(target.siteId, splits) === "heldOut").length
};
const domainsByStratum = Object.fromEntries(
  [...new Set(manifest.sites.map((site) => site.stratum))]
    .sort()
    .map((stratum) => [
      stratum,
      manifest.sites.filter((site) => site.stratum === stratum).length
    ])
);
const pagesByDimension = Object.fromEntries(
  ["mass", "volume", "count", "area", "length"].map((dimension) => [
    dimension,
    targets.filter((target) => target.dimension === dimension).length
  ])
);
const summary = {
  domains: manifest.sites.length,
  pages: targets.length,
  productsAtTwelvePerPage: targets.length * 12,
  splitCounts,
  pagesBySplit,
  domainsByStratum,
  pagesByDimension,
  errors
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (
  manifest.sites.length !== 60 ||
  targets.length !== 240 ||
  splitCounts.development !== 30 ||
  splitCounts.selection !== 10 ||
  splitCounts.heldOut !== 20 ||
  errors.length > 0
) {
  process.exitCode = 1;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
