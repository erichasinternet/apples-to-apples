import {
  test as base,
  chromium,
  expect,
  type BrowserContext,
  type Page,
  type Response
} from "@playwright/test";
import path from "node:path";

const extensionPath = path.join(process.cwd(), "dist");
const runLive = process.env.LIVE_SHOPPING_TESTS === "1";

const live = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  }
});

live.skip(!runLive, "Set LIVE_SHOPPING_TESTS=1 to run live retailer smoke tests.");

const targets = [
  ["Walmart cat litter", "https://www.walmart.com/search?q=cat+litter", ["cat", "litter"]],
  ["Amazon laundry detergent", "https://www.amazon.com/s?k=laundry+detergent", ["laundry", "detergent"]],
  ["Target coffee pods", "https://www.target.com/s?searchTerm=coffee+pods", ["coffee", "pods"]],
  ["Chewy cat food", "https://www.chewy.com/s?query=cat%20food", ["cat", "food"]],
  ["Petco dog food", "https://www.petco.com/shop/en/petcostore/search?query=dog%20food", ["dog", "food"]],
  ["Walgreens vitamins", "https://www.walgreens.com/search/results.jsp?Ntt=vitamins", ["vitamins"]],
  ["CVS paper towels", "https://www.cvs.com/search?searchTerm=paper%20towels", ["paper", "towels"]],
  ["Home Depot trash bags", "https://www.homedepot.com/s/trash%20bags", ["trash", "bags"]],
  ["Lowes air filters", "https://www.lowes.com/search?searchTerm=air+filters", ["air", "filters"]],
  ["Staples printer paper", "https://www.staples.com/printer-paper/cat_CL140557", ["printer", "paper"]],
  ["Costco coffee", "https://www.costco.com/CatalogSearch?keyword=coffee", ["coffee"]],
  ["Sam's Club detergent", "https://www.samsclub.com/s/laundry%20detergent", ["laundry", "detergent"]]
] as const;

for (const [name, url, expectedTerms] of targets) {
  live(`${name} live smoke`, async ({ page }) => {
    const availability = await openLiveListing(page, url, expectedTerms);
    if (availability.unavailableReason) {
      console.info(`[live unavailable] ${name}: ${availability.unavailableReason}`);
      live.skip(true, availability.unavailableReason);
    }

    const comparisonState = await waitForComparableItems(page);
    if (comparisonState.unavailableReason) {
      console.info(`[live unavailable] ${name}: ${comparisonState.unavailableReason}`);
      live.skip(true, comparisonState.unavailableReason);
    }
    expect(comparisonState.count).toBeGreaterThan(1);
    await expect(page.locator("#ata-panel-root, [data-ata-sort-control]")).toHaveCount(0);
    console.info(
      `[live validated] ${name}: ${await page.locator("[data-ata-product]").count()} comparable items, ${await page.locator("[data-ata-badge]").count()} added lines`
    );
  });
}

live("Micro Center laptop specifications do not become unit prices", async ({
  page
}) => {
  live.setTimeout(60_000);
  const availability = await openLiveListing(
    page,
    "https://www.microcenter.com/search/search_results.aspx?fq=category:Laptops%2FNotebooks|618,GPU+Type:NVIDIA+GeForce+RTX+5070+OR+NVIDIA+GeForce+RTX+5080+OR+NVIDIA+GeForce+RTX+5070+Ti+OR+NVIDIA+GeForce+RTX+5090&sortby=pricelow",
    ["laptops", "notebooks"]
  );
  if (availability.unavailableReason) {
    console.info(
      `[live unavailable] Micro Center laptops: ${availability.unavailableReason}`
    );
    live.skip(true, availability.unavailableReason);
  }

  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-ata-product], [data-ata-badge]")).toHaveCount(
    0
  );
  await expect(page.locator("option[data-ata-sort-option]")).toHaveCount(0);
});

live("Walmart unit-price sort is a full native-menu row and reorders comparable cards", async ({
  page
}) => {
  live.setTimeout(60_000);
  const availability = await openLiveListing(
    page,
    "https://www.walmart.com/search?q=kitty+litter&facet=fulfillment_method%3ADelivery",
    ["kitty", "litter"]
  );
  if (availability.unavailableReason) {
    console.info(`[live unavailable] Walmart sort: ${availability.unavailableReason}`);
    live.skip(true, availability.unavailableReason);
  }

  const comparisonState = await waitForComparableItems(page);
  if (comparisonState.unavailableReason) {
    console.info(`[live unavailable] Walmart sort: ${comparisonState.unavailableReason}`);
    live.skip(true, comparisonState.unavailableReason);
  }
  expect(comparisonState.count).toBeGreaterThan(1);
  await expect(page.locator("#ata-panel-root, [data-ata-sort-control]")).toHaveCount(0);

  const trigger = page
    .locator("button, [role='button'], [role='combobox']")
    .filter({ hasText: /sort\s*by/i })
    .first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const option = page
    .locator("[data-ata-custom-sort-option][data-ata-compare-key='mass:lb']")
    .first();
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute("aria-label", "Unit price per lb: low to high");

  const geometry = await option.evaluate((element) => {
    const parent = element.parentElement;
    const previous = element.previousElementSibling;
    const row = element.getBoundingClientRect();
    const menu = parent?.getBoundingClientRect();
    const previousRow = previous?.getBoundingClientRect();
    return {
      display: getComputedStyle(element).display,
      leftDelta: menu ? Math.abs(row.left - menu.left) : Number.NaN,
      widthDelta: menu ? Math.abs(row.width - menu.width) : Number.NaN,
      previousText: (previous?.textContent || "").replace(/\s+/g, " ").trim(),
      followsPreviousRow: previousRow ? row.top >= previousRow.bottom - 1 : false
    };
  });
  expect(geometry.display).toBe("block");
  expect(geometry.leftDelta).toBeLessThanOrEqual(1);
  expect(geometry.widthDelta).toBeLessThanOrEqual(2);
  expect(geometry.previousText).toMatch(/new\s+arrivals/i);
  expect(geometry.followsPreviousRow).toBe(true);

  const before = await readComparableUnitGroups(page);
  expect(before.some((group) => group.values.length >= 2)).toBe(true);
  await option.click();
  const after = await readComparableUnitGroups(page);

  for (const group of after.filter((candidate) => candidate.values.length >= 2)) {
    expect(group.values).toEqual([...group.values].sort((left, right) => left - right));
  }
  expect(after).not.toEqual(before);
});

