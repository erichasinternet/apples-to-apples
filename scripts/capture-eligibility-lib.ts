import type { IdealCohortName } from "./ideal-dataset-lib";
import { MINIMUM_QUERY_TOKEN_COVERAGE } from "./live-corpus-lib";

export interface EligibleCaptureEntry {
  siteId: string;
  cohort: IdealCohortName;
  pageId: string;
  captureTimestamp: string;
  observationSha256: string;
  annotationScreenshotSha256: string;
}

export interface CaptureEligibilityMetadata {
  pageId: string;
  siteId: string;
  cohort: IdealCohortName;
  capturedAt: string;
  blocked: boolean;
  candidateCount: number;
  observationTruncated: boolean;
  unresolvedObstructionCoverage: number;
  queryTokenCoverage?: number;
  annotationScreenshotCaptured: boolean;
  observationSha256?: string;
  annotationScreenshotSha256?: string;
}

export function validateCaptureEligibility(
  page: CaptureEligibilityMetadata,
  eligible: EligibleCaptureEntry | undefined
): string[] {
  const errors: string[] = [];
  if (page.blocked) errors.push("capture is blocked");
  if (page.candidateCount < 8) errors.push("capture has fewer than eight candidates");
  if (page.observationTruncated) errors.push("capture observation is truncated");
  if (page.unresolvedObstructionCoverage > 0.2) {
    errors.push("capture exceeds the obstruction gate");
  }
  if (
    page.queryTokenCoverage !== undefined &&
    page.queryTokenCoverage < MINIMUM_QUERY_TOKEN_COVERAGE
  ) {
    errors.push("capture lacks requested-query evidence");
  }
  if (!page.annotationScreenshotCaptured) {
    errors.push("capture lacks an annotation screenshot");
  }
  if (!eligible) {
    errors.push("capture hash is absent from the eligibility registry");
    return errors;
  }
  if (
    eligible.pageId !== page.pageId ||
    eligible.siteId !== page.siteId ||
    eligible.cohort !== page.cohort
  ) {
    errors.push("capture identity does not match the eligibility registry");
  }
  if (eligible.captureTimestamp !== page.capturedAt) {
    errors.push("capture timestamp does not match the eligibility registry");
  }
  if (
    !page.observationSha256 ||
    eligible.observationSha256 !== page.observationSha256
  ) {
    errors.push("observation hash does not match the eligibility registry");
  }
  if (
    !page.annotationScreenshotSha256 ||
    eligible.annotationScreenshotSha256 !==
      page.annotationScreenshotSha256
  ) {
    errors.push("screenshot hash does not match the eligibility registry");
  }
  return errors;
}
