import type { CorpusAnnotation } from "../../scripts/live-corpus-lib";
import {
  compareCohortToTarget,
  compareDevelopmentChallenges,
  compareDistributionToTargets,
  compareReviewQualityToTargets,
  emptyIdealCohortActual,
  evidenceMode,
  isPointerReadyAnnotationProduct,
  resolveIdealCohort,
  validateIdealDatasetTargets,
  validateIdealDomainSplits,
  type IdealDomainSplits,
  type IdealDatasetTargets
} from "../../scripts/ideal-dataset-lib";
import targetsJson from "../../benchmarks/ideal-dataset-targets.json";
import domainSplitsJson from "../../benchmarks/ideal-domain-splits.json";

const targets = targetsJson as IdealDatasetTargets;

describe("ideal dataset policy", () => {
  it("keeps the checked-in targets internally consistent", () => {
    expect(validateIdealDatasetTargets(targets)).toEqual([]);
  });

  it("keeps active and retired domains disjoint with a possible final cohort", () => {
    const splits = domainSplitsJson as IdealDomainSplits;

    expect(validateIdealDomainSplits(splits)).toEqual([]);
    expect(resolveIdealCohort("walmart", splits)).toBe("training");
    expect(resolveIdealCohort("petsmart", splits)).toBe("validation");
    expect(resolveIdealCohort("instacart", splits)).toBe("selection");
    expect(resolveIdealCohort("bjs", splits)).toBe("retired");
    expect(resolveIdealCohort("future-final-site", {
      ...splits,
      final: ["future-final-site"]
    })).toBe("final");
  });

  it("rejects a domain assigned to more than one ideal cohort", () => {
    const splits = domainSplitsJson as IdealDomainSplits;
    expect(
      validateIdealDomainSplits({
        ...splits,
        final: ["walmart"]
      })
    ).toContain("walmart appears in both training and final");
  });

  it("requires enough final comparable products for the accepted-output claim", () => {
    const invalid: IdealDatasetTargets = {
      ...targets,
      cohorts: {
        ...targets.cohorts,
        final: { ...targets.cohorts.final, minimumComparable: 3000 }
      }
    };

    expect(validateIdealDatasetTargets(invalid)).toContain(
      "final comparable target cannot produce the required accepted outputs"
    );
  });

  it("recognizes only evidence-complete comparable products as pointer ready", () => {
    const complete = product();
    expect(isPointerReadyAnnotationProduct(complete)).toBe(true);
    expect(evidenceMode(complete)).toBe("native-and-derived");
    expect(
      isPointerReadyAnnotationProduct({
        ...complete,
        fieldEvidence: { title: ["title"], currentPrice: ["price"] }
      })
    ).toBe(false);
  });

  it("reports unmet cohort counts and quality rates", () => {
    const actual = emptyIdealCohortActual();
    actual.domains.add("one");
    actual.pages = 10;
    actual.products = 100;
    actual.comparable = 70;
    actual.abstentions = 30;
    actual.dualReviewedPages = 5;
    actual.pointerReadyProducts = 60;

    expect(compareCohortToTarget(actual, targets.cohorts.training)).toEqual(
      expect.arrayContaining([
        { metric: "domains", actual: 1, target: 80 },
        { metric: "dualReviewRate", actual: 0.5, target: 1 },
        { metric: "pointerReadyRate", actual: 0.6, target: 1 }
      ])
    );
  });

  it("reports missing dimension, evidence-mode, viewport, and challenge slices", () => {
    const training = emptyIdealCohortActual();
    const validation = emptyIdealCohortActual();
    training.pages = 10;
    training.comparable = 10;
    training.dimensions.mass = 10;
    training.evidenceModes["native-only"] = 10;

    expect(compareDistributionToTargets(training, targets.distribution)).toEqual(
      expect.arrayContaining([
        { metric: "dimensionShare.volume", actual: 0, target: 0.2 },
        { metric: "evidenceModeShare.derived-only", actual: 0, target: 0.35 },
        { metric: "narrowViewportShare", actual: 0, target: 0.25 }
      ])
    );
    expect(compareDevelopmentChallenges(training, validation, targets.distribution)).toEqual(
      expect.arrayContaining([
        { metric: "productChallenge.multipack", actual: 0, target: 800 },
        { metric: "pageChallenge.redirect", actual: 0, target: 100 },
        { metric: "temporalDomains", actual: 0, target: 20 }
      ])
    );
  });

  it("enforces reviewer agreement and concentration limits", () => {
    const actual = emptyIdealCohortActual();
    actual.products = 100;
    actual.productCountsByDomain.shop = 10;
    actual.productCountsByPage.page = 3;
    actual.reviewAgreement = {
      alignedCards: 100,
      priceMatches: 99,
      quantityMatches: 98,
      dimensionMatches: 99,
      pointerMatches: 95,
      bothComparable: 60,
      reviewerAOnly: 1,
      reviewerBOnly: 1,
      bothAbstain: 38
    };

    expect(compareDistributionToTargets(actual, targets.distribution)).toEqual(
      expect.arrayContaining([
        {
          metric: "maximumDomainProductShare",
          actual: 0.1,
          target: 0.05
        },
        {
          metric: "maximumPageProductShare",
          actual: 0.03,
          target: 0.02
        }
      ])
    );
    expect(compareReviewQualityToTargets(actual, targets.quality)).toEqual([]);

    actual.reviewAgreement.pointerMatches = 94;
    expect(compareReviewQualityToTargets(actual, targets.quality)).toContainEqual({
      metric: "exactPointerAgreement",
      actual: 0.94,
      target: 0.95
    });
  });
});

function product(): CorpusAnnotation["products"][number] {
  return {
    nodeId: "card",
    scope: "primary-results",
    comparable: true,
    title: "Coffee, 2 x 12 oz",
    evidenceNodeIds: ["title", "price", "native", "quantity"],
    fieldEvidence: {
      title: ["title"],
      currentPrice: ["price"],
      nativeUnitPrice: ["native"],
      packageQuantity: ["quantity"]
    },
    currentPriceCents: 1200,
    nativeUnitPrice: { centsPerUnit: 50, unit: "oz", dimension: "mass" },
    packageQuantity: {
      valuePerPackage: 12,
      packCount: 2,
      unit: "oz",
      dimension: "mass"
    },
    expectedNormalized: { centsPerUnit: 800, unit: "lb", dimension: "mass" }
  };
}
