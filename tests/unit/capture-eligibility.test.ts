import {
  validateCaptureEligibility,
  type CaptureEligibilityMetadata,
  type EligibleCaptureEntry
} from "../../scripts/capture-eligibility-lib";

describe("capture eligibility", () => {
  it("accepts only the exact machine-and-visual registry source", () => {
    expect(validateCaptureEligibility(page(), eligible())).toEqual([]);
  });

  it("rejects blocked, truncated, obstructed, and irrelevant captures", () => {
    expect(
      validateCaptureEligibility(
        {
          ...page(),
          blocked: true,
          candidateCount: 7,
          observationTruncated: true,
          unresolvedObstructionCoverage: 0.21,
          queryTokenCoverage: 0
        },
        eligible()
      )
    ).toEqual(
      expect.arrayContaining([
        "capture is blocked",
        "capture has fewer than eight candidates",
        "capture observation is truncated",
        "capture exceeds the obstruction gate",
        "capture lacks requested-query evidence"
      ])
    );
  });

  it("rejects a recapture that inherits only the qualified domain", () => {
    const result = validateCaptureEligibility(
      {
        ...page(),
        observationSha256: "c".repeat(64)
      },
      eligible()
    );

    expect(result).toContain(
      "observation hash does not match the eligibility registry"
    );
  });
});

function page(): CaptureEligibilityMetadata {
  return {
    pageId: "shop--coffee",
    siteId: "shop",
    cohort: "training",
    blocked: false,
    candidateCount: 20,
    observationTruncated: false,
    unresolvedObstructionCoverage: 0.01,
    queryTokenCoverage: 1,
    annotationScreenshotCaptured: true,
    observationSha256: "a".repeat(64),
    annotationScreenshotSha256: "b".repeat(64)
  };
}

function eligible(): EligibleCaptureEntry {
  return {
    siteId: "shop",
    cohort: "training",
    pageId: "shop--coffee",
    observationSha256: "a".repeat(64),
    annotationScreenshotSha256: "b".repeat(64)
  };
}
