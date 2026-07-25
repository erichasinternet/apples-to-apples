import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { enumerateEvidenceCandidates } from "../src/learning/evidence-pointer";
import {
  validateEvidencePointerReview,
  type EvidencePointerReview
} from "./evidence-review-lib";
import {
  validateEvidenceReviewQueue,
  type EvidenceReviewQueue,
  type EvidenceReviewQueueItem
} from "./evidence-review-queue-lib";

declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): { url: URL };
  file(filename: string): { exists(): Promise<boolean> };
};

const options = parseOptions(process.argv.slice(2));
const queue = await readJson<EvidenceReviewQueue>(options.queuePath);
const queueErrors = validateEvidenceReviewQueue(queue);
if (queueErrors.length > 0) {
  throw new Error(`Invalid review queue: ${queueErrors.join("; ")}`);
}
const queueDirectory = path.dirname(options.queuePath);
await Promise.all(queue.items.map((item) => validateQueueAssets(item)));
const itemByPageId = new Map(queue.items.map((item) => [item.pageId, item]));
await mkdir(options.outputDirectory, { recursive: true });

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: options.port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return fileResponse(
          path.resolve("review-workbench/index.html"),
          "text/html; charset=utf-8"
        );
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return fileResponse(
          path.resolve("review-workbench/app.js"),
          "text/javascript; charset=utf-8"
        );
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        return fileResponse(
          path.resolve("review-workbench/styles.css"),
          "text/css; charset=utf-8"
        );
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }
      if (request.method === "GET" && url.pathname === "/api/queue") {
        return json({
          queueId: queue.queueId,
          reviewerId: queue.reviewerId,
          cohort: queue.cohort,
          labelVisibility: queue.labelVisibility,
          items: await Promise.all(
            queue.items.map(async (item) => ({
              pageId: item.pageId,
              rootNodeId: item.rootNodeId,
              candidateCardNodeIds: item.candidateCardNodeIds,
              source: item.source,
              reviewTemplate: item.reviewTemplate,
              saved: await Bun.file(reviewPath(item)).exists()
            }))
          )
        });
      }
      if (request.method === "GET" && url.pathname === "/api/observation") {
        const item = requireItem(url.searchParams.get("pageId"));
        const observation = await readObservation(item);
        return json(observation);
      }
      if (request.method === "GET" && url.pathname === "/api/screenshot") {
        const item = requireItem(url.searchParams.get("pageId"));
        return verifiedFileResponse(
          resolveQueueAsset(item.screenshotPath),
          "image/png",
          item.source.screenshotSha256
        );
      }
      if (request.method === "GET" && url.pathname === "/api/candidates") {
        const item = requireItem(url.searchParams.get("pageId"));
        const cardNodeId = url.searchParams.get("cardNodeId");
        if (!cardNodeId) throw new HttpError(400, "cardNodeId is required");
        if (!item.candidateCardNodeIds.includes(cardNodeId)) {
          throw new HttpError(404, `Unknown candidate card ${cardNodeId}`);
        }
        const observation = await readObservation(item);
        return json({
          cardNodeId,
          candidates: enumerateEvidenceCandidates(observation, cardNodeId)
        });
      }
      if (request.method === "POST" && url.pathname === "/api/review") {
        const input = (await request.json()) as EvidencePointerReview;
        const item = requireItem(input.pageId);
        const observation = await readObservation(item);
        const validation = validateEvidencePointerReview(input, observation, {
          observationSha256: item.source.observationSha256,
          screenshotSha256: item.source.screenshotSha256,
          expectedCardNodeIds: item.candidateCardNodeIds
        });
        if (!validation.valid) {
          return json({ valid: false, errors: validation.errors }, 422);
        }
        if (
          input.reviewerId !== queue.reviewerId ||
          input.reviewId !== item.reviewTemplate.reviewId ||
          input.phase !== "independent" ||
          input.preannotationVisibility !== "hidden" ||
          !sameSource(input.source, item.reviewTemplate.source)
        ) {
          return json(
            { valid: false, errors: ["Review identity or blinding contract changed."] },
            422
          );
        }
        const outputPath = reviewPath(item);
        try {
          await writeFile(outputPath, `${JSON.stringify(input, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx"
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            return json(
              { valid: false, errors: ["Review already exists and is append-only."] },
              409
            );
          }
          throw error;
        }
        return json({ valid: true, outputFile: path.basename(outputPath) });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      return json(
        { error: error instanceof Error ? error.message : String(error) },
        status
      );
    }
  }
});

process.stdout.write(
  `${JSON.stringify({
    valid: true,
    queueId: queue.queueId,
    pages: queue.items.length,
    outputDirectory: options.outputDirectory,
    url: server.url.href
  })}\n`
);

function requireItem(pageId: string | null): EvidenceReviewQueueItem {
  if (!pageId) throw new HttpError(400, "pageId is required");
  const item = itemByPageId.get(pageId);
  if (!item) throw new HttpError(404, `Unknown page ${pageId}`);
  return item;
}

async function readObservation(
  item: EvidenceReviewQueueItem
): Promise<PageObservation> {
  const value = await readVerifiedAsset(
    resolveQueueAsset(item.observationPath),
    item.source.observationSha256
  );
  return JSON.parse(value.toString("utf8")) as PageObservation;
}

async function validateQueueAssets(
  item: EvidenceReviewQueueItem
): Promise<void> {
  const [observation] = await Promise.all([
    readObservation(item),
    readVerifiedAsset(
      resolveQueueAsset(item.screenshotPath),
      item.source.screenshotSha256
    )
  ]);
  const nodeIds = new Set(observation.nodes.map((node) => node.id));
  if (
    observation.pageId !== item.pageId ||
    !nodeIds.has(item.rootNodeId) ||
    item.candidateCardNodeIds.some((nodeId) => !nodeIds.has(nodeId))
  ) {
    throw new Error(`Queue assets do not match node contract: ${item.pageId}`);
  }
}

function resolveQueueAsset(relativePath: string): string {
  const resolved = path.resolve(queueDirectory, relativePath);
  const allowedRoot = path.resolve("benchmark-data");
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new HttpError(403, "Queue asset escapes benchmark-data.");
  }
  return resolved;
}

function reviewPath(item: EvidenceReviewQueueItem): string {
  const resolved = path.resolve(
    options.outputDirectory,
    `${item.reviewTemplate.reviewId}.json`
  );
  if (!resolved.startsWith(`${options.outputDirectory}${path.sep}`)) {
    throw new HttpError(403, "Review id escapes the output directory.");
  }
  return resolved;
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

async function fileResponse(
  filename: string,
  contentType: string
): Promise<Response> {
  const value = await readFile(filename);
  return new Response(value, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store"
    }
  });
}

async function verifiedFileResponse(
  filename: string,
  contentType: string,
  expectedSha256: string
): Promise<Response> {
  const value = await readVerifiedAsset(filename, expectedSha256);
  return new Response(new Uint8Array(value), {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store"
    }
  });
}

async function readVerifiedAsset(
  filename: string,
  expectedSha256: string
): Promise<Buffer> {
  const value = await readFile(filename);
  const actual = createHash("sha256").update(value).digest("hex");
  if (actual !== expectedSha256) {
    throw new HttpError(422, `Queue asset hash mismatch: ${path.basename(filename)}`);
  }
  return value;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function parseOptions(args: string[]): {
  queuePath: string;
  outputDirectory: string;
  port: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Usage: bun scripts/serve-evidence-review.ts --queue queue.json --output review-directory [--port 4317]"
      );
    }
    values.set(key, value);
  }
  const queuePath = values.get("--queue");
  const outputDirectory = values.get("--output");
  const port = Number.parseInt(values.get("--port") ?? "4317", 10);
  if (!queuePath || !outputDirectory || !Number.isInteger(port) || port <= 0) {
    throw new Error("Required: --queue, --output, and a valid optional --port.");
  }
  return {
    queuePath: path.resolve(queuePath),
    outputDirectory: path.resolve(outputDirectory),
    port
  };
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
