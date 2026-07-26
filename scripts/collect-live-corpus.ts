import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page
} from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { navigateForObservation } from "../src/learning/page-navigation";
import { capturePageObservation } from "../src/learning/page-observation";
import {
  dismissVisibleObstruction,
  measureVisibleObstructionCoverage
} from "../src/learning/page-preparation";
import {
  LIVE_CORPUS_VERSION,
  MINIMUM_QUERY_TOKEN_COVERAGE,
  expandTargets,
  selectTargets,
  slugify,
  assignCaptureViewports,
  calculateSearchResultQueryCoverage,
  isInterstitialOrBotChallenge,
  isSameSiteHostname,
  type CaptureViewportAssignment,
  type CaptureViewportProfile,
  type CaptureTarget,
  type CorpusAnnotation,
  type CorpusTargetManifest
} from "./live-corpus-lib";
import {
  auditCapturePrivacy,
  redactSensitiveCaptureText,
  sanitizeCaptureUrl,
  writeCaptureProvenance
} from "./capture-provenance-lib";

interface CollectorOptions {
  targetsPath: string;
  outputRoot: string;
  headed: boolean;
  disableHttp2: boolean;
  limit?: number;
  perSite?: number;
  seed: number;
  maxCards: number;
  delayMs: number;
  pageTimeoutMs: number;
  cardScreenshotBudgetMs: number;
  siteIds: string[];
  pageIds: string[];
  viewportMode: CaptureViewportProfile | "mixed";
  narrowShare: number;
}

interface CandidateCapture {
  nodeId: string;
  groupHint: "primary-results" | "secondary-recommendation" | "unknown";
  containerNodeId: string;
  groupScore: number;
  text: string;
  html: string;
  href?: string;
  box: { x: number; y: number; width: number; height: number };
}

interface PageCapture {
  pageId: string;
  target: CaptureTarget;
  capturedAt: string;
  requestedUrl: string;
  finalUrl: string;
  navigationAttempts: number;
  title: string;
  httpStatus?: number;
  blocked: boolean;
  blockReasons: string[];
  viewport: { width: number; height: number };
  redactionCount: number;
  dismissedObstructions: number;
  unresolvedObstructionCoverage: number;
  queryTokenCoverage: number;
  candidateCount: number;
  candidateScreenshotsCaptured: number;
  observationNodeCount: number;
  observationTruncated: boolean;
  observationSha256: string;
  mainScreenshotCaptured: boolean;
  annotationRegion: { x: number; y: number; width: number; height: number };
  annotationScreenshotCaptured: boolean;
  mainHtmlSha256: string;
  mainHtmlBytes: number;
}

const options = parseOptions(process.argv.slice(2));
const manifestBytes = await readFile(options.targetsPath);
const sourceManifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const collectorSourcePaths = [
  fileURLToPath(import.meta.url),
  path.resolve("scripts/capture-provenance-lib.ts"),
  path.resolve("scripts/live-corpus-lib.ts"),
  path.resolve("src/learning/page-navigation.ts"),
  path.resolve("src/learning/page-observation.ts"),
  path.resolve("src/learning/page-preparation.ts")
];
const collectorHash = createHash("sha256");
for (const filename of collectorSourcePaths.sort()) {
  collectorHash.update(path.relative(process.cwd(), filename));
  collectorHash.update("\0");
  collectorHash.update(await readFile(filename));
  collectorHash.update("\0");
}
const collectorSha256 = collectorHash.digest("hex");
const manifest = JSON.parse(manifestBytes.toString("utf8")) as CorpusTargetManifest;
const allTargets = expandTargets(manifest);
const targets = selectTargets(allTargets, {
  seed: options.seed,
  ...(options.limit === undefined ? {} : { limit: options.limit }),
  ...(options.perSite === undefined ? {} : { perSite: options.perSite }),
  ...(options.siteIds.length === 0 ? {} : { siteIds: options.siteIds }),
  ...(options.pageIds.length === 0 ? {} : { pageIds: options.pageIds })
});
const viewportAssignments = assignCaptureViewports(targets, {
  seed: options.seed,
  mode: options.viewportMode,
  narrowShare: options.narrowShare
});

