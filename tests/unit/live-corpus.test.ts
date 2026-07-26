import domainSplits from "../../benchmarks/live-sites/domain-splits.json";
import targetManifest from "../../benchmarks/live-sites/targets.json";
import {
  CAPTURE_VIEWPORTS,
  annotationScreenshotDimensionsMatch,
  assignCaptureViewports,
  calculateQueryTokenCoverage,
  calculateSearchResultQueryCoverage,
  MINIMUM_QUERY_TOKEN_COVERAGE,
  calculateWorstCaseSampleSize,
  expandTargets,
  getDomainSplit,
  isInterstitialOrBotChallenge,
  isSameSiteHostname,
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

  it("can select exact page ids for reproducible qualification follow-ups", () => {
    const targets = expandTargets(targetManifest as CorpusTargetManifest);
    const requested = [
      targets[3]!.pageId,
      targets[17]!.pageId,
      targets[29]!.pageId
    ];
    const sample = selectTargets(targets, {
      seed: 42,
      pageIds: requested
    });

    expect(sample).toHaveLength(requested.length);
    expect(new Set(sample.map((target) => target.pageId))).toEqual(
      new Set(requested)
    );
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

  it("does not treat incidental product-card text as search-query evidence", () => {
    expect(
      calculateSearchResultQueryCoverage("vitamins", {
        title: "Search",
        pathname: "/search",
        headings: ["Search"],
        statusText: ["15352 products"],
        searchValues: []
      })
    ).toBe(0);
    expect(
      calculateSearchResultQueryCoverage("vitamins", {
        title: "Search",
        pathname: "/search",
        headings: ['1002 results for "vitamins"'],
        statusText: [],
        searchValues: ["vitamins"]
      })
    ).toBe(1);
    expect(
      calculateSearchResultQueryCoverage("brown rice", {
        title: "Search",
        pathname: "/search/",
        headings: ["Search"],
        statusText: ["Showing 1 to 18 of 57 Results for 'brown rice'"],
        searchValues: []
      })
    ).toBe(1);
  });

  it("requires every meaningful query token outside the populated search box", () => {
    const coverage = calculateSearchResultQueryCoverage("upholstery fabric", {
      title: "Designer Fabrics",
      pathname: "/",
      headings: ["Sale", "New Arrivals"],
      statusText: [],
      searchValues: ["upholstery fabric"]
    });

    expect(coverage).toBe(0.5);
    expect(coverage).toBeLessThan(MINIMUM_QUERY_TOKEN_COVERAGE);
  });

  it("recognizes generic verification and slider challenges", () => {
    expect(
      isInterstitialOrBotChallenge(
        "Verification Required. Slide right to secure your access."
      )
    ).toBe(true);
    expect(
      isInterstitialOrBotChallenge(
        "Verify you are human before continuing through this robot check."
      )
    ).toBe(true);
    expect(
      isInterstitialOrBotChallenge(
        "Verify your delivery address and securely access order history."
      )
    ).toBe(false);
  });

  it("allows subdomain redirects but rejects unrelated destinations", () => {
    expect(isSameSiteHostname("www.shop.example", "shop.example")).toBe(true);
    expect(isSameSiteHostname("shop.example", "checkout.shop.example")).toBe(true);
    expect(isSameSiteHostname("www.cleanfreak.com", "www.google.com")).toBe(false);
    expect(isSameSiteHostname("shop.example", "evilshop.example.com")).toBe(false);
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

  it("honors explicit route slugs without rewriting valid site paths", () => {
    const manifest: CorpusTargetManifest = {
      version: 1,
      description: "test",
      sites: [
        {
          id: "shop",
          label: "Shop",
          hostname: "shop.example",
          stratum: "fabric",
          searchUrlTemplate: "https://shop.example/{querySlug}",
          queries: [
            {
              id: "cotton",
              query: "cotton fabric",
              querySlug: "products/Cotton-Fabric_c_42.html?page=1",
              dimension: "length"
            }
          ]
        }
      ]
    };

    expect(expandTargets(manifest)[0]?.url).toBe(
      "https://shop.example/products/Cotton-Fabric_c_42.html?page=1"
    );
  });

  it("accepts browser rasterization around fractional annotation bounds", () => {
    expect(
      annotationScreenshotDimensionsMatch(
        { width: 1280, height: 1839 },
        { width: 1280, height: 1837.39 }
      )
    ).toBe(true);
    expect(
      annotationScreenshotDimensionsMatch(
        { width: 1280, height: 1840 },
        { width: 1280, height: 1837.39 }
      )
    ).toBe(false);
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
