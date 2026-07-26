import type { PageObservation } from "../src/learning/contracts";
import {
  validateEvidenceAdjudicationQueue,
  type EvidenceAdjudicationQueue,
  type EvidenceAdjudicationQueueItem
} from "./evidence-adjudication-queue-lib";
import type { EvidenceReviewSubmissionInput } from "./evidence-review-campaign-lib";
import {
  compileAdjudicatedCorpusAnnotation,
  type EvidencePointerReview
} from "./evidence-review-lib";
import type { CorpusAnnotation } from "./live-corpus-lib";

export interface CompiledEvidenceAdjudication {
  item: EvidenceAdjudicationQueueItem;
  review: EvidencePointerReview;
  annotation: CorpusAnnotation;
}

export interface EvidenceAdjudicationCampaignResult {
  valid: boolean;
  errors: Array<{
    filename?: string;
    reviewId?: string;
    message: string;
  }>;
  expected: number;
  submitted: number;
  compiled: number;
  missingReviewIds: string[];
  unexpectedReviewIds: string[];
  entries: CompiledEvidenceAdjudication[];
}

export function compileEvidenceAdjudicationCampaign(
  queue: EvidenceAdjudicationQueue,
  submissions: EvidenceReviewSubmissionInput[],
  observations: Map<string, PageObservation>
): EvidenceAdjudicationCampaignResult {
  const errors: EvidenceAdjudicationCampaignResult["errors"] =
    validateEvidenceAdjudicationQueue(queue, observations).map((message) => ({
      message
    }));
  const expectedByReviewId = new Map(
    queue.items.map((item) => [item.reviewTemplate.reviewId, item])
  );
  const seenReviewIds = new Set<string>();
  const compiledReviewIds = new Set<string>();
  const unexpectedReviewIds: string[] = [];
  const entries: CompiledEvidenceAdjudication[] = [];

  for (const submission of submissions) {
    if (!submission.review) {
      errors.push({
        filename: submission.filename,
        message: submission.parseError ?? "submission is not valid JSON"
      });
      continue;
    }
    const review = submission.review;
    const reviewId =
      typeof review.reviewId === "string" ? review.reviewId : undefined;
    if (!reviewId) {
      errors.push({
        filename: submission.filename,
        message: "reviewId is required"
      });
      continue;
    }
    if (seenReviewIds.has(reviewId)) {
      errors.push({
        filename: submission.filename,
        reviewId,
        message: "duplicate reviewId in adjudication directory"
      });
      continue;
    }
    seenReviewIds.add(reviewId);
    const item = expectedByReviewId.get(reviewId);
    if (!item) {
      unexpectedReviewIds.push(reviewId);
      continue;
    }
    const observation = observations.get(item.pageId);
    if (!observation) {
      errors.push({
        filename: submission.filename,
        reviewId,
        message: `missing immutable observation for ${item.pageId}`
      });
      continue;
    }
    if (!matchesTemplate(review, item)) {
      errors.push({
        filename: submission.filename,
        reviewId,
        message: "adjudication identity or source-review contract changed"
      });
      continue;
    }
    try {
      const annotation = compileAdjudicatedCorpusAnnotation(
        review,
        item.sourceReviews[0],
        item.sourceReviews[1],
        observation
      );
      entries.push({ item, review, annotation });
      compiledReviewIds.add(reviewId);
    } catch (error) {
      errors.push({
        filename: submission.filename,
        reviewId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const missingReviewIds = [...expectedByReviewId.keys()]
    .filter((reviewId) => !compiledReviewIds.has(reviewId))
    .sort();
  for (const reviewId of unexpectedReviewIds) {
    errors.push({
      reviewId,
      message: "unexpected adjudication reviewId"
    });
  }
  return {
    valid: errors.length === 0 && missingReviewIds.length === 0,
    errors,
    expected: queue.items.length,
    submitted: submissions.length,
    compiled: entries.length,
    missingReviewIds,
    unexpectedReviewIds: unexpectedReviewIds.sort(),
    entries: entries.sort((left, right) =>
      left.item.pageId.localeCompare(right.item.pageId)
    )
  };
}

function matchesTemplate(
  review: EvidencePointerReview,
  item: EvidenceAdjudicationQueueItem
): boolean {
  const expectedSources = [
    ...(item.reviewTemplate.sourceReviewIds ?? [])
  ].sort();
  const actualSources = [...(review.sourceReviewIds ?? [])].sort();
  return (
    review.reviewId === item.reviewTemplate.reviewId &&
    review.pageId === item.pageId &&
    review.phase === "adjudicated" &&
    review.reviewerId === item.reviewTemplate.reviewerId &&
    review.coverage === "complete-main-region" &&
    review.preannotationVisibility === "shown-after-submit" &&
    JSON.stringify(review.source) ===
      JSON.stringify(item.reviewTemplate.source) &&
    JSON.stringify(actualSources) === JSON.stringify(expectedSources)
  );
}