if (options.pageIds.length > 0) {
  const knownPageIds = new Set(allTargets.map((target) => target.pageId));
  const unknownPageIds = options.pageIds.filter((pageId) => !knownPageIds.has(pageId));
  if (unknownPageIds.length > 0) {
    throw new Error(`Unknown page ids: ${unknownPageIds.join(", ")}`);
  }
}
if (targets.length === 0) {
  throw new Error("No capture targets matched the supplied options.");
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDirectory = path.join(options.outputRoot, runId);
await mkdir(runDirectory, { recursive: true });

const runResults: Array<{
  pageId: string;
  status: "captured" | "blocked" | "error";
  viewport: CaptureViewportAssignment;
  message?: string;
}> = [];
await writeRunManifest();

for (const [index, target] of targets.entries()) {
  const viewport = viewportAssignments.get(target.pageId)!;
  process.stdout.write(
    `[${index + 1}/${targets.length}] ${target.siteLabel}: ${target.query} (${viewport.profile})\n`
  );
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  try {
    browser = await chromium.launch({
      headless: !options.headed,
      ...(options.disableHttp2 ? { args: ["--disable-http2"] } : {}),
      timeout: 30_000
    });
    context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/Denver",
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "light"
    });
    page = await context.newPage();
    const capture = await withTimeout(
      capturePage(
        page,
        target,
        runDirectory,
        options.maxCards,
        options.cardScreenshotBudgetMs
      ),
      options.pageTimeoutMs,
      `target capture exceeded ${options.pageTimeoutMs} ms`
    );
    runResults.push({
      pageId: target.pageId,
      status: capture.blocked ? "blocked" : "captured",
      viewport,
      ...(capture.blockReasons.length === 0 ? {} : { message: capture.blockReasons.join("; ") })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runResults.push({
      pageId: target.pageId,
      status: "error",
      viewport,
      message
    });
    process.stderr.write(`  capture failed: ${message}\n`);
  } finally {
    if (page) await closeWithin(page.close(), 5_000);
    if (context) await closeWithin(context.close(), 5_000);
    if (browser) await closeWithin(browser.close(), 5_000);
  }

  await writeRunManifest();
  if (options.delayMs > 0 && index < targets.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }
}

await new Promise<void>((resolve) => {
  process.stdout.write(`Corpus run written to ${runDirectory}\n`, () => resolve());
});
process.exit(0);

async function writeRunManifest(): Promise<void> {
  await writeJson(path.join(runDirectory, "run.json"), {
    version: LIVE_CORPUS_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), options.targetsPath),
    anonymousContext: true,
    seed: options.seed,
    limits: {
      pageTimeoutMs: options.pageTimeoutMs,
      maxCards: options.maxCards,
      cardScreenshotBudgetMs: options.cardScreenshotBudgetMs
    },
    viewportPolicy: {
      mode: options.viewportMode,
      narrowShare: options.narrowShare,
      assignments: Object.fromEntries(
        [...viewportAssignments.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    },
    requestedPages: targets.length,
    completedPages: runResults.length,
    capturedPages: runResults.filter((result) => result.status === "captured").length,
    blockedPages: runResults.filter((result) => result.status === "blocked").length,
    failedPages: runResults.filter((result) => result.status === "error").length,
    complete: runResults.length === targets.length,
    results: runResults
  });
}

async function closeWithin(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    operation
      .catch(() => undefined)
      .then(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function capturePage(
  page: Page,
  target: CaptureTarget,
  runDirectory: string,
  maxCards: number,
  cardScreenshotBudgetMs: number
): Promise<PageCapture> {
  const navigation = await navigateForObservation(page, target.url);
  const response = navigation.response;
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  let dismissedObstructions = await preparePage(page);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(750);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  dismissedObstructions += await preparePage(page);
  let unresolvedObstructionCoverage = await page
    .evaluate(measureVisibleObstructionCoverage)
    .catch(() => 0);

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  const currentTitle = await page.title();
  const renderedUrl = new URL(page.url());
  const searchContext = await page.evaluate(() => {
    const visibleText = (selector: string): string[] =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            box.width > 0 &&
            box.height > 0
          );
        })
        .map((element) => element.innerText.trim())
        .filter(Boolean);
    const searchValues = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input[type='search'], input[role='searchbox'], [role='search'] input"
      )
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      })
      .map((element) => element.value.trim())
      .filter(Boolean);
    const resultSummaryText = [
      ...document.querySelectorAll<HTMLElement>("body *")
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0 &&
          text.length <= 240 &&
          /\b(?:search\s+)?results?\s+for\b/i.test(text)
        );
      })
      .map((element) =>
        (element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    return {
      headings: visibleText("h1, h2, [role='heading']"),
      statusText: [
        ...visibleText("[role='status'], [aria-live]"),
        ...resultSummaryText
      ],
      searchValues
    };
  });
  const queryTokenCoverage = calculateSearchResultQueryCoverage(target.query, {
    title: currentTitle,
    pathname: decodeURIComponent(renderedUrl.pathname),
    ...searchContext
  });
  const blockReasons: string[] = [];
  if (response && response.status() >= 400) {
    blockReasons.push(`HTTP ${response.status()}`);
  }
  if (!isSameSiteHostname(target.hostname, renderedUrl.hostname)) {
    blockReasons.push(`cross-site redirect to ${renderedUrl.hostname}`);
  }
  if (isInterstitialOrBotChallenge(bodyText)) {
    blockReasons.push("interstitial or bot challenge");
  }
  if (queryTokenCoverage < MINIMUM_QUERY_TOKEN_COVERAGE) {
    blockReasons.push(
      `search results evidence only ${Math.round(
        queryTokenCoverage * 100
      )}% of requested query tokens`
    );
  }

  const redactionCount = await page.evaluate(() => {
    const root =
      [...document.querySelectorAll("main, [role='main'], #main, #content")].find(
        (candidate): candidate is HTMLElement => {
          if (!(candidate instanceof HTMLElement)) return false;
          const style = getComputedStyle(candidate);
          const box = candidate.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.display !== "contents" &&
            style.visibility !== "hidden" &&
            box.width >= 80 &&
            box.height >= 30
          );
        }
      ) ?? document.body;
    const redact = (value: string): string =>
      value
        .replace(
          /\b(at|near|store)\s+\d{2,6}\s+[A-Z][A-Za-z0-9 .'-]{2,50}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
          "$1 [REDACTED LOCATION]"
        )
        .replace(
          /\b(only\s+\d+\s+left\s+at|pickup\s+(?:available\s+)?at|out of stock at|in stock at|available at)\s+[A-Z][A-Za-z .'-]{2,60}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
          "$1 [REDACTED LOCATION]"
        )
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
        .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED PHONE]")
        .replace(
          /\b\d{1,6}[ \t]+(?:[NSEW]\.?[ \t]+)?[A-Z0-9][A-Za-z0-9.' -]{1,60}[ \t]+(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/gi,
          "[REDACTED ADDRESS]"
        )
        .replace(/\b(?:hi|hello|welcome back),?\s+[A-Z][a-z]{1,30}\b/gi, "[REDACTED ACCOUNT]")
        .replace(
          /\b(?:bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[-_]?key|access[-_]?token|session[-_]?id)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,})\b/gi,
          "[REDACTED CREDENTIAL]"
        );
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let count = 0;
    let node = walker.nextNode();

    while (node) {
      const current = node.nodeValue ?? "";
      const redacted = redact(current);
      if (redacted !== current) {
        node.nodeValue = redacted;
        count += 1;
      }
      node = walker.nextNode();
    }

    // Addresses are often split across nested elements, so no individual text
    // node contains the complete sensitive value. Redact the deepest combined
    // text container before observations or screenshots are captured.
    const elements = [...root.querySelectorAll<HTMLElement>("*")].reverse();
    for (const element of elements) {
      const current = (element.innerText || element.textContent || "").trim();
      if (!current || current.length > 400) continue;
      const redacted = redact(current);
      if (redacted !== current) {
        element.textContent = redacted;
        count += 1;
      }
    }

    return count;
  });

  const observation = await page.evaluate(capturePageObservation, {
    pageId: target.pageId,
    maxNodes: 20_000
  });
  observation.url = sanitizeCaptureUrl(observation.url);

  const extracted = await page.evaluate((candidateLimit) => {
    const root =
      [...document.querySelectorAll("main, [role='main'], #main, #content")].find(
        (candidate): candidate is HTMLElement => {
          if (!(candidate instanceof HTMLElement)) return false;
          const style = getComputedStyle(candidate);
          const box = candidate.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.display !== "contents" &&
            style.visibility !== "hidden" &&
            box.width >= 80 &&
            box.height >= 30
          );
        }
      ) ?? document.body;

    const allElements = [root, ...root.querySelectorAll("*")].filter(
      (element): element is HTMLElement => element instanceof HTMLElement
    );
    for (let index = 0; index < allElements.length; index += 1) {
      const element = allElements[index]!;
      element.setAttribute("data-ata-benchmark-node", `n${index}`);
    }

    const visibleText = (element: HTMLElement): string =>
      (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    const isVisible = (element: HTMLElement): boolean => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width >= 80 && box.height >= 30;
    };
    const score = (element: HTMLElement): number => {
      if (!isVisible(element)) {
        return 0;
      }

      const text = visibleText(element);
      if (text.length < 24 || text.length > 2800 || !/(?:\$|€|£)\s*\d/.test(text)) {
        return 0;
      }

      let value = 4;
      if (element.matches("a[href]") || element.querySelector("a[href]")) value += 2;
      if (element.querySelector("img, picture")) value += 1;
      if (/\b(add|cart|buy|pickup|delivery|ship|subscribe)\b/i.test(text)) value += 1;
      if (/\b(oz|lb|count|ct|pack|roll|sheet|ml|liter|gallon|tablet|capsule|sq ft)\b/i.test(text)) value += 2;
      if (/(?:¢|cents?)\s*(?:\/|per)|(?:\$|€|£)\s*\d+(?:[.,]\d+)?\s*(?:\/|per)/i.test(text)) value += 2;
      if (element.matches("[data-asin], [data-item-id], [itemtype*='Product']")) value += 2;
      return value;
    };

    const selector = [
      "[data-asin]:not([data-asin=''])",
      "[data-item-id]",
      "[itemtype*='Product']",
      "article",
      "li",
      "a[href]",
      "[data-testid*='product' i]",
      "[data-test*='product' i]",
      "[class*='product' i]"
    ].join(",");

    const ranked = [...new Set(root.querySelectorAll<HTMLElement>(selector))]
      .map((element) => ({ element, score: score(element), textLength: visibleText(element).length }))
      .filter((candidate) => candidate.score >= 7)
      .sort((left, right) => right.score - left.score || left.textLength - right.textLength)
      .slice(0, 320);

    const directChildWithin = (ancestor: HTMLElement, descendant: HTMLElement): HTMLElement | undefined => {
      let branch: HTMLElement | null = descendant;
      while (branch?.parentElement && branch.parentElement !== ancestor) {
        branch = branch.parentElement;
      }
      return branch?.parentElement === ancestor ? branch : undefined;
    };

    const candidateElements = ranked.map((candidate) => candidate.element);
    const findRepeatedGroup = (
      element: HTMLElement
    ): { card: HTMLElement; container: HTMLElement } | undefined => {
      let ancestor = element.parentElement;

      while (ancestor && root.contains(ancestor)) {
        const branches = new Set<HTMLElement>();
        for (const candidate of candidateElements) {
          if (!ancestor.contains(candidate)) {
            continue;
          }
          const branch = directChildWithin(ancestor, candidate);
          if (branch) {
            branches.add(branch);
          }
        }

        const card = directChildWithin(ancestor, element);
        if (card && branches.size >= 3 && branches.size <= 120) {
          return { card, container: ancestor };
        }
        ancestor = ancestor.parentElement;
      }

      return undefined;
    };

    const groupedCards = new Map<HTMLElement, Set<HTMLElement>>();
    for (const candidate of ranked) {
      const group = findRepeatedGroup(candidate.element);
      if (!group || score(group.card) < 7) {
        continue;
      }

      const cards = groupedCards.get(group.container) ?? new Set<HTMLElement>();
      cards.add(group.card);
      groupedCards.set(group.container, cards);
    }

    const groupEntries = [...groupedCards.entries()]
      .map(([container, cardSet]) => {
        const cards = [...cardSet].sort((left, right) =>
          left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
        const identity = `${container.id} ${container.className} ${container.getAttribute("aria-label") ?? ""}`;
        let groupScore = cards.length * 2;
        if (/(product.{0,12}(list|grid)|search.{0,12}(result|product)|result.{0,12}grid|listing)/i.test(identity)) {
          groupScore += 10;
        }
        if (/(carousel|slider|recommend|related|recent|sponsored)/i.test(identity)) {
          groupScore -= 8;
        }
        if (container.getBoundingClientRect().width >= 600) {
          groupScore += 2;
        }
        return { container, cards, groupScore };
      })
      .filter((group) => group.cards.length >= 3)
      .sort((left, right) => right.groupScore - left.groupScore || right.cards.length - left.cards.length);

    const selected: Array<{
      element: HTMLElement;
      container: HTMLElement;
      groupHint: "primary-results" | "secondary-recommendation" | "unknown";
      groupScore: number;
    }> = [];
    const selectedElements = new Set<HTMLElement>();
    const selectedHrefs = new Set<string>();

    for (let groupIndex = 0; groupIndex < groupEntries.length; groupIndex += 1) {
      const group = groupEntries[groupIndex]!;
      for (const card of group.cards) {
        if (selected.length >= candidateLimit) break;
        if (selectedElements.has(card)) continue;
        const href = card.querySelector<HTMLAnchorElement>("a[href]")?.href;
        const canonicalHref = href ? new URL(href, location.href).origin + new URL(href, location.href).pathname : undefined;
        if (canonicalHref && selectedHrefs.has(canonicalHref)) continue;
        selected.push({
          element: card,
          container: group.container,
          groupHint: groupIndex === 0 ? "primary-results" : "secondary-recommendation",
          groupScore: group.groupScore
        });
        selectedElements.add(card);
        if (canonicalHref) selectedHrefs.add(canonicalHref);
      }
      if (selected.length >= candidateLimit) break;
    }

    if (selected.length === 0) {
      for (const candidate of ranked) {
        if (selected.length >= candidateLimit) break;
        if (
          [...selectedElements].some(
            (element) =>
              element === candidate.element ||
              element.contains(candidate.element) ||
              candidate.element.contains(element)
          )
        ) {
          continue;
        }
        selected.push({
          element: candidate.element,
          container: root,
          groupHint: "unknown",
          groupScore: 0
        });
        selectedElements.add(candidate.element);
      }
    }

    const sanitize = (source: HTMLElement): string => {
      const clone = source.cloneNode(true) as HTMLElement;
      const redact = (value: string): string =>
        value
          .replace(
            /\b(at|near|store)\s+\d{2,6}\s+[A-Z][A-Za-z0-9 .'-]{2,50}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
            "$1 [REDACTED LOCATION]"
          )
          .replace(
            /\b(only\s+\d+\s+left\s+at|pickup\s+(?:available\s+)?at|out of stock at|in stock at|available at)\s+[A-Z][A-Za-z .'-]{2,60}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
            "$1 [REDACTED LOCATION]"
          )
          .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
          .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED PHONE]")
          .replace(
            /\b\d{1,6}[ \t]+(?:[NSEW]\.?[ \t]+)?[A-Z0-9][A-Za-z0-9.' -]{1,60}[ \t]+(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/gi,
            "[REDACTED ADDRESS]"
          )
          .replace(/\b(?:hi|hello|welcome back),?\s+[A-Z][a-z]{1,30}\b/gi, "[REDACTED ACCOUNT]")
          .replace(
            /\b(?:bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[-_]?key|access[-_]?token|session[-_]?id)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,})\b/gi,
            "[REDACTED CREDENTIAL]"
          );
      const hiddenNodeIds = [source, ...source.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.matches("dialog:not([open]), [hidden]") ||
            style.display === "none" ||
            style.visibility === "hidden"
          );
        })
        .map((element) => element.getAttribute("data-ata-benchmark-node"))
        .filter((nodeId): nodeId is string => Boolean(nodeId));

      clone.querySelectorAll("script, style, noscript, iframe, object, embed").forEach((element) => element.remove());
      for (const nodeId of hiddenNodeIds) {
        clone.querySelector(`[data-ata-benchmark-node="${nodeId}"]`)?.remove();
      }
      for (const element of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
        for (const attribute of [...element.attributes]) {
          const name = attribute.name.toLowerCase();
          if (
            name.startsWith("on") ||
            ["src", "srcset", "style", "nonce", "integrity", "value", "checked", "selected"].includes(name) ||
            /(api[-_]?key|token|secret|authorization|session|customer|visitor|address|postal|zip|google-query-id)/i.test(
              name
            )
          ) {
            element.removeAttribute(attribute.name);
          } else {
            element.setAttribute(attribute.name, redact(attribute.value));
          }
        }
        if (element.hasAttribute("href")) {
          try {
            const url = new URL(element.getAttribute("href") ?? "", location.href);
            element.setAttribute("href", `${url.origin}${url.pathname}`);
          } catch {
            element.removeAttribute("href");
          }
        }
      }
      return clone.outerHTML;
    };

    return {
      mainHtml: sanitize(root),
      candidates: selected.map(({ element, container, groupHint, groupScore }) => {
        const box = element.getBoundingClientRect();
        const link = element.querySelector<HTMLAnchorElement>("a[href]");
        return {
          nodeId: element.getAttribute("data-ata-benchmark-node") ?? "",
          groupHint,
          containerNodeId: container.getAttribute("data-ata-benchmark-node") ?? "",
          groupScore,
          text: visibleText(element),
          html: sanitize(element),
          ...(link?.href ? { href: new URL(link.href, location.href).origin + new URL(link.href, location.href).pathname } : {}),
          box: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          }
        };
      })
    };
  }, maxCards);

  const finalUrl = sanitizeCaptureUrl(page.url());
  const candidates = JSON.parse(
    redactSensitiveCaptureText(JSON.stringify(extracted.candidates))
  ) as CandidateCapture[];
  const sanitizedTarget = {
    ...target,
    url: sanitizeCaptureUrl(target.url)
  };
  const capturedAt = new Date().toISOString();
  const privacyAudit = auditCapturePrivacy({
    urls: [
      { source: "requestedUrl", value: sanitizeCaptureUrl(target.url) },
      { source: "finalUrl", value: finalUrl },
      { source: "observation.url", value: observation.url }
    ],
    texts: [
      { source: "main.html", value: extracted.mainHtml },
      { source: "observation.json", value: JSON.stringify(observation) },
      { source: "candidates", value: JSON.stringify(candidates) }
    ]
  });
  if (!privacyAudit.passed) {
    throw new Error(
      `privacy audit failed: ${privacyAudit.findings
        .map((finding) => `${finding.source}/${finding.category}`)
        .join(", ")}`
    );
  }

  const pageDirectory = path.join(runDirectory, target.pageId);
  const cardsDirectory = path.join(pageDirectory, "cards");
  await mkdir(cardsDirectory, { recursive: true });
  await writeFile(path.join(pageDirectory, "main.html"), extracted.mainHtml, "utf8");
  await writeJson(path.join(pageDirectory, "observation.json"), observation);

  // Consent and promotion layers can mount after the initial page-ready pass.
  // Recheck immediately before screenshots so visual evidence matches the gate.
  dismissedObstructions += await preparePage(page);
  await page.waitForTimeout(250);
  const lateObstructionCoverage = await page
    .evaluate(measureVisibleObstructionCoverage)
    .catch(() => 0);
  unresolvedObstructionCoverage = lateObstructionCoverage;
  if (
    lateObstructionCoverage > 0.2 &&
    !blockReasons.some((reason) =>
      reason.startsWith("unresolved visible obstruction covers")
    )
  ) {
    blockReasons.push(
      `unresolved visible obstruction covers ${Math.round(
        lateObstructionCoverage * 100
      )}% of viewport`
    );
  }

  const mainScreenshotCaptured = await page
    .locator(`[data-ata-benchmark-node="${observation.rootNodeId}"]`)
    .first()
    .screenshot({
      path: path.join(pageDirectory, "main.png"),
      animations: "disabled",
      caret: "hide",
      timeout: 15_000
    })
    .then(() => true)
    .catch(() => false);
  const rootObservation = observation.nodes.find((node) => node.id === observation.rootNodeId);
  const annotationRegion = {
    x: Math.max(0, rootObservation?.bounds.x ?? 0),
    y: Math.max(0, rootObservation?.bounds.y ?? 0),
    width: Math.max(1, rootObservation?.bounds.width ?? observation.viewport.width),
    height: Math.max(1, Math.min(2_400, rootObservation?.bounds.height ?? observation.viewport.height))
  };
  const annotationScreenshotCaptured = await captureAnnotationScreenshot(
    page,
    observation.rootNodeId,
    annotationRegion.height,
    path.join(pageDirectory, "annotation.png")
  );

  if (!mainScreenshotCaptured) {
    blockReasons.push("main screenshot unavailable");
  }
  if (!annotationScreenshotCaptured) {
    blockReasons.push("annotation screenshot unavailable");
  }
  if (candidates.length === 0) {
    blockReasons.push("no reviewable product candidates");
  } else if (Buffer.byteLength(extracted.mainHtml) < 5_000) {
    blockReasons.push("empty or incomplete main content");
  }
  for (const [index, candidate] of candidates.entries()) {
    const prefix = `${String(index + 1).padStart(2, "0")}--${slugify(candidate.nodeId)}`;
    await writeFile(path.join(cardsDirectory, `${prefix}.html`), candidate.html, "utf8");
    await writeJson(path.join(cardsDirectory, `${prefix}.json`), candidate);
  }

  let candidateScreenshotsCaptured = 0;
  const screenshotDeadline = Date.now() + cardScreenshotBudgetMs;
  for (const [index, candidate] of candidates.entries()) {
    const remainingMs = screenshotDeadline - Date.now();
    if (remainingMs <= 0) break;
    const prefix = `${String(index + 1).padStart(2, "0")}--${slugify(candidate.nodeId)}`;
    const locator = page.locator(`[data-ata-benchmark-node="${candidate.nodeId}"]`).first();
    const captured = await locator
      .screenshot({
        path: path.join(cardsDirectory, `${prefix}.png`),
        animations: "disabled",
        caret: "hide",
        timeout: Math.min(5_000, remainingMs)
      })
      .then(() => true)
      .catch(() => false);
    if (captured) candidateScreenshotsCaptured += 1;
  }

  const capture: PageCapture = {
    pageId: target.pageId,
    target: sanitizedTarget,
    capturedAt,
    requestedUrl: sanitizeCaptureUrl(target.url),
    finalUrl,
    navigationAttempts: navigation.attempts,
    title: currentTitle,
    ...(response ? { httpStatus: response.status() } : {}),
    blocked: blockReasons.length > 0,
    blockReasons,
    viewport: page.viewportSize() ?? { width: 1440, height: 1000 },
    redactionCount,
    dismissedObstructions,
    unresolvedObstructionCoverage,
    queryTokenCoverage,
    candidateCount: candidates.length,
    candidateScreenshotsCaptured,
    observationNodeCount: observation.nodes.length,
    observationTruncated: observation.truncated,
    observationSha256: hashJson(observation),
    mainScreenshotCaptured,
    annotationRegion,
    annotationScreenshotCaptured,
    mainHtmlSha256: createHash("sha256").update(extracted.mainHtml).digest("hex"),
    mainHtmlBytes: Buffer.byteLength(extracted.mainHtml)
  };

  const annotation: CorpusAnnotation = {
    version: LIVE_CORPUS_VERSION,
    pageId: target.pageId,
    reviewStatus: "unreviewed",
    coverage: "unreviewed",
    region: annotationRegion,
    annotators: [],
    products: []
  };

  await writeJson(path.join(pageDirectory, "page.json"), capture);
  await writeJson(path.join(pageDirectory, "annotation.json"), annotation);
  await writeCaptureProvenance(pageDirectory, {
    pageId: target.pageId,
    createdAt: capturedAt,
    sourceManifestSha256,
    collectorSha256
  });
  return capture;
}

