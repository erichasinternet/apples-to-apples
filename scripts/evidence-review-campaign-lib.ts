import type { PageObservation } from "../src/learning/contracts";
import {
  compareIndependentEvidenceReviews,
  validateEvidencePointerReview,
  type EvidencePointerReview,
  type EvidenceReviewAgreement
} from "./evidence-review-lib";
import {
  validateEvidenceReviewQueue,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";

export interface EvidenceReviewSubmissionInput {
  filename: string;
  review?: EvidencePointerReview;
  parseError?: string;
}

export interface EvidenceReviewCampaignAuditInput {
  queueA: EvidenceReviewQueue;
  queueB: EvidenceReviewQueue;
  submissionsA: EvidenceReviewSubmissionInput[];
  submissionsB: EvidenceReviewSubmissionInput[];
  observations: Map<string, PageObservation>;
}

export interface EvidenceReviewCampaignReviewerStatus {
  reviewerId: string;
  expected: number;
  submissionFiles: number;
  valid: number;
  missingReviewIds: string[];
  unexpectedReviewIds: string[];
  invalid: Array<{
    filename: string;
    reviewId?: string;
    errors: string[];
  }>;
}

export interface EvidenceReviewCampaignAudit {
  version: 1;
  valid: boolean;
  integrityErrors: string[];
  queueIds: [string, string];
  reviewerIds: [string, string];
  cohort: EvidenceReviewQueue["cohort"];
  pages: number;
  candidateCards: number;
  reviewers: [
    EvidenceReviewCampaignReviewerStatus,
    EvidenceReviewCampaignReviewerStatus
  ];
  pairedPages: number;
  pendingPages: string[];
  readyForAdjudication: boolean;
  agreement: {
    pages: number;
    cards: number;
    disagreements: number;
    comparableKappa: number | null;
    exactStatusAgreement: number;
    exactPriceAgreement: number;
    exactQuantityAgreement: number;
    exactDimensionAgreement: number;
    exactPointerAgreement: number;
    developmentGatePassed: boolean;
    byPage: EvidenceReviewAgreement[];
  };
}

interface ReviewerAudit {
  status: EvidenceReviewCampaignReviewerStatus;
  validByPage: Map<string, EvidencePointerReview>;
}

export function auditEvidenceReviewCampaign(
  input: EvidenceReviewCampaignAuditInput
): EvidenceReviewCampaignAudit {
  const integrityErrors = [
    ...validateCampaignPair(input.queueA, input.queueB),
    ...validateCampaignObservations(input.queueA, input.observations)
  ];
  const reviewerA = auditReviewer(
    input.queueA,
    input.submissionsA,
    input.observations
  );
  const reviewerB = auditReviewer(
    input.queueB,
    input.submissionsB,
    input.observations
  );
  const invalidSubmissionCount =
    reviewerA.status.invalid.length +
    reviewerB.status.invalid.length +
    reviewerA.status.unexpectedReviewIds.length +
    reviewerB.status.unexpectedReviewIds.length;

  const pages = [...input.queueA.items]
    .map((item) => item.pageId)
    .sort();
  const agreements: EvidenceReviewAgreement[] = [];
  const pendingPages: string[] = [];
  if (integrityErrors.length === 0) {
    for (const pageId of pages) {
      const left = reviewerA.validByPage.get(pageId);
      const right = reviewerB.validByPage.get(pageId);
      const observation = input.observations.get(pageId);
      if (!left || !right || !observation) {
        pendingPages.push(pageId);
        continue;
      }
      agreements.push(
        compareIndependentEvidenceReviews(left, right, observation)
      );
    }
  } else {
    pendingPages.push(...pages);
  }

  const agreement = summarizeAgreement(agreements);
  const valid = integrityErrors.length === 0 && invalidSubmissionCount === 0;
  return {
    version: 1,
    valid,
    integrityErrors,
    queueIds: [input.queueA.queueId, input.queueB.queueId],
    reviewerIds: [input.queueA.reviewerId, input.queueB.reviewerId],
    cohort: input.queueA.cohort,
    pages: input.queueA.items.length,
    candidateCards: input.queueA.items.reduce(
      (total, item) => total + item.candidateCardNodeIds.length,
      0
    ),
    reviewers: [reviewerA.status, reviewerB.status],
    pairedPages: agreements.length,
    pendingPages,
    readyForAdjudication:
      valid &&
      pendingPages.length === 0 &&
      agreements.length === input.queueA.items.length,
    agreement
  };
}

export function validateCampaignPair(
  queueA: EvidenceReviewQueue,
  queueB: EvidenceReviewQueue
): string[] {
  const errors = [
    ...validateEvidenceReviewQueue(queueA).map((error) => `queue A: ${error}`),
    ...validateEvidenceReviewQueue(queueB).map((error) => `queue B: ${error}`)
  ];
  if (queueA.reviewerId === queueB.reviewerId) {
    errors.push("campaign reviewers must be distinct");
  }
  if (queueA.cohort !== queueB.cohort) {
    errors.push("campaign queues must use the same cohort");
  }

  const itemsA = new Map(queueA.items.map((item) => [item.pageId, item]));
  const itemsB = new Map(queueB.items.map((item) => [item.pageId, item]));
  const pageIds = [...new Set([...itemsA.keys(), ...itemsB.keys()])].sort();
  for (const pageId of pageIds) {
    const left = itemsA.get(pageId);
    const right = itemsB.get(pageId);
    if (!left || !right) {
      errors.push(`campaign page set differs: ${pageId}`);
      continue;
    }
    if (
      left.rootNodeId !== right.rootNodeId ||
      !sameStringSet(
        left.candidateCardNodeIds,
        right.candidateCardNodeIds
      ) ||
      !sameSource(left.source, right.source)
    ) {
      errors.push(`campaign evidence contract differs: ${pageId}`);
    }
  }
  return errors;
}

function validateCampaignObservations(
  queue: EvidenceReviewQueue,
  observations: Map<string, PageObservation>
): string[] {
  const errors: string[] = [];
  for (const item of queue.items) {
    const observation = observations.get(item.pageId);
    if (!observation) {
      errors.push(`missing immutable observation: ${item.pageId}`);
      continue;
    }
    const nodeIds = new Set(observation.nodes.map((node) => node.id));
    if (
      observation.pageId !== item.pageId ||
      !nodeIds.has(item.rootNodeId) ||
      item.candidateCardNodeIds.some((nodeId) => !nodeIds.has(nodeId))
    ) {
      errors.push(`observation violates frozen node contract: ${item.pageId}`);
    }
  }
  return errors;
}

function auditReviewer(
  queue: EvidenceReviewQueue,
  submissions: EvidenceReviewSubmissionInput[],
  observations: Map<string, PageObservation>
): ReviewerAudit {
  const expectedByReviewId = new Map(
    queue.items.map((item) => [item.reviewTemplate.reviewId, item])
  );
  const seenReviewIds = new Set<string>();
  const validReviewIds = new Set<string>();
  const validByPage = new Map<string, EvidencePointerReview>();
  const unexpectedReviewIds: string[] = [];
  const invalid: EvidenceReviewCampaignReviewerStatus["invalid"] = [];

  for (const submission of submissions) {
    if (!submission.review) {
      invalid.push({
        filename: submission.filename,
        errors: [submission.parseError ?? "submission is not valid JSON"]
      });
      continue;
    }
    const review = submission.review;
    const reviewId =
      typeof review.reviewId === "string" ? review.reviewId : undefined;
    if (!reviewId) {
      invalid.push({
        filename: submission.filename,
        errors: ["reviewId is required"]
      });
      continue;
    }
    if (seenReviewIds.has(reviewId)) {
      invalid.push({
        filename: submission.filename,
        reviewId,
        errors: ["duplicate reviewId in submission directory"]
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
      invalid.push({
        filename: submission.filename,
        reviewId,
        errors: [`missing immutable observation for ${item.pageId}`]
      });
      continue;
    }
    const errors: string[] = [];
    try {
      const validation = validateEvidencePointerReview(review, observation, {
        observationSha256: item.source.observationSha256,
        screenshotSha256: item.source.screenshotSha256,
        expectedCardNodeIds: item.candidateCardNodeIds
      });
      errors.push(...validation.errors);
      if (
        review.reviewerId !== queue.reviewerId ||
        review.pageId !== item.pageId ||
        review.phase !== "independent" ||
        review.preannotationVisibility !== "hidden" ||
        !sameSource(review.source, item.reviewTemplate.source)
      ) {
        errors.push("review identity or blinding contract changed");
      }
      if (
        Number.isFinite(Date.parse(review.completedAt)) &&
        Date.parse(review.completedAt) <
          Date.parse(review.source.captureTimestamp)
      ) {
        errors.push("review completedAt precedes source capture");
      }
    } catch {
      errors.push("submission does not match the review object contract");
    }
    if (errors.length > 0) {
      invalid.push({
        filename: submission.filename,
        reviewId,
        errors: [...new Set(errors)]
      });
      continue;
    }
    validReviewIds.add(reviewId);
    validByPage.set(item.pageId, review);
  }

  return {
    status: {
      reviewerId: queue.reviewerId,
      expected: queue.items.length,
      submissionFiles: submissions.length,
      valid: validReviewIds.size,
      missingReviewIds: [...expectedByReviewId.keys()]
        .filter((reviewId) => !validReviewIds.has(reviewId))
        .sort(),
      unexpectedReviewIds: unexpectedReviewIds.sort(),
      invalid
    },
    validByPage
  };
}

function summarizeAgreement(
  agreements: EvidenceReviewAgreement[]
): EvidenceReviewCampaignAudit["agreement"] {
  const cards = agreements.reduce(
    (total, agreement) => total + agreement.alignedCards,
    0
  );
  const confusion = agreements.reduce(
    (total, agreement) => ({
      bothComparable:
        total.bothComparable +
        agreement.comparableConfusion.bothComparable,
      reviewerAOnly:
        total.reviewerAOnly +
        agreement.comparableConfusion.reviewerAOnly,
      reviewerBOnly:
        total.reviewerBOnly +
        agreement.comparableConfusion.reviewerBOnly,
      bothAbstain:
        total.bothAbstain + agreement.comparableConfusion.bothAbstain
    }),
    {
      bothComparable: 0,
      reviewerAOnly: 0,
      reviewerBOnly: 0,
      bothAbstain: 0
    }
  );
  const exactStatusAgreement = weightedRate(
    agreements,
    (agreement) => agreement.exactStatusAgreement
  );
  const exactPriceAgreement = weightedRate(
    agreements,
    (agreement) => agreement.exactPriceAgreement
  );
  const exactQuantityAgreement = weightedRate(
    agreements,
    (agreement) => agreement.exactQuantityAgreement
  );
  const exactDimensionAgreement = weightedRate(
    agreements,
    (agreement) => agreement.exactDimensionAgreement
  );
  const exactPointerAgreement = weightedRate(
    agreements,
    (agreement) => agreement.exactPointerAgreement
  );
  const comparableKappa = kappaFromConfusion(confusion);
  return {
    pages: agreements.length,
    cards,
    disagreements: agreements.reduce(
      (total, agreement) => total + agreement.disagreements.length,
      0
    ),
    comparableKappa,
    exactStatusAgreement,
    exactPriceAgreement,
    exactQuantityAgreement,
    exactDimensionAgreement,
    exactPointerAgreement,
    developmentGatePassed:
      agreements.length > 0 &&
      comparableKappa !== null &&
      comparableKappa >= 0.9 &&
      exactPriceAgreement >= 0.98 &&
      exactQuantityAgreement >= 0.98 &&
      exactDimensionAgreement >= 0.98 &&
      exactPointerAgreement >= 0.95,
    byPage: agreements
  };
}

function weightedRate(
  agreements: EvidenceReviewAgreement[],
  select: (agreement: EvidenceReviewAgreement) => number
): number {
  const cards = agreements.reduce(
    (total, agreement) => total + agreement.alignedCards,
    0
  );
  if (cards === 0) return 0;
  return (
    agreements.reduce(
      (total, agreement) =>
        total + select(agreement) * agreement.alignedCards,
      0
    ) / cards
  );
}

function kappaFromConfusion(confusion: {
  bothComparable: number;
  reviewerAOnly: number;
  reviewerBOnly: number;
  bothAbstain: number;
}): number | null {
  const total =
    confusion.bothComparable +
    confusion.reviewerAOnly +
    confusion.reviewerBOnly +
    confusion.bothAbstain;
  if (total === 0) return null;
  const observed =
    (confusion.bothComparable + confusion.bothAbstain) / total;
  const reviewerAPositive =
    (confusion.bothComparable + confusion.reviewerAOnly) / total;
  const reviewerBPositive =
    (confusion.bothComparable + confusion.reviewerBOnly) / total;
  const expected =
    reviewerAPositive * reviewerBPositive +
    (1 - reviewerAPositive) * (1 - reviewerBPositive);
  if (expected === 1) return observed === 1 ? 1 : null;
  return (observed - expected) / (1 - expected);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return (
    orderedLeft.length === orderedRight.length &&
    orderedLeft.every((value, index) => value === orderedRight[index])
  );
}

function sameSource(
  left: EvidencePointerReview["source"],
  right: EvidencePointerReview["source"]
): boolean {
  return (
    left.observationSha256 === right.observationSha256 &&
    left.screenshotSha256 === right.screenshotSha256 &&
    left.captureTimestamp === right.captureTimestamp &&
    left.registrableDomain === right.registrableDomain &&
    left.cohort === right.cohort
  );
}
