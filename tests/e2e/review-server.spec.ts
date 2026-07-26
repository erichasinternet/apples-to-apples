import { createHash } from "node:crypto";
import {
  spawn,
  type ChildProcessByStdio
} from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { Readable } from "node:stream";
import { expect, test } from "@playwright/test";
import {
  compareIndependentEvidenceReviews,
  type EvidencePointerReview
} from "../../scripts/evidence-review-lib";
import type { EvidenceAdjudicationQueue } from "../../scripts/evidence-adjudication-queue-lib";
import type { PageObservation } from "../../src/learning/contracts";

test("serves and persists a validated adjudication queue", async ({ page }) => {
  const fixtureDirectory = path.resolve(
    "benchmark-data/review",
    `e2e-adjudication-${process.pid}`
  );
  const outputDirectory = path.join(fixtureDirectory, "submissions");
  const queuePath = path.join(fixtureDirectory, "queue.json");
  let server: ChildProcessByStdio<null, Readable, Readable> | undefined;
  try {
    await mkdir(fixtureDirectory, { recursive: true });
    const observation = observationFixture();
    const observationBytes = Buffer.from(
      `${JSON.stringify(observation, null, 2)}\n`
    );
    const screenshotBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4S8AAAAASUVORK5CYII=",
      "base64"
    );
    const source = {
      observationSha256: sha256(observationBytes),
      screenshotSha256: sha256(screenshotBytes),
      captureTimestamp: "2026-07-25T00:00:00.000Z",
      registrableDomain: "example.test",
      cohort: "training" as const
    };
    const reviewA = independentReview(
      "reviewer-a",
      "price@p0",
      "2026-07-25T01:00:00.000Z",
      source
    );
    const reviewB = independentReview(
      "reviewer-b",
      "price-alt@p0",
      "2026-07-25T01:05:00.000Z",
      source
    );
    const queue: EvidenceAdjudicationQueue = {
      version: 1,
      queueType: "adjudication",
      queueId: "reviewer-c--adjudication--e2e",
      reviewerId: "reviewer-c",
      cohort: "training",
      labelVisibility: "independent reviews and disagreements visible",
      sourceQueueIds: ["reviewer-a--queue", "reviewer-b--queue"],
      items: [
        {
          pageId: observation.pageId,
          source,
          observationPath: "observation.json",
          screenshotPath: "screenshot.png",
          rootNodeId: "root",
          candidateCardNodeIds: ["card"],
          sourceReviews: [reviewA, reviewB],
          agreement: compareIndependentEvidenceReviews(
            reviewA,
            reviewB,
            observation
          ),
          reviewTemplate: {
            version: 1,
            reviewId: "reviewer-c--synthetic-server-page",
            pageId: observation.pageId,
            phase: "adjudicated",
            reviewerId: "reviewer-c",
            completedAt: null,
            coverage: "complete-main-region",
            preannotationVisibility: "shown-after-submit",
            source,
            sourceReviewIds: [reviewA.reviewId, reviewB.reviewId],
            products: []
          }
        }
      ]
    };
    await Promise.all([
      writeFile(path.join(fixtureDirectory, "observation.json"), observationBytes),
      writeFile(path.join(fixtureDirectory, "screenshot.png"), screenshotBytes),
      writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`)
    ]);

    const port = await freePort();
    const runningServer = spawn(
      "bun",
      [
        "scripts/serve-evidence-review.ts",
        "--queue",
        queuePath,
        "--output",
        outputDirectory,
        "--port",
        String(port)
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    server = runningServer;
    const url = await serverUrl(runningServer);
    await page.goto(url);

    await expect(page.locator("#queueMeta")).toHaveText(
      "reviewer-c · training · adjudication"
    );
    await page.getByRole("button", { name: "Review card 1 of 1" }).click();
    await expect(page.locator("#disagreementSummary")).toHaveText(
      "Current price"
    );
    await page.getByRole("button", { name: "Use decision B" }).click();
    await expect(page.locator("#currentPrice")).toHaveValue("price-alt@p0");
    await page.getByRole("button", { name: "Record decision" }).click();
    await page.getByRole("button", { name: "Submit adjudication" }).click();
    await expect(page.locator("#saveState")).toHaveText("Submitted");

    const persisted = JSON.parse(
      await readFile(
        path.join(outputDirectory, "reviewer-c--synthetic-server-page.json"),
        "utf8"
      )
    );
    expect(persisted).toMatchObject({
      phase: "adjudicated",
      reviewerId: "reviewer-c",
      sourceReviewIds: [
        "reviewer-a--synthetic-server-page",
        "reviewer-b--synthetic-server-page"
      ],
      products: [
        {
          cardNodeId: "card",
          target: expect.stringContaining("CURRENT_PRICE price-alt@p0")
        }
      ]
    });
  } finally {
    if (server) await stopServer(server);
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

function observationFixture(): PageObservation {
  return {
    version: 1,
    pageId: "synthetic-server-page",
    url: "https://example.test/search",
    title: "Synthetic server page",
    viewport: { width: 600, height: 800, scrollX: 0, scrollY: 0 },
    rootNodeId: "root",
    sourceRegion: { x: 0, y: 0, width: 600, height: 800 },
    nodes: [
      node("root", undefined, undefined, "main"),
      node("card", "root", undefined, "article"),
      node("title", "card", "Coffee, 12 oz"),
      node("price", "card", "$12.00"),
      node("price-alt", "card", "$13.00"),
      node("quantity", "card", "12 oz")
    ],
    truncated: false
  };
}

function independentReview(
  reviewerId: string,
  priceCandidateId: string,
  completedAt: string,
  source: EvidencePointerReview["source"]
): EvidencePointerReview {
  return {
    version: 1,
    reviewId: `${reviewerId}--synthetic-server-page`,
    pageId: "synthetic-server-page",
    phase: "independent",
    reviewerId,
    completedAt,
    coverage: "complete-main-region",
    preannotationVisibility: "hidden",
    source,
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: [
          "CARD card",
          "TITLE title",
          `CURRENT_PRICE ${priceCandidateId}`,
          "NATIVE_UNIT_PRICE NONE",
          "PACKAGE_QUANTITY quantity@q0",
          "PACK_COUNT NONE",
          "STATUS comparable"
        ].join("\n")
      }
    ]
  };
}

function node(
  id: string,
  parentId?: string,
  text?: string,
  tag = "span"
) {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag,
    ...(text ? { text } : {}),
    bounds: { x: 0, y: 0, width: 600, height: 100 },
    intersectsViewport: true,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 16,
      fontWeight: 400
    }
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a test port."));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function serverUrl(
  server: ChildProcessByStdio<null, Readable, Readable>
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Review server did not start: ${stderr}`));
    }, 10_000);
    server.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)).url);
      } catch (error) {
        reject(error);
      }
    });
    server.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Review server exited ${code}: ${stderr}`));
    });
  });
}

async function stopServer(
  server: ChildProcessByStdio<null, Readable, Readable>
): Promise<void> {
  if (server.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    server.kill("SIGTERM");
  });
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
