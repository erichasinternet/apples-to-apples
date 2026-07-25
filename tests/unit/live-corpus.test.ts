import domainSplits from "../../benchmarks/live-sites/domain-splits.json";
import targetManifest from "../../benchmarks/live-sites/targets.json";
import {
  CAPTURE_VIEWPORTS,
  assignCaptureViewports,
  calculateQueryTokenCoverage,
  calculateWorstCaseSampleSize,
  expandTargets,
  getDomainSplit,
  selectTargets,
  slugify,
  validateDomainSplits,
  type CorpusDomainSplits,
  type CorpusTargetManifest
} from "../../scripts/live-corpus-lib";

describe("live benchmark corpus", () => {
  it("expands every site query into a unique reproducible target", () => {
    const manifest = targetManifest as CorpusTargetManifest;
    const targets = expandTargets(manifest);
    const expectedPages = manifest.sites.reduce(
      (sum, site) =>
        sum +
        (site.queries?.length ?? manifest.querySets?.[site.querySet ?? ""]?.length ?? 0),
      0
    );

    expect(targets).toHaveLength(expectedPages);
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

  it("assigns an exact deterministic narrow viewport share", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest).slice(0, 10);
    const first = assignCaptureViewports(targets, {
      seed: 42,
      mode: "mixed",
      narrowShare: 0.25
    });
    const second = assignCaptureViewports(targets, {
      seed: 42,
      mode: "mixed",
      narrowShare: 0.25
    });

    expect([...first.values()].filter(({ profile }) => profile === "narrow")).toHaveLength(3);
    expect([...second.entries()]).toEqual([...first.entries()]);
    expect(first.get(targets[0]!.pageId)).toEqual(
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) })
    );
  });

  it("supports controlled all-desktop and all-narrow captures", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest).slice(0, 4);

    expect(
      [...assignCaptureViewports(targets, { seed: 1, mode: "desktop" }).values()]
    ).toEqual(Array(4).fill(CAPTURE_VIEWPORTS.desktop));
    expect(
      [...assignCaptureViewports(targets, { seed: 1, mode: "narrow" }).values()]
    ).toEqual(Array(4).fill(CAPTURE_VIEWPORTS.narrow));
  });

  it("requires generic query evidence after a search redirect", () => {
    expect(
      calculateQueryTokenCoverage(
        "protein powder",
        "Search results for protein powder and supplements"
      )
    ).toBe(1);
    expect(
      calculateQueryTokenCoverage(
        "all purpose cleaner",
        "Industrial cleaners and degreasers"
      )
    ).toBe(1);
    expect(
      calculateQueryTokenCoverage("mouthwash", "All vitamins and supplements")
    ).toBe(0);
  });

  it("accounts for clustered observations in the sample target", () => {
    expect(calculateWorstCaseSampleSize(0.026, 1.96, 2)).toBeGreaterThan(2_800);
  });

  it("creates filesystem-safe identifiers", () => {
    expect(slugify("Lowe's / Paper Towels")).toBe("lowe-s-paper-towels");
  });

  it("resolves shared query sets without changing unique page ids", () => {
    const manifest: CorpusTargetManifest = {
      version: 1,
      description: "test",
      querySets: {
        common: [{ id: "rice", query: "rice", dimension: "mass" }]
      },
      sites: [
        {
          id: "shop",
          label: "Shop",
          hostname: "shop.example",
          stratum: "grocery",
          searchUrlTemplate: "https://shop.example/search?q={query}",
          querySet: "common"
        }
      ]
    };

    expect(expandTargets(manifest)).toEqual([
      expect.objectContaining({ pageId: "shop--rice", dimension: "mass" })
    ]);
  });

  it("supports slugged search routes without hostname-specific logic", () => {
    const manifest: CorpusTargetManifest = {
      version: 1,
      description: "test",
      sites: [
        {
          id: "shop",
          label: "Shop",
          hostname: "shop.example",
          stratum: "office",
          searchUrlTemplate: "https://shop.example/{querySlug}/directory_{querySlug}",
          queries: [{ id: "paper", query: "printer paper", dimension: "count" }]
        }
      ]
    };

    expect(expandTargets(manifest)[0]?.url).toBe(
      "https://shop.example/printer-paper/directory_printer-paper"
    );
  });

  it("validates disjoint domain-level splits", () => {
    const manifest = targetManifest as CorpusTargetManifest;
    const ids = manifest.sites.map((site) => site.id);
    const splits: CorpusDomainSplits = {
      version: 1,
      seed: 42,
      development: ids.slice(0, 5),
      selection: ids.slice(5, 10),
      heldOut: ids.slice(10)
    };

    expect(validateDomainSplits(manifest, splits)).toEqual([]);
    expect(getDomainSplit(ids[0]!, splits)).toBe("development");
    expect(getDomainSplit(ids[7]!, splits)).toBe("selection");
    expect(getDomainSplit(ids[12]!, splits)).toBe("heldOut");
  });

  it("freezes a leakage-safe 30/10/20 split for the complete manifest", () => {
    const manifest = targetManifest as CorpusTargetManifest;
    const splits = domainSplits as CorpusDomainSplits;

    expect(manifest.sites).toHaveLength(60);
    expect(expandTargets(manifest)).toHaveLength(240);
    expect(splits.development).toHaveLength(30);
    expect(splits.selection).toHaveLength(10);
    expect(splits.heldOut).toHaveLength(20);
    expect(validateDomainSplits(manifest, splits)).toEqual([]);
    expect(splits.heldOut).not.toContain("walmart");
    expect(splits.heldOut).not.toContain("amazon");
    expect(splits.heldOut).not.toContain("target");
  });
});
