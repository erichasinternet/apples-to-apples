import {
  matchesCampaignCaptureEvidence,
  prepareCaptureReplacements,
  type RegistrableCaptureEntry
} from "../../scripts/capture-retirement-lib";

describe("capture retirement", () => {
  it("moves exact superseded evidence out of the active registry", () => {
    const oldCapture = capture("a", "old-pilot.json");
    const result = prepareCaptureReplacements({
      captures: [oldCapture, capture("c", "other-pilot.json", "other-page")],
      retiredCaptures: [],
      replacements: [
        {
          pageId: "shop--query",
          priorObservationSha256: oldCapture.observationSha256,
          reason: "Overlapping candidate roots"
        }
      ],
      replacementPilotReport: "replacement.json",
      retiredAt: "2026-07-27T06:00:00.000Z"
    });

    expect(result.retainedCaptures.map((entry) => entry.pageId)).toEqual([
      "other-page"
    ]);
    expect(result.retiredCaptures).toEqual([
      expect.objectContaining({
        pageId: "shop--query",
        reason: "Overlapping candidate roots",
        replacementPilotReport: "replacement.json"
      })
    ]);
    expect(result.replacementPageIds).toEqual(new Set(["shop--query"]));
  });

  it("rejects replacement without an exact active capture", () => {
    expect(() =>
      prepareCaptureReplacements({
        captures: [capture("a", "old-pilot.json")],
        retiredCaptures: [],
        replacements: [
          {
            pageId: "shop--query",
            priorObservationSha256: "f".repeat(64),
            reason: "Wrong hash"
          }
        ],
        replacementPilotReport: "replacement.json",
        retiredAt: "2026-07-27T06:00:00.000Z"
      })
    ).toThrow("prior capture is not exact eligible evidence");
  });

  it("is idempotent when rerunning the same replacement pilot", () => {
    const oldCapture = capture("a", "old-pilot.json");
    const first = prepareCaptureReplacements({
      captures: [oldCapture],
      retiredCaptures: [],
      replacements: [
        {
          pageId: "shop--query",
          priorObservationSha256: oldCapture.observationSha256,
          reason: "Overlapping candidate roots"
        }
      ],
      replacementPilotReport: "replacement.json",
      retiredAt: "2026-07-27T06:00:00.000Z"
    });
    const second = prepareCaptureReplacements({
      captures: [capture("c", "replacement.json")],
      retiredCaptures: first.retiredCaptures,
      replacements: [
        {
          pageId: "shop--query",
          priorObservationSha256: oldCapture.observationSha256,
          reason: "Overlapping candidate roots"
        }
      ],
      replacementPilotReport: "replacement.json",
      retiredAt: "2026-07-27T06:00:00.000Z"
    });

    expect(second.retainedCaptures).toEqual([]);
    expect(second.retiredCaptures).toHaveLength(1);
  });

  it("matches campaign evidence only by its complete immutable identity", () => {
    const entry = capture("a", "old-pilot.json");
    const evidence = {
      siteId: entry.siteId,
      pageId: entry.pageId,
      captureTimestamp: entry.captureTimestamp,
      observationSha256: entry.observationSha256,
      annotationScreenshotSha256: entry.annotationScreenshotSha256
    };

    expect(matchesCampaignCaptureEvidence(entry, evidence, "training")).toBe(
      true
    );
    expect(
      matchesCampaignCaptureEvidence(
        entry,
        { ...evidence, observationSha256: "f".repeat(64) },
        "training"
      )
    ).toBe(false);
  });
});

function capture(
  observationSeed: string,
  pilotReport: string,
  pageId = "shop--query"
): RegistrableCaptureEntry {
  return {
    siteId: "shop",
    cohort: "training",
    pageId,
    captureTimestamp: "2026-07-26T22:33:55.412Z",
    observationSha256: observationSeed.repeat(64),
    annotationScreenshotSha256: "b".repeat(64),
    qualificationReport: "qualification.json",
    pilotReport,
    machineValidation: "passed",
    visualValidation: "passed"
  };
}
