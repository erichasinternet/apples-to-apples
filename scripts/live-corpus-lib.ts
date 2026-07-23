import type { Dimension } from "../src/core/types";

export const LIVE_CORPUS_VERSION = 1;

export interface CorpusQuery {
  id: string;
  query: string;
  dimension: Dimension;
}

export interface CorpusSite {
  id: string;
  label: string;
  hostname: string;
  stratum: string;
  searchUrlTemplate: string;
  queries: CorpusQuery[];
}

export interface CorpusTargetManifest {
  version: number;
  description: string;
  sites: CorpusSite[];
}

export interface CaptureTarget extends CorpusQuery {
  pageId: string;
  siteId: string;
  siteLabel: string;
  hostname: string;
  stratum: string;
  url: string;
}

export interface CorpusAnnotation {
  version: number;
  pageId: string;
  reviewStatus: "unreviewed" | "in-review" | "adjudicated";
  annotators: string[];
  products: AnnotatedProduct[];
}

export interface AnnotatedProduct {
  nodeId: string;
  scope: "primary-results" | "secondary-recommendation" | "unknown";
  comparable: boolean;
  title: string;
  evidenceNodeIds: string[];
  currentPriceCents?: number;
  nativeUnitPrice?: {
    centsPerUnit: number;
    unit: string;
  };
  totalQuantity?: {
    value: number;
    unit: string;
    dimension: Dimension;
  };
  expectedNormalized?: {
    centsPerUnit: number;
    unit: string;
    dimension: Dimension;
  };
  exclusionReason?: string;
  notes?: string;
}

export function expandTargets(manifest: CorpusTargetManifest): CaptureTarget[] {
  if (manifest.version !== LIVE_CORPUS_VERSION) {
    throw new Error(`Unsupported target manifest version: ${manifest.version}`);
  }

  const pageIds = new Set<string>();
  const targets: CaptureTarget[] = [];

  for (const site of manifest.sites) {
    if (!site.searchUrlTemplate.includes("{query}")) {
      throw new Error(`${site.id} searchUrlTemplate must contain {query}`);
    }

    for (const query of site.queries) {
      const pageId = `${slugify(site.id)}--${slugify(query.id)}`;
      if (pageIds.has(pageId)) {
        throw new Error(`Duplicate page id: ${pageId}`);
      }

      pageIds.add(pageId);
      targets.push({
        ...query,
        pageId,
        siteId: site.id,
        siteLabel: site.label,
        hostname: site.hostname,
        stratum: site.stratum,
        url: site.searchUrlTemplate.replace("{query}", encodeURIComponent(query.query))
      });
    }
  }

  return targets;
}

export function selectTargets(
  targets: readonly CaptureTarget[],
  options: { limit?: number; perSite?: number; siteIds?: readonly string[]; seed: number }
): CaptureTarget[] {
  const siteIds = new Set(options.siteIds ?? []);
  const filtered = siteIds.size > 0 ? targets.filter((target) => siteIds.has(target.siteId)) : [...targets];
  const balanced =
    options.perSite === undefined
      ? filtered
      : [...groupBySite(filtered).values()].flatMap((siteTargets, index) =>
          deterministicShuffle(siteTargets, options.seed + index).slice(0, options.perSite)
        );
  const shuffled = deterministicShuffle(balanced, options.seed);
  return options.limit === undefined ? shuffled : shuffled.slice(0, options.limit);
}

export function calculateWorstCaseSampleSize(margin: number, confidenceZ = 1.96, designEffect = 1): number {
  if (!(margin > 0 && margin < 1) || confidenceZ <= 0 || designEffect < 1) {
    throw new Error("Invalid sample-size inputs.");
  }

  return Math.ceil(((confidenceZ * confidenceZ * 0.25) / (margin * margin)) * designEffect);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function groupBySite(targets: readonly CaptureTarget[]): Map<string, CaptureTarget[]> {
  const grouped = new Map<string, CaptureTarget[]>();
  for (const target of targets) {
    const siteTargets = grouped.get(target.siteId) ?? [];
    siteTargets.push(target);
    grouped.set(target.siteId, siteTargets);
  }
  return grouped;
}

function deterministicShuffle<T>(values: readonly T[], seed: number): T[] {
  const shuffled = [...values];
  let state = seed >>> 0;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const selected = state % (index + 1);
    [shuffled[index], shuffled[selected]] = [shuffled[selected]!, shuffled[index]!];
  }

  return shuffled;
}