async function preparePage(page: Page): Promise<number> {
  let dismissed = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let dismissedThisAttempt = 0;
    for (const frame of page.frames()) {
      const frameDismissed = await frame.evaluate(dismissVisibleObstruction).catch(() => false);
      if (frameDismissed) dismissedThisAttempt += 1;
    }
    if (dismissedThisAttempt === 0) break;
    dismissed += dismissedThisAttempt;
    await page.waitForTimeout(350);
  }
  return dismissed;
}

async function captureAnnotationScreenshot(
  page: Page,
  rootNodeId: string,
  height: number,
  outputPath: string
): Promise<boolean> {
  const root = page.locator(`[data-ata-benchmark-node="${rootNodeId}"]`).first();
  const originalStyle = await root.getAttribute("style").catch(() => null);
  try {
    await root.evaluate((element, regionHeight) => {
      element.style.setProperty("max-height", `${regionHeight}px`, "important");
      element.style.setProperty("overflow", "hidden", "important");
    }, height);
    await root.screenshot({
      path: outputPath,
      animations: "disabled",
      caret: "hide",
      timeout: 15_000
    });
    return true;
  } catch {
    return false;
  } finally {
    await root
      .evaluate((element, style) => {
        if (style === null) {
          element.removeAttribute("style");
        } else {
          element.setAttribute("style", style);
        }
      }, originalStyle)
      .catch(() => undefined);
  }
}

