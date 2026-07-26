import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import {
  auditEvidenceReviewCampaign,
  type EvidenceReviewSubmissionInput
} from "./evidence-review-campaign-lib";
import type { EvidencePointerReview } from "./evidence-review-lib";
import type {
  EvidenceReviewQueue,
  EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";

const options = parseOptions(process.argv.slice(2));
const [queueA, queueB] = await Promise.all([
  readJson<EvidenceReviewQueue>(options.queueA),
  readJson<EvidenceReviewQueue>(options.queueB)
]);
const [submissionsA, submissionsB, observations] = await Promise.all([
  readSubmissions(options.submissionsA),
  readSubmissions(options.submissionsB),
  readVerifiedObservations(queueA, queueB, options.queueA, options.queueB)
]);
const report = auditEvidenceReviewCampaign({
  queueA,
  queueB,
  submissionsA,
  submissionsB,
  observations
});
const output = `${JSON.stringify(report, null, 2)}\n`;
if (options.output) {
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, output, "utf8");
}
process.stdout.write(output);
if (!report.valid) process.exitCode = 1;

async function readVerifiedObservations(
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

async function readSubmissions(
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

function parseOptions(args: string[]): {
  queueA: string;
  queueB: string;
  submissionsA: string;
  submissionsB: string;
  output?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/audit-evidence-review-campaign.ts --queue-a queue-a.json --queue-b queue-b.json --submissions-a dir --submissions-b dir [--output report.json]"
      );
    }
    values.set(name, value);
  }
  const queueA = values.get("--queue-a");
  const queueB = values.get("--queue-b");
  const submissionsA = values.get("--submissions-a");
  const submissionsB = values.get("--submissions-b");
  if (!queueA || !queueB || !submissionsA || !submissionsB) {
    throw new Error(
      "Required: --queue-a, --queue-b, --submissions-a, --submissions-b"
    );
  }
  return {
    queueA: path.resolve(queueA),
    queueB: path.resolve(queueB),
    submissionsA: path.resolve(submissionsA),
    submissionsB: path.resolve(submissionsB),
    ...(values.get("--output")
      ? { output: path.resolve(values.get("--output")!) }
      : {})
  };
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}
