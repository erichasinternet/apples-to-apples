import targetManifest from "../../benchmarks/live-sites/targets.json";
import {
  calculateWorstCaseSampleSize,
  expandTargets,
  selectTargets,
  slugify,
  type CorpusTargetManifest
} from "../../scripts/live-corpus-lib";

describe("live benchmark corpus", () => {
  it("expands every site query into a unique reproducible target", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest);

    expect(targets).toHaveLength(targetManifest.sites.reduce((sum, site) => sum + site.queries.length, 0));
    expect(new Set(targets.map((target) => target.pageId)).size).toBe(targets.length);
    expect(targets.every((target) => target.url.startsWith("https://"))).toBe(true);
  });

  it("selects the same sample for the same seed", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest);
    const first = selectTargets(targets, { seed: 42, limit: 8 });
    const second = selectTargets(targets, { seed: 42, limit: 8 });

    expect(second.map((target) => target.pageId)).toEqual(first.map((target) => target.pageId));
  });

  it("can balance a pilot across domains", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest);
    const sample = selectTargets(targets, {
      seed: 42,
      perSite: 1,
      siteIds: ["walmart", "amazon", "target", "chewy"]
    });

    expect(sample).toHaveLength(4);
    expect(new Set(sample.map((target) => target.siteId)).size).toBe(4);
  });

  it("accounts for clustered observations in the sample target", () => {
    expect(calculateWorstCaseSampleSize(0.026, 1.96, 2)).toBeGreaterThan(2_800);
  });

  it("creates filesystem-safe identifiers", () => {
    expect(slugify("Lowe's / Paper Towels")).toBe("lowe-s-paper-towels");
  });
});