function parseOptions(args: string[]): CollectorOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--headed") {
      flags.add(arg);
      continue;
    }
    if (arg === "--disable-http2") {
      flags.add(arg);
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    values.set(arg, value);
    index += 1;
  }

  const limit = values.has("--limit") ? Number.parseInt(values.get("--limit")!, 10) : undefined;
  const perSite = values.has("--per-site") ? Number.parseInt(values.get("--per-site")!, 10) : undefined;
  const maxCards = Number.parseInt(values.get("--max-cards") ?? "12", 10);
  const delayMs = Number.parseInt(values.get("--delay-ms") ?? "2000", 10);
  const seed = Number.parseInt(values.get("--seed") ?? "20260722", 10);
  const pageTimeoutMs = Number.parseInt(
    values.get("--page-timeout-ms") ?? "120000",
    10
  );
  const cardScreenshotBudgetMs = Number.parseInt(
    values.get("--card-screenshot-budget-ms") ?? "15000",
    10
  );
  const viewportMode = values.get("--viewport") ?? "mixed";
  const narrowShare = Number.parseFloat(values.get("--narrow-share") ?? "0.25");
  const siteIds = parseCsv(values.get("--sites") ?? "");
  const pageIds = parseCsv(values.get("--pages") ?? "");

  if (
    (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) ||
    (perSite !== undefined && (!Number.isFinite(perSite) || perSite <= 0)) ||
    maxCards <= 0 ||
    delayMs < 0 ||
    !Number.isFinite(pageTimeoutMs) ||
    pageTimeoutMs < 30_000 ||
    !Number.isFinite(cardScreenshotBudgetMs) ||
    cardScreenshotBudgetMs < 0 ||
    cardScreenshotBudgetMs > pageTimeoutMs / 2 ||
    !["desktop", "narrow", "mixed"].includes(viewportMode) ||
    !Number.isFinite(narrowShare) ||
    narrowShare < 0 ||
    narrowShare > 1
  ) {
    throw new Error("Invalid numeric collector option.");
  }
  if (
    pageIds.length > 0 &&
    (siteIds.length > 0 || limit !== undefined || perSite !== undefined)
  ) {
    throw new Error("--pages cannot be combined with --sites, --limit, or --per-site.");
  }

  return {
    targetsPath: path.resolve(values.get("--targets") ?? "benchmarks/live-sites/targets.json"),
    outputRoot: path.resolve(values.get("--output") ?? "benchmark-data/live"),
    headed: flags.has("--headed"),
    disableHttp2: flags.has("--disable-http2"),
    ...(limit === undefined ? {} : { limit }),
    ...(perSite === undefined ? {} : { perSite }),
    seed,
    maxCards,
    delayMs,
    pageTimeoutMs,
    cardScreenshotBudgetMs,
    viewportMode: viewportMode as CaptureViewportProfile | "mixed",
    narrowShare,
    siteIds,
    pageIds
  };
}

function parseCsv(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashJson(value: PageObservation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
