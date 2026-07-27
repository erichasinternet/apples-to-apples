import type { Locator, Page, Response } from "@playwright/test";

export interface ObservationNavigationOptions {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export interface ObservationNavigationResult {
  response: Response | null;
  attempts: number;
}

export interface SemanticSearchSubmissionResult {
  submitted: boolean;
  openedSearch: boolean;
  selector?: string;
}

const TRANSIENT_NAVIGATION_ERROR =
  /\b(ERR_HTTP2_PROTOCOL_ERROR|ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|Timeout)\b/i;
const SEARCH_INPUT_SELECTORS = [
  "input[type='search']",
  "[role='searchbox']",
  "[role='search'] input:not([type='hidden'])",
  "form[role='search'] input:not([type='hidden'])",
  "form[action*='search' i] input:not([type='hidden'])",
  "input[name*='search' i]",
  "input[aria-label*='search' i]",
  "input[placeholder*='search' i]"
] as const;
const SEARCH_TOGGLE_SELECTORS = [
  "button[aria-label*='search' i]",
  "[role='button'][aria-label*='search' i]",
  "button[title*='search' i]",
  "a[aria-label*='search' i]"
] as const;

export async function navigateForObservation(
  page: Page,
  url: string,
  options: ObservationNavigationOptions = {}
): Promise<ObservationNavigationResult> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 45_000;
  const retryDelayMs = options.retryDelayMs ?? 750;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      });
      return { response, attempts: attempt };
    } catch (error) {
      if (attempt === attempts || !isTransientNavigationError(error)) {
        if (attempt === attempts && isTransientNavigationError(error)) {
          throw new Error(
            `Navigation failed after ${attempt} attempts: ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error }
          );
        }
        throw error;
      }
      await page.goto("about:blank", { waitUntil: "commit", timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(retryDelayMs * attempt);
    }
  }

  throw new Error("Observation navigation exhausted without a result.");
}

export function isTransientNavigationError(error: unknown): boolean {
  return TRANSIENT_NAVIGATION_ERROR.test(error instanceof Error ? error.message : String(error));
}

export function shouldAttemptSemanticSearchRoute(
  httpStatus: number | undefined,
  queryTokenCoverage: number
): boolean {
  return (httpStatus !== undefined && httpStatus >= 400) || queryTokenCoverage < 1;
}

export async function submitSemanticSearch(
  page: Page,
  query: string
): Promise<SemanticSearchSubmissionResult> {
  let openedSearch = false;
  let input = await firstUsableLocator(page, SEARCH_INPUT_SELECTORS, true);

  if (!input) {
    const toggle = await firstUsableLocator(
      page,
      SEARCH_TOGGLE_SELECTORS,
      false
    );
    if (toggle) {
      await toggle.locator.click();
      openedSearch = true;
      await page.waitForTimeout(250);
      input = await firstUsableLocator(page, SEARCH_INPUT_SELECTORS, true);
    }
  }

  if (!input) return { submitted: false, openedSearch };

  await input.locator.fill(query);
  await input.locator.press("Enter");
  await page.waitForTimeout(750);
  return {
    submitted: true,
    openedSearch,
    selector: input.selector
  };
}

async function firstUsableLocator(
  page: Page,
  selectors: readonly string[],
  requireEditable: boolean
): Promise<{ locator: Locator; selector: string } | undefined> {
  for (const selector of selectors) {
    const locators = await page.locator(selector).all();
    for (const locator of locators) {
      const usable =
        (await locator.isVisible().catch(() => false)) &&
        (await locator.isEnabled().catch(() => false)) &&
        (!requireEditable ||
          (await locator.isEditable().catch(() => false)));
      if (usable) return { locator, selector };
    }
  }
  return undefined;
}
