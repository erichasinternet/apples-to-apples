import type { EligibleCaptureEntry } from "./capture-eligibility-lib";

export interface RegistrableCaptureEntry extends EligibleCaptureEntry {
  qualificationReport: string;
  pilotReport: string;
  machineValidation: "passed";
  visualValidation: "passed";
}

export interface CaptureReplacementSpec {
  pageId: string;
  priorObservationSha256: string;
  reason: string;
}

export interface RetiredCaptureEntry extends RegistrableCaptureEntry {
  retiredAt: string;
  reason: string;
  replacementPilotReport: string;
}

export interface CampaignCaptureEvidence {
  siteId: string;
  pageId: string;
  captureTimestamp: string;
  observationSha256: string;
  annotationScreenshotSha256: string;
}

export function prepareCaptureReplacements(input: {
  captures: readonly RegistrableCaptureEntry[];
  retiredCaptures: readonly RetiredCaptureEntry[];
  replacements: readonly CaptureReplacementSpec[];
  replacementPilotReport: string;
  retiredAt: string;
}): {
  retainedCaptures: RegistrableCaptureEntry[];
  retiredCaptures: RetiredCaptureEntry[];
  replacementPageIds: Set<string>;
} {
  const retainedCaptures = input.captures.filter(
    (capture) => capture.pilotReport !== input.replacementPilotReport
  );
  const retiredCaptures = [...input.retiredCaptures];
  const replacementPageIds = new Set<string>();

  for (const replacement of input.replacements) {
    if (
      !replacement.pageId.trim() ||
      !/^[a-f0-9]{64}$/.test(replacement.priorObservationSha256) ||
      !replacement.reason.trim()
    ) {
      throw new Error("Capture replacement is invalid.");
    }
    if (replacementPageIds.has(replacement.pageId)) {
      throw new Error(`Repeated capture replacement: ${replacement.pageId}`);
    }
    replacementPageIds.add(replacement.pageId);

    const eligibleIndex = retainedCaptures.findIndex(
      (capture) =>
        capture.pageId === replacement.pageId &&
        capture.observationSha256 === replacement.priorObservationSha256
    );
    const alreadyRetired = retiredCaptures.find(
      (capture) =>
        capture.pageId === replacement.pageId &&
        capture.observationSha256 === replacement.priorObservationSha256 &&
        capture.replacementPilotReport === input.replacementPilotReport
    );
    if (eligibleIndex < 0 && !alreadyRetired) {
      throw new Error(
        `${replacement.pageId}: prior capture is not exact eligible evidence`
      );
    }
    if (eligibleIndex >= 0) {
      const [capture] = retainedCaptures.splice(eligibleIndex, 1);
      retiredCaptures.push({
        ...capture!,
        retiredAt: input.retiredAt,
        reason: replacement.reason,
        replacementPilotReport: input.replacementPilotReport
      });
    }
    const conflictingCapture = retainedCaptures.find(
      (capture) => capture.pageId === replacement.pageId
    );
    if (conflictingCapture) {
      throw new Error(
        `${replacement.pageId}: another eligible capture would remain active`
      );
    }
  }

  return { retainedCaptures, retiredCaptures, replacementPageIds };
}

export function matchesCampaignCaptureEvidence(
  capture: EligibleCaptureEntry,
  evidence: CampaignCaptureEvidence,
  cohort: EligibleCaptureEntry["cohort"]
): boolean {
  return (
    capture.siteId === evidence.siteId &&
    capture.cohort === cohort &&
    capture.pageId === evidence.pageId &&
    capture.captureTimestamp === evidence.captureTimestamp &&
    capture.observationSha256 === evidence.observationSha256 &&
    capture.annotationScreenshotSha256 ===
      evidence.annotationScreenshotSha256
  );
}
