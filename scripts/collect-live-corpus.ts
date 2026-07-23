import { chromium, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { capturePageObservation } from "../src/learning/page-observation";
import {
  LIVE_CORPUS_VERSION,
  expandTargets,
  selectTargets,
  slugify,
  type CaptureTarget,
  type CorpusAnnotation,
  type CorpusTargetManifest
} from "./live-corpus-lib";

interface CollectorOptions {
  targetsPath: string;
  outputRoot: string;
  headed: boolean;
  limit?: number;
  perSite?: number;
  seed: number;
  maxCards: number;
  delayMs: number;
  siteIds: string[];
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
  title: string;
  httpStatus?: number;
  blocked: boolean;
  blockReasons: string[];
  viewport: { width: number; height: number };
  redactionCount: number;
  candidateCount: number;
  observationNodeCount: number;
  observationTruncated: boolean;
  observationSha256: string;
  mainScreenshotCaptured: boolean;
  mainHtmlSha256: string;
  mainHtmlBytes: number;
}

const options = parseOptions(process.argv.slice(2));
const manifest = JSON.parse(await readFile(options.targetsPath, "utf8")) as CorpusTargetManifest;
const allTargets = expandTargets(manifest);
const targets = selectTargets(allTargets, {
  seed: options.seed,
  ...(options.limit === undefined ? {} : { limit: options.limit }),
  ...(options.perSite === undefined ? {} : { perSite: options.perSite }),
  ...(options.siteIds.length === 0 ? {} : { siteIds: options.siteIds })
});

if (targets.length === 0) {
  throw new Error("No capture targets matched the supplied options.");
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDirectory = path.join(options.outputRoot, runId);
await mkdir(runDirectory, { recursive: true });

const browser = await chromium.launch({ headless: !options.headed });
const context = await browser.newContext({
  locale: "en-US",
  timezoneId: "America/Denver",
  viewport: { width: 1440, height: 1000 },
  colorScheme: "light"
});

const runResults: Array<{ pageId: string; status: "captured" | "blocked" | "error"; message?: string }> = [];

try {
  for (const [index, target] of targets.entries()) {
    process.stdout.write(`[${index + 1}/${targets.length}] ${target.siteLabel}: ${target.query}\n`);
    const page = await context.newPage();

    try {
      const capture = await capturePage(page, target, runDirectory, options.maxCards);
      runResults.push({
        pageId: target.pageId,
        status: capture.blocked ? "blocked" : "captured",
        ...(capture.blockReasons.length === 0 ? {} : { message: capture.blockReasons.join("; ") })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runResults.push({ pageId: target.pageId, status: "error", message });
      process.stderr.write(`  capture failed: ${message}\n`);
    } finally {
      await page.close();
    }

    if (options.delayMs > 0 && index < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }
} finally {
  await context.close();
  await browser.close();
}

const runManifest = {
  version: LIVE_CORPUS_VERSION,
  runId,
  createdAt: new Date().toISOString(),
  sourceManifest: path.relative(process.cwd(), options.targetsPath),
  anonymousContext: true,
  seed: options.seed,
  requestedPages: targets.length,
  capturedPages: runResults.filter((result) => result.status === "captured").length,
  blockedPages: runResults.filter((result) => result.status === "blocked").length,
  failedPages: runResults.filter((result) => result.status === "error").length,
  results: runResults
};

await writeJson(path.join(runDirectory, "run.json"), runManifest);
process.stdout.write(`Corpus run written to ${runDirectory}\n`);

async function capturePage(
  page: Page,
  target: CaptureTarget,
  runDirectory: string,
  maxCards: number
): Promise<PageCapture> {
  const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(1_500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(750);

  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 5_000 })
    .catch(() => "");
  const blockReasons: string[] = [];
  if (response && response.status() >= 400) {
    blockReasons.push(`HTTP ${response.status()}`);
  }
  if (
    /\b(access denied|verify you are human|captcha|robot check|robot or human|unusual traffic|activate and hold)\b/i.test(
      bodyText
    )
  ) {
    blockReasons.push("interstitial or bot challenge");
  }

  const redactionCount = await page.evaluate(() => {
    const root =
      document.querySelector<HTMLElement>("main, [role='main'], #main, #content") ??
      document.body;
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
        .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED PHONE]");
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

    return count;
  });

  const observation = await page.evaluate(capturePageObservation, {
    pageId: target.pageId,
    maxNodes: 20_000
  });

  const extracted = await page.evaluate((candidateLimit) => {
    const root =
      document.querySelector<HTMLElement>("main, [role='main'], #main, #content") ??
      document.body;

    const allElements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    for (const [index, element] of allElements.entries()) {
      element.dataset.ataBenchmarkNode = `n${index}`;
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
      if (element.querySelector("a[href]")) value += 2;
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

    for (const [groupIndex, group] of groupEntries.entries()) {
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
          .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED PHONE]");
      const hiddenNodeIds = [source, ...source.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.matches("dialog:not([open]), [hidden]") ||
            style.display === "none" ||
            style.visibility === "hidden"
          );
        })
        .map((element) => element.dataset.ataBenchmarkNode)
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
          nodeId: element.dataset.ataBenchmarkNode ?? "",
          groupHint,
          containerNodeId: container.dataset.ataBenchmarkNode ?? "",
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

  const pageDirectory = path.join(runDirectory, target.pageId);
  const cardsDirectory = path.join(pageDirectory, "cards");
  await mkdir(cardsDirectory, { recursive: true });
  await writeFile(path.join(pageDirectory, "main.html"), extracted.mainHtml, "utf8");
  await writeJson(path.join(pageDirectory, "observation.json"), observation);

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

  const candidates: CandidateCapture[] = extracted.candidates;
  if (Buffer.byteLength(extracted.mainHtml) < 5_000 && candidates.length === 0) {
    blockReasons.push("empty or incomplete main content");
  }
  for (const [index, candidate] of candidates.entries()) {
    const prefix = `${String(index + 1).padStart(2, "0")}--${slugify(candidate.nodeId)}`;
    await writeFile(path.join(cardsDirectory, `${prefix}.html`), candidate.html, "utf8");
    await writeJson(path.join(cardsDirectory, `${prefix}.json`), candidate);

    const locator = page.locator(`[data-ata-benchmark-node="${candidate.nodeId}"]`).first();
    await locator
      .screenshot({
        path: path.join(cardsDirectory, `${prefix}.png`),
        animations: "disabled",
        timeout: 8_000
      })
      .catch(() => undefined);
  }

  const capture: PageCapture = {
    pageId: target.pageId,
    target,
    capturedAt: new Date().toISOString(),
    requestedUrl: target.url,
    finalUrl: page.url(),
    title: await page.title(),
    ...(response ? { httpStatus: response.status() } : {}),
    blocked: blockReasons.length > 0,
    blockReasons,
    viewport: page.viewportSize() ?? { width: 1440, height: 1000 },
    redactionCount,
    candidateCount: candidates.length,
    observationNodeCount: observation.nodes.length,
    observationTruncated: observation.truncated,
    observationSha256: hashJson(observation),
    mainScreenshotCaptured,
    mainHtmlSha256: createHash("sha256").update(extracted.mainHtml).digest("hex"),
    mainHtmlBytes: Buffer.byteLength(extracted.mainHtml)
  };

  const annotation: CorpusAnnotation = {
    version: LIVE_CORPUS_VERSION,
    pageId: target.pageId,
    reviewStatus: "unreviewed",
    annotators: [],
    products: []
  };

  await writeJson(path.join(pageDirectory, "page.json"), capture);
  await writeJson(path.join(pageDirectory, "annotation.json"), annotation);
  return capture;
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

  if (
    (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) ||
    (perSite !== undefined && (!Number.isFinite(perSite) || perSite <= 0)) ||
    maxCards <= 0 ||
    delayMs < 0
  ) {
    throw new Error("Invalid numeric collector option.");
  }

  return {
    targetsPath: path.resolve(values.get("--targets") ?? "benchmarks/live-sites/targets.json"),
    outputRoot: path.resolve(values.get("--output") ?? "benchmark-data/live"),
    headed: flags.has("--headed"),
    ...(limit === undefined ? {} : { limit }),
    ...(perSite === undefined ? {} : { perSite }),
    seed,
    maxCards,
    delayMs,
    siteIds: (values.get("--sites") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashJson(value: PageObservation): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
