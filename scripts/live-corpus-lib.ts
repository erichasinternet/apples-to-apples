import type { Dimension } from "../src/core/types";
import type { ModelAbstentionReason, ObservationBounds } from "../src/learning/contracts";

export const LIVE_CORPUS_VERSION = 1;
export const MINIMUM_QUERY_TOKEN_COVERAGE = 1;

export interface CorpusQuery {
  id: string;
  query: string;
  querySlug?: string;
  dimension: Dimension;
}

export interface CorpusSite {
  id: string;
  label: string;
  hostname: string;
  stratum: string;
  searchUrlTemplate: string;
  querySet?: string;
  queries?: CorpusQuery[];
}

export interface CorpusTargetManifest {
  version: number;
  description: string;
  querySets?: Record<string, CorpusQuery[]>;
  sites: CorpusSite[];
}

export interface CorpusDomainSplits {
  version: number;
  seed: number;
  development: string[];
  selection: string[];
  heldOut: string[];
}

export interface CaptureTarget extends CorpusQuery {
  pageId: string;
  siteId: string;
  siteLabel: string;
  hostname: string;
  stratum: string;
  url: string;
}

export type CaptureViewportProfile = "desktop" | "narrow";

export interface CaptureViewportAssignment {
  profile: CaptureViewportProfile;
  width: number;
  height: number;
}

export const CAPTURE_VIEWPORTS: Record<
  CaptureViewportProfile,
  CaptureViewportAssignment
> = {
  desktop: { profile: "desktop", width: 1440, height: 1000 },
  narrow: { profile: "narrow", width: 390, height: 844 }
};

const QUERY_STOP_WORDS = new Set(["all", "and", "for", "of", "purpose", "the", "with"]);

export function calculateQueryTokenCoverage(
  query: string,
  evidence: string
): number {
  const queryTokens = normalizedTokens(query).filter(
    (token) => !QUERY_STOP_WORDS.has(token)
  );
  if (queryTokens.length === 0) return 1;
  const evidenceTokens = new Set(normalizedTokens(evidence));
  const matched = queryTokens.filter((token) => evidenceTokens.has(token)).length;
  return matched / queryTokens.length;
}

export interface SearchResultContext {
  title: string;
  pathname: string;
  headings: string[];
  statusText: string[];
  searchValues: string[];
}

export function calculateSearchResultQueryCoverage(
  query: string,
  context: SearchResultContext
): number {
  return calculateQueryTokenCoverage(
    query,
    [
      context.title,
      context.pathname,
      ...context.headings,
      ...context.statusText
    ].join("\n")
  );
}

export function isInterstitialOrBotChallenge(text: string): boolean {
  return /\b(access (?:to (?:this|the) page (?:has been )?)?denied|verification required|verify you are human|captcha|robot check|robot or human|unusual traffic|activate and hold|secure your access)\b/i.test(
    text
  );
}

export function isSameSiteHostname(expected: string, actual: string): boolean {
  const normalize = (hostname: string): string =>
    hostname.trim().toLowerCase().replace(/\.$/, "");
  const expectedHostname = normalize(expected);
  const actualHostname = normalize(actual);
  return (
    expectedHostname === actualHostname ||
    expectedHostname.endsWith(`.${actualHostname}`) ||
    actualHostname.endsWith(`.${expectedHostname}`)
  );
}

export interface CorpusAnnotation {
  version: number;
  pageId: string;
  reviewStatus: "unreviewed" | "in-review" | "adjudicated";
  coverage?: "unreviewed" | "sampled" | "complete-main-region";
  region?: ObservationBounds;
  annotators: string[];
  reviewProvenance?: {
    independentReviewIds: [string, string];
    adjudicationReviewId: string;
    agreement: {
      alignedCards: number;
      comparableKappa: number | null;
      exactPriceAgreement: number;
      exactQuantityAgreement: number;
      exactDimensionAgreement: number;
      exactPointerAgreement: number;
      matches: {
        price: number;
        quantity: number;
        dimension: number;
        pointer: number;
      };
      comparableConfusion: {
        bothComparable: number;
        reviewerAOnly: number;
        reviewerBOnly: number;
        bothAbstain: number;
      };
    };
  };
  pageTags?: DatasetPageTag[];
  products: AnnotatedProduct[];
}

export type DatasetPageTag =
  | "redirect"
  | "empty-results"
  | "loading-shell"
  | "virtualized-list"
  | "lazy-loaded";

export type DatasetProductChallengeTag =
  | "multipack"
  | "split-price"
  | "sale-vs-list"
  | "native-derived-conflict"
  | "decimal-quantity"
  | "conditional-price"
  | "price-range"
  | "unselected-variant"
  | "sponsored-or-recommendation"
  | "unsupported-currency";

export interface AnnotatedProduct {
  nodeId: string;
  scope: "primary-results" | "secondary-recommendation" | "unknown";
  comparable: boolean;
  challengeTags?: DatasetProductChallengeTag[];
  title: string;
  evidenceNodeIds: string[];
  fieldEvidence?: {
    title: string[];
    currentPrice?: string[];
    nativeUnitPrice?: string[];
    packageQuantity?: string[];
  };
  currentPriceCents?: number;
  nativeUnitPrice?: {
    centsPerUnit: number;
    unit: string;
    dimension?: Dimension;
  };
  packageQuantity?: {
    valuePerPackage: number;
    packCount: number;
    unit: string;
    dimension: Dimension;
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
  abstainReason?: ModelAbstentionReason;
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
    if (
      !site.searchUrlTemplate.includes("{query}") &&
      !site.searchUrlTemplate.includes("{querySlug}")
    ) {
      throw new Error(`${site.id} searchUrlTemplate must contain {query} or {querySlug}`);
    }

    const queries = resolveSiteQueries(manifest, site);
    for (const query of queries) {
      const pageId = `${slugify(site.id)}--${slugify(query.id)}`;
      if (pageIds.has(pageId)) {
        throw new Error(`Duplicate page id: ${pageId}`);
      }

      const querySlug = query.querySlug ?? slugify(query.query);
      const url = site.searchUrlTemplate
        .replaceAll("{query}", encodeURIComponent(query.query))
        .replaceAll("{querySlug}", querySlug);
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== site.hostname) {
        throw new Error(`${pageId} expands to an invalid or cross-site URL`);
      }

      pageIds.add(pageId);
      targets.push({
        ...query,
        pageId,
        siteId: site.id,
        siteLabel: site.label,
        hostname: site.hostname,
        stratum: site.stratum,
        url
      });
    }
  }

  return targets;
}