interface LiveAvailability {
  responseStatus: number | null;
  unavailableReason?: string;
}

async function waitForComparableItems(
  page: Page,
  timeoutMs = 20_000
): Promise<{ count: number; unavailableReason?: string }> {
  const deadline = Date.now() + timeoutMs;
  let count = 0;

  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => ({
        url: location.href,
        title: document.title,
        bodyText: (document.body?.innerText || "").slice(0, 5_000),
        count: document.querySelectorAll("[data-ata-product]").length
      }))
      .catch(() => undefined);

    if (state) {
      count = state.count;
      const blockText = `${state.title} ${state.bodyText}`;
      if (
        state.url.includes("/blocked") ||
        /\b(robot or human|activate and hold|access denied|captcha)\b/i.test(blockText)
      ) {
        return {
          count,
          unavailableReason: state.title || "retailer blocked page"
        };
      }

      if (count > 1) {
        return { count };
      }
    }

    await page.waitForTimeout(500);
  }

  return { count };
}

async function openLiveListing(
  page: Page,
  url: string,
  expectedTerms: readonly string[]
): Promise<LiveAvailability> {
  let response: Response | null = null;
  let navigationError: string | undefined;

  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
  } catch (error) {
    navigationError = String(error);
  }

  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.mouse.wheel(0, 1200).catch(() => undefined);
  await page.waitForTimeout(1_000);

  const pageState = await page
    .evaluate(() => {
      const bodyText = document.body?.innerText || "";
      return {
        url: location.href,
        title: document.title,
        bodyText: bodyText.slice(0, 15_000),
        bodyTextLength: bodyText.length,
        priceSignals: (bodyText.match(/\$\s*\d/g) || []).length,
        links: document.links.length
      };
    })
    .catch(() => undefined);
  const status = response?.status() ?? null;
  const unavailableReason = classifyUnavailablePage(status, navigationError, pageState, expectedTerms);

  return {
    responseStatus: status,
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

function classifyUnavailablePage(
  status: number | null,
  navigationError: string | undefined,
  pageState:
    | {
        url: string;
        title: string;
        bodyText: string;
        bodyTextLength: number;
        priceSignals: number;
        links: number;
      }
    | undefined,
  expectedTerms: readonly string[]
): string | undefined {
  if (navigationError && !pageState) {
    return `navigation failed: ${navigationError.split("\n")[0]}`;
  }
  if (status !== null && status >= 400) {
    return `HTTP ${status}: ${pageState?.title || "unavailable"}`;
  }

  const unavailableText = `${pageState?.title || ""} ${pageState?.bodyText || ""}`;
  if (pageState?.url.includes("/blocked")) {
    return pageState.title || "retailer blocked page";
  }
  if (
    /\b(access denied|restricted access|robot or human|page not found|error page|something went wrong|captcha)\b/i.test(
      unavailableText
    )
  ) {
    return pageState?.title || "retailer error page";
  }
  if (
    navigationError ||
    !pageState ||
    (pageState.bodyTextLength < 500 && pageState.priceSignals === 0 && pageState.links < 4)
  ) {
    return navigationError
      ? `navigation did not produce a shopping page: ${navigationError.split("\n")[0]}`
      : "retailer did not render a product listing";
  }

  const renderedText = `${pageState.title} ${pageState.bodyText}`.toLocaleLowerCase();
  const missingTerms = expectedTerms.filter((term) => !renderedText.includes(term.toLocaleLowerCase()));
  if (missingTerms.length > 0) {
    return `requested listing did not render (missing: ${missingTerms.join(", ")})`;
  }

  return undefined;
}

async function readComparableUnitGroups(
  page: Page
): Promise<Array<{ key: string; values: number[] }>> {
  return await page.locator("[data-ata-product]").evaluateAll((badges) => {
    const groups = new Map<string, number[]>();
    for (const badge of badges) {
      if (!(badge instanceof HTMLElement)) {
        continue;
      }
      const value = Number(badge.dataset.ataCentsPerUnit);
      const dimension = badge.dataset.ataDimension;
      const unit = badge.dataset.ataUnit;
      if (!Number.isFinite(value) || !dimension || !unit) {
        continue;
      }
      const key = `${dimension}:${unit}`;
      const values = groups.get(key) ?? [];
      values.push(value);
      groups.set(key, values);
    }
    return [...groups.entries()].map(([key, values]) => ({ key, values }));
  });
}
