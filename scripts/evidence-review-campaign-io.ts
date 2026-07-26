import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import type { EvidenceReviewSubmissionInput } from "./evidence-review-campaign-lib";
import type { EvidencePointerReview } from "./evidence-review-lib";
import type {
  EvidenceReviewQueue,
  EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";
import type {
  EvidenceAdjudicationQueue,
  EvidenceAdjudicationQueueItem
} from "./evidence-adjudication-queue-lib";

export interface EvidenceReviewCampaignPaths {
  queueAPath: string;
  queueBPath: string;
  submissionsADirectory: string;
  submissionsBDirectory: string;
}

export interface LoadedEvidenceReviewCampaign {
  queueA: EvidenceReviewQueue;
  queueB: EvidenceReviewQueue;
  submissionsA: EvidenceReviewSubmissionInput[];
  submissionsB: EvidenceReviewSubmissionInput[];
  observations: Map<string, PageObservation>;
}

export async function loadEvidenceReviewCampaign(
  paths: EvidenceReviewCampaignPaths
): Promise<LoadedEvidenceReviewCampaign> {
  const [queueA, queueB] = await Promise.all([
    readJson<EvidenceReviewQueue>(paths.queueAPath),
    readJson<EvidenceReviewQueue>(paths.queueBPath)
  ]);
  const [submissionsA, submissionsB, observations] = await Promise.all([
    readEvidenceReviewSubmissions(paths.submissionsADirectory),
    readEvidenceReviewSubmissions(paths.submissionsBDirectory),
    readVerifiedCampaignObservations(
      queueA,
      queueB,
      paths.queueAPath,
      paths.queueBPath
    )
  ]);
  return { queueA, queueB, submissionsA, submissionsB, observations };
}

export async function readEvidenceReviewSubmissions(
  directory: string
): Promise<EvidenceReviewSubmissionInput[]> {
  let filenames: string[];
  try {
    filenames = (await readdir(directory))
      .filter((filename) => filename.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    filenames.map(async (filename) => {
      try {
        return {
          filename,
          review: JSON.parse(
            await readFile(path.join(directory, filename), "utf8")
          ) as EvidencePointerReview
        };
      } catch (error) {
        return {
          filename,
          parseError:
            error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

export async function loadEvidenceAdjudicationQueue(
  queuePath: string
): Promise<{
  queue: EvidenceAdjudicationQueue;
  observations: Map<string, PageObservation>;
}> {
  const queue = await readJson<EvidenceAdjudicationQueue>(queuePath);
  const observations = new Map<string, PageObservation>();
  for (const item of queue.items) {
    const [observation] = await Promise.all([
      readVerifiedAdjudicationObservation(item, queuePath),
      verifyQueueAsset(
        item.screenshotPath,
        item.source.screenshotSha256,
        queuePath,
        item.pageId,
        "Screenshot"
      )
    ]);
    observations.set(item.pageId, observation);
  }
  return { queue, observations };
}

async function readVerifiedCampaignObservations(
  queueA: EvidenceReviewQueue,
  queueB: EvidenceReviewQueue,
  queueAPath: string,
  queueBPath: string
): Promise<Map<string, PageObservation>> {
  const output = new Map<string, PageObservation>();
  const itemsB = new Map(queueB.items.map((item) => [item.pageId, item]));
  for (const itemA of queueA.items) {
    const itemB = itemsB.get(itemA.pageId);
    if (!itemB) continue;
    const [observationA, observationB] = await Promise.all([
      readVerifiedObservation(itemA, queueAPath),
      readVerifiedObservation(itemB, queueBPath),
      verifyQueueAsset(
        itemA.screenshotPath,
        itemA.source.screenshotSha256,
        queueAPath,
        itemA.pageId,
        "Screenshot"
      ),
      verifyQueueAsset(
        itemB.screenshotPath,
        itemB.source.screenshotSha256,
        queueBPath,
        itemB.pageId,
        "Screenshot"
      )
    ]);
    if (JSON.stringify(observationA) !== JSON.stringify(observationB)) {
      throw new Error(`Queue observations differ for ${itemA.pageId}`);
    }
    output.set(itemA.pageId, observationA);
  }
  return output;
}

async function readVerifiedObservation(
  item: EvidenceReviewQueueItem,
  queuePath: string
): Promise<PageObservation> {
  const value = await verifyQueueAsset(
    item.observationPath,
    item.source.observationSha256,
    queuePath,
    item.pageId,
    "Observation"
  );
  return JSON.parse(value.toString("utf8")) as PageObservation;
}

async function readVerifiedAdjudicationObservation(
  item: EvidenceAdjudicationQueueItem,
  queuePath: string
): Promise<PageObservation> {
  const value = await verifyQueueAsset(
    item.observationPath,
    item.source.observationSha256,
    queuePath,
    item.pageId,
    "Observation"
  );
  return JSON.parse(value.toString("utf8")) as PageObservation;
}

async function verifyQueueAsset(
  relativePath: string,
  expectedSha256: string,
  queuePath: string,
  pageId: string,
  label: string
): Promise<Buffer> {
  const filename = path.resolve(path.dirname(queuePath), relativePath);
  const value = await readFile(filename);
  const actual = createHash("sha256").update(value).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`${label} hash drift for ${pageId}`);
  }
  return value;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
