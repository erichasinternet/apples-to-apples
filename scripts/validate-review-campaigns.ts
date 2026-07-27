import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EligibleCaptureEntry } from "./capture-eligibility-lib";
import {
  matchesCampaignCaptureEvidence,
  type RetiredCaptureEntry
} from "./capture-retirement-lib";

interface EligibleCaptureManifest {
  version: 1;
  captures: EligibleCaptureEntry[];
}

interface RetiredCaptureManifest {
  version: 1;
  captures: RetiredCaptureEntry[];
}

interface ReviewCampaign {
  version: 1;
  campaignId: string;
  cohort: EligibleCaptureEntry["cohort"];
  pages: Array<{
    siteId: string;
    pageId: string;
    captureTimestamp: string;
    candidateCardCount: number;
    observationSha256: string;
    annotationScreenshotSha256: string;
  }>;
  queues: Array<{
    reviewerId: string;
    queueId: string;
    campaignQueueSha256: string;
    sourceQueueSha256: string[];
    sourceQueuePageCounts: number[];
  }>;
  blinding: {
    labelVisibility: string;
    distinctReviewerIds: boolean;
    candidateCardRootsFrozenFromCapture: boolean;
    completeCandidateCoverageRequired: boolean;
  };
  workbenchValidation: {
    pagesLoaded: number;
    screenshotsLoaded: number;
    candidateCards: number;
    onlyFrozenCardRootOffered: boolean;
    nonCandidateAncestor: string;
    incompleteCoverage: string;
    consoleErrors: number;
    reviewFilesWritten: number;
  };
  eligibility: {
    pointerReady: boolean;
    dualReviewed: boolean;
    adjudicated: boolean;
    goldProducts: number;
  };
}

const SHA256 = /^[a-f0-9]{64}$/;
const campaignDirectory = path.resolve("benchmarks/review-campaigns");
const [eligible, retired] = await Promise.all([
  readJson<EligibleCaptureManifest>(
    path.resolve("benchmarks/capture-pilots/eligible-captures.json")
  ),
  readJson<RetiredCaptureManifest>(
    path.resolve("benchmarks/capture-pilots/retired-captures.json")
  )
]);
const eligibleByPage = new Map(
  eligible.captures.map((capture) => [capture.pageId, capture])
);
const files = (await readdir(campaignDirectory))
  .filter((filename) => filename.endsWith(".json"))
  .sort();
const errors: string[] = [];
const seenCampaigns = new Set<string>();
let pages = 0;
let candidateCards = 0;
let historicalRetiredPages = 0;

for (const filename of files) {
  const campaign = await readJson<ReviewCampaign>(
    path.join(campaignDirectory, filename)
  );
  const prefix = `${filename}:`;
  if (campaign.version !== 1) errors.push(`${prefix} version must be 1`);
  if (!campaign.campaignId?.trim()) {
    errors.push(`${prefix} campaignId is required`);
  } else if (seenCampaigns.has(campaign.campaignId)) {
    errors.push(`${prefix} duplicate campaignId ${campaign.campaignId}`);
  }
  seenCampaigns.add(campaign.campaignId);
  if (!Array.isArray(campaign.pages) || campaign.pages.length === 0) {
    errors.push(`${prefix} campaign has no pages`);
    continue;
  }

  const seenPages = new Set<string>();
  let campaignCandidates = 0;
  for (const page of campaign.pages) {
    if (seenPages.has(page.pageId)) {
      errors.push(`${prefix} duplicate page ${page.pageId}`);
    }
    seenPages.add(page.pageId);
    if (
      !Number.isInteger(page.candidateCardCount) ||
      page.candidateCardCount <= 0
    ) {
      errors.push(`${prefix} invalid candidate count for ${page.pageId}`);
    }
    campaignCandidates += page.candidateCardCount;
    const capture = eligibleByPage.get(page.pageId);
    const exactEligible =
      capture &&
      matchesCampaignCaptureEvidence(capture, page, campaign.cohort);
    const exactRetired = retired.captures.some((retiredCapture) =>
      matchesCampaignCaptureEvidence(retiredCapture, page, campaign.cohort)
    );
    if (!exactEligible && !exactRetired) {
      errors.push(
        `${prefix} page is not exact eligible or retired evidence: ${page.pageId}`
      );
    }
    if (!exactEligible && exactRetired) historicalRetiredPages += 1;
  }

  const reviewers = new Set(campaign.queues.map((queue) => queue.reviewerId));
  const queueIds = new Set(campaign.queues.map((queue) => queue.queueId));
  if (
    campaign.queues.length !== 2 ||
    reviewers.size !== 2 ||
    queueIds.size !== 2
  ) {
    errors.push(`${prefix} campaign requires two distinct reviewer queues`);
  }
  for (const queue of campaign.queues) {
    if (
      !queue.reviewerId.trim() ||
      !queue.queueId.startsWith(`${queue.reviewerId}--campaign--`) ||
      !SHA256.test(queue.campaignQueueSha256) ||
      queue.sourceQueueSha256.length === 0 ||
      queue.sourceQueueSha256.some((hash) => !SHA256.test(hash)) ||
      new Set(queue.sourceQueueSha256).size !== queue.sourceQueueSha256.length ||
      queue.sourceQueuePageCounts.length !== queue.sourceQueueSha256.length ||
      queue.sourceQueuePageCounts.some(
        (count) => !Number.isInteger(count) || count <= 0
      ) ||
      queue.sourceQueuePageCounts.reduce((total, count) => total + count, 0) !==
        campaign.pages.length
    ) {
      errors.push(`${prefix} invalid queue provenance for ${queue.reviewerId}`);
    }
  }
  if (
    campaign.blinding.labelVisibility !== "no model or peer labels" ||
    !campaign.blinding.distinctReviewerIds ||
    !campaign.blinding.candidateCardRootsFrozenFromCapture ||
    !campaign.blinding.completeCandidateCoverageRequired
  ) {
    errors.push(`${prefix} blinding or card-root contract is incomplete`);
  }
  if (
    campaign.workbenchValidation.pagesLoaded !== campaign.pages.length ||
    campaign.workbenchValidation.screenshotsLoaded !== campaign.pages.length ||
    campaign.workbenchValidation.candidateCards !== campaignCandidates ||
    !campaign.workbenchValidation.onlyFrozenCardRootOffered ||
    campaign.workbenchValidation.nonCandidateAncestor !== "rejected-404" ||
    campaign.workbenchValidation.incompleteCoverage !== "rejected-422" ||
    campaign.workbenchValidation.consoleErrors !== 0 ||
    campaign.workbenchValidation.reviewFilesWritten !== 0
  ) {
    errors.push(`${prefix} workbench validation does not match the campaign`);
  }
  if (
    campaign.eligibility.pointerReady ||
    campaign.eligibility.dualReviewed ||
    campaign.eligibility.adjudicated ||
    campaign.eligibility.goldProducts !== 0
  ) {
    errors.push(`${prefix} pending campaign cannot claim gold evidence`);
  }
  pages += campaign.pages.length;
  candidateCards += campaignCandidates;
}

process.stdout.write(
  `${JSON.stringify(
    {
      valid: errors.length === 0,
      campaigns: files.length,
      pages,
      candidateCards,
      historicalRetiredPages,
      errors
    },
    null,
    2
  )}\n`
);
if (errors.length > 0) process.exitCode = 1;

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
