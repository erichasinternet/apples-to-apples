import type { Page, Response } from "@playwright/test";

export interface ObservationNavigationOptions {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export interface ObservationNavigationResult {
  response: Response | null;
  attempts: number;
}

const TRANSIENT_NAVIGATION_ERROR =
  /\b(ERR_HTTP2_PROTOCOL_ERROR|ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_TIMED_OUT|Timeout)\b/i;

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
