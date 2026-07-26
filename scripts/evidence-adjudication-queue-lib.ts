import { createHash } from "node:crypto";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  auditEvidenceReviewCampaign,
  type EvidenceReviewSubmissionInput
} from "./evidence-review-campaign-lib";
import {
  compareIndependentEvidenceReviews,
  validateEvidencePointerReview,
  type EvidencePointerReview,
  type EvidenceReviewAgreement
} from "./evidence-review-lib";
import type {
  EvidenceReviewQueue,
  EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";

type EvidenceAdjudicationTemplate = Omit<
  EvidencePointerReview,
  "completedAt"
> & {
  completedAt: null;
};

export interface EvidenceAdjudicationQueueItem {
  pageId: string;
  source: EvidencePointerReview["source"];
  observationPath: string;
  screenshotPath: string;
  rootNodeId: string;
  candidateCardNodeIds: string[];
  sourceReviews: [EvidencePointerReview, EvidencePointerReview];
  agreement: EvidenceReviewAgreement;
  reviewTemplate: EvidenceAdjudicationTemplate;
}

export interface EvidenceAdjudicationQueue {
  version: 1;
  queueType: "adjudication";
  queueId: string;
  reviewerId: string;
  cohort: EvidencePointerReview["source"]["cohort"];
  labelVisibility: "independent reviews and disagreements visible";
  sourceQueueIds: [string, string];
  items: EvidenceAdjudicationQueueItem[];
}

export interface BuildEvidenceAdjudicationQueueInput {
  queueA: EvidenceReviewQueue;
  queueB: EvidenceReviewQueue;
  submissionsA: EvidenceReviewSubmissionInput[];
  submissionsB: EvidenceReviewSubmissionInput[];
  observations: Map<string, PageObservation>;
  adjudicatorId: string;
  queueAPath: string;
  outputPath: string;
}

export function buildEvidenceAdjudicationQueue(
  input: BuildEvidenceAdjudicationQueueInput
): EvidenceAdjudicationQueue {
  const audit = auditEvidenceReviewCampaign(input);
  if (!audit.readyForAdjudication) {
    throw new Error(
      `Independent campaign is not ready for adjudication: ${audit.pairedPages}/${audit.pages} paired pages`
    );
  }
  if (
    !input.adjudicatorId.trim() ||
    input.adjudicatorId === input.queueA.reviewerId ||
    input.adjudicatorId === input.queueB.reviewerId
  ) {
    throw new Error(
      "Adjudicator must have a non-empty identity distinct from both reviewers."
    );
  }

  const reviewAById = reviewMap(input.submissionsA);
  const reviewBById = reviewMap(input.submissionsB);
  const itemsB = new Map(input.queueB.items.map((item) => [item.pageId, item]));
  const outputDirectory = path.dirname(path.resolve(input.outputPath));
  const queueADirectory = path.dirname(path.resolve(input.queueAPath));
  const items = [...input.queueA.items]
    .sort((left, right) => left.pageId.localeCompare(right.pageId))
    .map((itemA) => {
      const itemB = itemsB.get(itemA.pageId)!;
      const reviewA = reviewAById.get(itemA.reviewTemplate.reviewId)!;
      const reviewB = reviewBById.get(itemB.reviewTemplate.reviewId)!;
      const observation = input.observations.get(itemA.pageId)!;
      return {
        pageId: itemA.pageId,
        source: itemA.source,
        observationPath: path.relative(
          outputDirectory,
          path.resolve(queueADirectory, itemA.observationPath)
        ),
        screenshotPath: path.relative(
          outputDirectory,
          path.resolve(queueADirectory, itemA.screenshotPath)
        ),
        rootNodeId: itemA.rootNodeId,
        candidateCardNodeIds: [...itemA.candidateCardNodeIds],
        sourceReviews: [reviewA, reviewB] as [
          EvidencePointerReview,
          EvidencePointerReview
        ],
        agreement: compareIndependentEvidenceReviews(
          reviewA,
          reviewB,
          observation
        ),
        reviewTemplate: {
          version: 1 as const,
          reviewId: `${input.adjudicatorId}--${itemA.pageId}`,
          pageId: itemA.pageId,
          phase: "adjudicated" as const,
          reviewerId: input.adjudicatorId,
          completedAt: null,
          coverage: "complete-main-region" as const,
          preannotationVisibility: "shown-after-submit" as const,
          source: itemA.source,
          sourceReviewIds: [reviewA.reviewId, reviewB.reviewId],
          products: []
        }
      };
    });
  const digest = createHash("sha256")
    .update(
      stableJson({
        adjudicatorId: input.adjudicatorId,
        sourceQueueIds: [input.queueA.queueId, input.queueB.queueId],
        sourceReviews: items.flatMap((item) => item.sourceReviews)
      })
    )
    .digest("hex")
    .slice(0, 16);
  return {
    version: 1,
    queueType: "adjudication",
    queueId: `${input.adjudicatorId}--adjudication--${digest}`,
    reviewerId: input.adjudicatorId,
    cohort: input.queueA.cohort,
    labelVisibility: "independent reviews and disagreements visible",
    sourceQueueIds: [input.queueA.queueId, input.queueB.queueId],
    items
  };
}

export function validateEvidenceAdjudicationQueue(
  queue: EvidenceAdjudicationQueue,
  observations?: Map<string, PageObservation>
): string[] {
  const errors: string[] = [];
  if (queue.version !== 1) errors.push("queue version must be 1");
  if (queue.queueType !== "adjudication") {
    errors.push("queueType must be adjudication");
  }
  if (!queue.queueId?.trim()) errors.push("queueId is required");
  if (!queue.reviewerId?.trim()) errors.push("reviewerId is required");
  if (
    queue.labelVisibility !==
    "independent reviews and disagreements visible"
  ) {
    errors.push("adjudication labels must be visible");
  }
  if (
    queue.sourceQueueIds?.length !== 2 ||
    new Set(queue.sourceQueueIds).size !== 2
  ) {
    errors.push("adjudication requires two distinct source queues");
  }
  if (!Array.isArray(queue.items) || queue.items.length === 0) {
    errors.push("adjudication queue must contain at least one page");
    return errors;
  }

  const seenPages = new Set<string>();
  for (const item of queue.items) {
    if (seenPages.has(item.pageId)) {
      errors.push(`duplicate adjudication page: ${item.pageId}`);
    }
    seenPages.add(item.pageId);
    const [reviewA, reviewB] = item.sourceReviews;
    if (
      reviewA.reviewerId === reviewB.reviewerId ||
      queue.reviewerId === reviewA.reviewerId ||
      queue.reviewerId === reviewB.reviewerId
    ) {
      errors.push(`adjudication identities are not distinct: ${item.pageId}`);
    }
    if (
      item.reviewTemplate.pageId !== item.pageId ||
      item.reviewTemplate.reviewerId !== queue.reviewerId ||
      item.reviewTemplate.phase !== "adjudicated" ||
      item.reviewTemplate.completedAt !== null ||
      item.reviewTemplate.coverage !== "complete-main-region" ||
      item.reviewTemplate.preannotationVisibility !== "shown-after-submit" ||
      item.reviewTemplate.products.length !== 0 ||
      !sameSource(item.source, item.reviewTemplate.source) ||
      !sameStringSet(item.reviewTemplate.sourceReviewIds ?? [], [
        reviewA.reviewId,
        reviewB.reviewId
      ])
    ) {
      errors.push(`adjudication template contract changed: ${item.pageId}`);
    }
    const observation = observations?.get(item.pageId);
    if (!observation) continue;
    const validationA = validateEvidencePointerReview(reviewA, observation, {
      observationSha256: item.source.observationSha256,
      screenshotSha256: item.source.screenshotSha256,
      expectedCardNodeIds: item.candidateCardNodeIds
    });
    const validationB = validateEvidencePointerReview(reviewB, observation, {
      observationSha256: item.source.observationSha256,
      screenshotSha256: item.source.screenshotSha256,
      expectedCardNodeIds: item.candidateCardNodeIds
    });
    if (!validationA.valid || !validationB.valid) {
      errors.push(`invalid source review evidence: ${item.pageId}`);
      continue;
    }
    const agreement = compareIndependentEvidenceReviews(
      reviewA,
      reviewB,
      observation
    );
    if (stableJson(agreement) !== stableJson(item.agreement)) {
      errors.push(`adjudication agreement drift: ${item.pageId}`);
    }
  }
  return errors;
}

function reviewMap(
  submissions: EvidenceReviewSubmissionInput[]
): Map<string, EvidencePointerReview> {
  return new Map(
    submissions
      .filter(
        (
          submission
        ): submission is EvidenceReviewSubmissionInput & {
          review: EvidencePointerReview;
        } => Boolean(submission.review)
      )
      .map((submission) => [submission.review.reviewId, submission.review])
  );
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

