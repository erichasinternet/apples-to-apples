import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { compileEvidenceAdjudicationCampaign } from "./evidence-adjudication-campaign-lib";
import {
  loadEvidenceAdjudicationQueue,
  readEvidenceReviewSubmissions
} from "./evidence-review-campaign-io";

const options = parseOptions(process.argv.slice(2));
const [{ queue, observations }, submissions] = await Promise.all([
  loadEvidenceAdjudicationQueue(options.queuePath),
  readEvidenceReviewSubmissions(options.submissionsDirectory)
]);
const result = compileEvidenceAdjudicationCampaign(
  queue,
  submissions,
  observations
);
if (!result.valid) {
  process.stderr.write(
    `${JSON.stringify(
      {
        valid: false,
        expected: result.expected,
        submitted: result.submitted,
        compiled: result.compiled,
        missingReviewIds: result.missingReviewIds,
        unexpectedReviewIds: result.unexpectedReviewIds,
        errors: result.errors
      },
      null,
      2
    )}\n`
  );
  process.exit(1);
}

const parentDirectory = path.dirname(options.outputDirectory);
await mkdir(parentDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(
  path.join(parentDirectory, `.${path.basename(options.outputDirectory)}-`)
);
try {
  const annotationDirectory = path.join(temporaryDirectory, "annotations");
  await mkdir(annotationDirectory);
  const pages = [];
  for (const entry of result.entries) {
    const filename = `${safeSegment(entry.item.pageId)}.json`;
    const annotationPath = path.join(annotationDirectory, filename);
    const serialized = `${JSON.stringify(entry.annotation, null, 2)}\n`;
    await writeFile(annotationPath, serialized, {
      encoding: "utf8",
      flag: "wx"
    });
    pages.push({
      pageId: entry.item.pageId,
      source: entry.item.source,
      observationPath: path.relative(
        options.outputDirectory,
        path.resolve(
          path.dirname(options.queuePath),
          entry.item.observationPath
        )
      ),
      screenshotPath: path.relative(
        options.outputDirectory,
        path.resolve(
          path.dirname(options.queuePath),
          entry.item.screenshotPath
        )
      ),
      annotationPath: path.posix.join("annotations", filename),
      annotationSha256: createHash("sha256")
        .update(serialized)
        .digest("hex"),
      independentReviewIds: entry.item.sourceReviews.map(
        (review) => review.reviewId
      ),
      adjudicationReviewId: entry.review.reviewId,
      products: entry.annotation.products.length,
      comparable: entry.annotation.products.filter(
        (product) => product.comparable
      ).length
    });
  }
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    queueId: queue.queueId,
    cohort: queue.cohort,
    reviewers: [
      queue.items[0]!.sourceReviews[0].reviewerId,
      queue.items[0]!.sourceReviews[1].reviewerId,
      queue.reviewerId
    ],
    pages,
    totals: {
      pages: pages.length,
      products: pages.reduce((total, page) => total + page.products, 0),
      comparable: pages.reduce(
        (total, page) => total + page.comparable,
        0
      ),
      abstentions: pages.reduce(
        (total, page) => total + page.products - page.comparable,
        0
      )
    }
  };
  await writeFile(
    path.join(temporaryDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  await rename(temporaryDirectory, options.outputDirectory);
  process.stdout.write(
    `${JSON.stringify({
      valid: true,
      output: options.outputDirectory,
      ...manifest.totals
    })}\n`
  );
} catch (error) {
  await rm(temporaryDirectory, { recursive: true, force: true });
  throw error;
}

function parseOptions(args: string[]): {
  queuePath: string;
  submissionsDirectory: string;
  outputDirectory: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/compile-evidence-adjudication-campaign.ts --queue adjudication-queue.json --submissions dir --output dir"
      );
    }
    values.set(name, value);
  }
  const queuePath = values.get("--queue");
  const submissionsDirectory = values.get("--submissions");
  const outputDirectory = values.get("--output");
  if (!queuePath || !submissionsDirectory || !outputDirectory) {
    throw new Error("Required: --queue, --submissions, --output");
  }
  return {
    queuePath: path.resolve(queuePath),
    submissionsDirectory: path.resolve(submissionsDirectory),
    outputDirectory: path.resolve(outputDirectory)
  };
}

function safeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
