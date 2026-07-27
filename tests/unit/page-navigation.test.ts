import type { Page } from "@playwright/test";
import {
  isTransientNavigationError,
  navigateForObservation,
  shouldAttemptSemanticSearchRoute,
  submitSemanticSearch
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

  it("submits through the first visible editable semantic search control", async () => {
    const search = mockLocator();
    const page = {
      locator: vi.fn((selector: string) => ({
        all: vi
          .fn()
          .mockResolvedValue(selector === "input[type='search']" ? [search] : [])
      })),
      waitForTimeout: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page;

    await expect(submitSemanticSearch(page, "cat litter")).resolves.toEqual({
      submitted: true,
      openedSearch: false,
      selector: "input[type='search']"
    });
    expect(search.fill).toHaveBeenCalledWith("cat litter");
    expect(search.press).toHaveBeenCalledWith("Enter");
  });

  it("opens an accessible search toggle before retrying semantic inputs", async () => {
    let opened = false;
    const search = mockLocator();
    const toggle = mockLocator({
      editable: false,
      click: () => {
        opened = true;
      }
    });
    const page = {
      locator: vi.fn((selector: string) => ({
        all: vi.fn().mockImplementation(async () => {
          if (
            selector === "input[type='search']" &&
            opened
          ) {
            return [search];
          }
          if (
            selector === "button[aria-label*='search' i]" &&
            !opened
          ) {
            return [toggle];
          }
          return [];
        })
      })),
      waitForTimeout: vi.fn().mockResolvedValue(undefined)
    } as unknown as Page;

    await expect(submitSemanticSearch(page, "printer paper")).resolves.toEqual({
      submitted: true,
      openedSearch: true,
      selector: "input[type='search']"
    });
    expect(toggle.click).toHaveBeenCalledOnce();
    expect(search.fill).toHaveBeenCalledWith("printer paper");
  });

  it("does not type into an ordinary text input without search semantics", async () => {
    const page = {
      locator: vi.fn(() => ({
        all: vi.fn().mockResolvedValue([])
      })),
      waitForTimeout: vi.fn()
    } as unknown as Page;

    await expect(submitSemanticSearch(page, "rice")).resolves.toEqual({
      submitted: false,
      openedSearch: false
    });
  });

  it("limits semantic route recovery to HTTP failures or incomplete query evidence", () => {
    expect(shouldAttemptSemanticSearchRoute(200, 1)).toBe(false);
    expect(shouldAttemptSemanticSearchRoute(undefined, 1)).toBe(false);
    expect(shouldAttemptSemanticSearchRoute(404, 1)).toBe(true);
    expect(shouldAttemptSemanticSearchRoute(200, 0.5)).toBe(true);
  });
});

function mockLocator(options?: {
  editable?: boolean;
  click?: () => void;
}) {
  return {
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    isEditable: vi.fn().mockResolvedValue(options?.editable ?? true),
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockImplementation(async () => options?.click?.())
  };
}
