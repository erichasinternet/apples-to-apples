import { chromium } from "@playwright/test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface QueueItem {
  pageId: string;
  candidateCardNodeIds: string[];
  reviewTemplate: Record<string, unknown>;
}

interface QueueResponse {
  queueId: string;
  reviewerId: string;
  cohort: string;
  labelVisibility: string;
  mode: string;
  items: QueueItem[];
}

const options = parseOptions(process.argv.slice(2));
const browser = await chromium.launch({ headless: !options.headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const reviewsBefore = await countReviewFiles(options.reviewsDirectory);
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(options.url, { waitUntil: "domcontentloaded" });
  const queue = await page.evaluate(async () => {
    const response = await fetch("/api/queue");
    if (!response.ok)
      throw new Error(`Queue request failed: ${response.status}`);
    return (await response.json()) as QueueResponse;
  });
  if (
    queue.mode !== "independent" ||
    queue.labelVisibility !== "no model or peer labels" ||
    queue.items.length === 0
  ) {
    throw new Error(
      "Workbench did not load a blinded independent-review queue.",
    );
  }

  let screenshotsLoaded = 0;
  let candidateCards = 0;
  let onlyFrozenCardRootOffered = true;
  for (const [index, item] of queue.items.entries()) {
    await page.locator(".page-button").nth(index).click();
    await page.locator("#pageTitle").waitFor({ state: "visible" });
    await page.waitForFunction((pageId) => {
      const title = document.querySelector("#pageTitle")?.textContent;
      const image = document.querySelector<HTMLImageElement>("#captureImage");
      if (!image) return false;
      const imagePageId = new URL(image.src).searchParams.get("pageId");
      return (
        title === pageId &&
        imagePageId === pageId &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0
      );
    }, item.pageId);
    const renderedCardIds = await page
      .locator(".card-root-button")
      .evaluateAll((buttons) =>
        buttons.map(
          (button) => (button as HTMLElement).dataset.cardNodeId ?? "",
        ),
      );
    if (
      renderedCardIds.length !== item.candidateCardNodeIds.length ||
      renderedCardIds.some(
        (nodeId, cardIndex) => nodeId !== item.candidateCardNodeIds[cardIndex],
      )
    ) {
      onlyFrozenCardRootOffered = false;
    }
    screenshotsLoaded += 1;
    candidateCards += renderedCardIds.length;
  }

  const first = queue.items[0]!;
  const nonCandidateResponse = await page.request.get(
    new URL(
      `/api/candidates?pageId=${encodeURIComponent(first.pageId)}&cardNodeId=not-a-frozen-root`,
      options.url,
    ).href,
  );
  const incompleteResponse = await page.request.post(
    new URL("/api/review", options.url).href,
    {
      data: {
        ...first.reviewTemplate,
        completedAt: new Date().toISOString(),
        products: [],
      },
    },
  );
  const nonCandidateStatus = nonCandidateResponse.status();
  const incompleteStatus = incompleteResponse.status();
  const reviewsAfter = await countReviewFiles(options.reviewsDirectory);

  if (options.screenshotPath) {
    await mkdir(path.dirname(options.screenshotPath), { recursive: true });
    await page.screenshot({ path: options.screenshotPath, fullPage: true });
  }

  const result = {
    version: 1,
    queueId: queue.queueId,
    browser: `${options.headed ? "headed" : "headless"} Playwright Chromium`,
    pagesLoaded: queue.items.length,
    screenshotsLoaded,
    candidateCards,
    onlyFrozenCardRootOffered,
    directFrozenCardNavigation: "passed",
    nonCandidateAncestor:
      nonCandidateStatus === 404
        ? "rejected-404"
        : `unexpected-${nonCandidateStatus}`,
    incompleteCoverage:
      incompleteStatus === 422
        ? "rejected-422"
        : `unexpected-${incompleteStatus}`,
    consoleErrors: consoleErrors.length + pageErrors.length,
    consoleErrorMessages: [...consoleErrors, ...pageErrors],
    reviewFilesWritten: reviewsAfter - reviewsBefore,
  };
  if (
    result.pagesLoaded !== result.screenshotsLoaded ||
    !result.onlyFrozenCardRootOffered ||
    result.nonCandidateAncestor !== "rejected-404" ||
    result.incompleteCoverage !== "rejected-422" ||
    result.consoleErrors !== 0 ||
    result.reviewFilesWritten !== 0
  ) {
    throw new Error(`Workbench validation failed: ${JSON.stringify(result)}`);
  }
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify({ valid: true, ...result })}\n`);
} finally {
  await browser.close();
}

function parseOptions(args: string[]): {
  url: string;
  outputPath: string;
  reviewsDirectory: string;
  screenshotPath?: string;
  headed: boolean;
} {
  const values = new Map<string, string>();
  let headed = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--headed") {
      headed = true;
      continue;
    }
    const value = args[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/validate-evidence-review-workbench.ts --url http://127.0.0.1:4317/ --output report.json --reviews-dir review-directory [--screenshot image.png] [--headed]",
      );
    }
    values.set(arg, value);
    index += 1;
  }
  const url = values.get("--url");
  const output = values.get("--output");
  const reviewsDirectory = values.get("--reviews-dir");
  if (!url || !output || !reviewsDirectory) {
    throw new Error("Required: --url, --output, and --reviews-dir.");
  }
  return {
    url,
    outputPath: path.resolve(output),
    reviewsDirectory: path.resolve(reviewsDirectory),
    ...(values.get("--screenshot")
      ? { screenshotPath: path.resolve(values.get("--screenshot")!) }
      : {}),
    headed,
  };
}

async function countReviewFiles(directory: string): Promise<number> {
  await mkdir(directory, { recursive: true });
  return (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.isFile() && entry.name.endsWith(".json"),
  ).length;
}
