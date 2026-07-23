import type { Page } from "@playwright/test";
import {
  isTransientNavigationError,
  navigateForObservation
} from "../../src/learning/page-navigation";

describe("observation navigation", () => {
  it("retries transient transport failures and reports the attempt count", async () => {
    const response = { status: () => 200 };
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("net::ERR_HTTP2_PROTOCOL_ERROR"))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(response),
      waitForTimeout: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page;

    const result = await navigateForObservation(page, "https://shop.example/search", {
      retryDelayMs: 0
    });

    expect(result).toEqual({ response, attempts: 2 });
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      "about:blank",
      expect.objectContaining({ waitUntil: "commit" })
    );
  });

  it("does not retry deterministic navigation failures", async () => {
    const page = {
      goto: vi.fn().mockRejectedValue(new Error("net::ERR_NAME_NOT_RESOLVED")),
      waitForTimeout: vi.fn()
    } as unknown as Page;

    await expect(
      navigateForObservation(page, "https://missing.example", { retryDelayMs: 0 })
    ).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(isTransientNavigationError(new Error("Timeout 45000ms exceeded"))).toBe(true);
  });

  it("reports when all transient attempts are exhausted", async () => {
    const page = {
      goto: vi
        .fn()
        .mockRejectedValue(new Error("net::ERR_HTTP2_PROTOCOL_ERROR")),
      waitForTimeout: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page;

    await expect(
      navigateForObservation(page, "https://shop.example/search", {
        attempts: 2,
        retryDelayMs: 0
      })
    ).rejects.toThrow("Navigation failed after 2 attempts");
  });
});