export function annotationScreenshotDimensionsMatch(
  dimensions: { width: number; height: number },
  region: { width: number; height: number }
): boolean {
  // Locator screenshots rasterize fractional CSS bounds from floor(start) to ceil(end).
  const rasterizationEnvelope = 2;
  return (
    Math.abs(dimensions.width - region.width) <= rasterizationEnvelope &&
    Math.abs(dimensions.height - region.height) <= rasterizationEnvelope
  );
}

export function validateDomainSplits(
  manifest: CorpusTargetManifest,
  splits: CorpusDomainSplits
): string[] {
  const errors: string[] = [];
  if (splits.version !== LIVE_CORPUS_VERSION) {
    errors.push(`Unsupported split version: ${splits.version}`);
  }

  const manifestIds = new Set(manifest.sites.map((site) => site.id));
  const assignments = [
    ...splits.development.map((siteId) => ({ siteId, split: "development" })),
    ...splits.selection.map((siteId) => ({ siteId, split: "selection" })),
    ...splits.heldOut.map((siteId) => ({ siteId, split: "heldOut" }))
  ];
  const seen = new Map<string, string>();

  for (const assignment of assignments) {
    if (!manifestIds.has(assignment.siteId)) {
      errors.push(`${assignment.split}: unknown site ${assignment.siteId}`);
    }
    const prior = seen.get(assignment.siteId);
    if (prior) {
      errors.push(`${assignment.siteId} appears in both ${prior} and ${assignment.split}`);
    } else {
      seen.set(assignment.siteId, assignment.split);
    }
  }

  for (const siteId of manifestIds) {
    if (!seen.has(siteId)) {
      errors.push(`Unassigned site: ${siteId}`);
    }
  }
  if (seen.size !== manifestIds.size) {
    errors.push(`Expected ${manifestIds.size} unique assignments, found ${seen.size}`);
  }

  return errors;
}

export function getDomainSplit(
  siteId: string,
  splits: CorpusDomainSplits
): "development" | "selection" | "heldOut" | undefined {
  if (splits.development.includes(siteId)) return "development";
  if (splits.selection.includes(siteId)) return "selection";
  if (splits.heldOut.includes(siteId)) return "heldOut";
  return undefined;
}

export function selectTargets(
  targets: readonly CaptureTarget[],
  options: {
    limit?: number;
    perSite?: number;
    siteIds?: readonly string[];
    pageIds?: readonly string[];
    seed: number;
  }
): CaptureTarget[] {
  const siteIds = new Set(options.siteIds ?? []);
  const pageIds = new Set(options.pageIds ?? []);
  const filtered = targets.filter(
    (target) =>
      (siteIds.size === 0 || siteIds.has(target.siteId)) &&
      (pageIds.size === 0 || pageIds.has(target.pageId))
  );
  const balanced =
    options.perSite === undefined
      ? filtered
      : [...groupBySite(filtered).values()].flatMap((siteTargets, index) =>
          deterministicShuffle(siteTargets, options.seed + index).slice(0, options.perSite)
        );
  const shuffled = deterministicShuffle(balanced, options.seed);
  return options.limit === undefined ? shuffled : shuffled.slice(0, options.limit);
}

export function assignCaptureViewports(
  targets: readonly CaptureTarget[],
  options: {
    seed: number;
    mode: CaptureViewportProfile | "mixed";
    narrowShare?: number;
  }
): Map<string, CaptureViewportAssignment> {
  const narrowShare = options.narrowShare ?? 0.25;
  if (!(narrowShare >= 0 && narrowShare <= 1)) {
    throw new Error("narrowShare must be between 0 and 1.");
  }

  const narrowPageIds =
    options.mode === "mixed"
      ? new Set(
          deterministicShuffle(
            targets.map((target) => target.pageId),
            options.seed
          ).slice(0, Math.ceil(targets.length * narrowShare))
        )
      : undefined;

  return new Map(
    targets.map((target) => {
      const profile =
        options.mode === "mixed"
          ? narrowPageIds!.has(target.pageId)
            ? "narrow"
            : "desktop"
          : options.mode;
      return [target.pageId, CAPTURE_VIEWPORTS[profile]];
    })
  );
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

function normalizedTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map((token) => {
      if (token.length > 4 && token.endsWith("ies")) {
        return `${token.slice(0, -3)}y`;
      }
      if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
        return token.slice(0, -1);
      }
      return token;
    });
}

function resolveSiteQueries(manifest: CorpusTargetManifest, site: CorpusSite): CorpusQuery[] {
  if (site.queries && site.querySet) {
    throw new Error(`${site.id} must define either queries or querySet, not both`);
  }
  if (site.queries) {
    return site.queries;
  }
  if (!site.querySet) {
    throw new Error(`${site.id} must define queries or querySet`);
  }

  const queries = manifest.querySets?.[site.querySet];
  if (!queries) {
    throw new Error(`${site.id} references unknown querySet ${site.querySet}`);
  }
  return queries;
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
