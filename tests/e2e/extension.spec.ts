import { test as base, chromium, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const extensionPath = path.join(process.cwd(), "dist");

const test = base.extend<{ context: BrowserContext }>({
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

test("annotates a local shopping grid with unit-price badges and no floating panel", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  await expect(page.locator("[data-ata-badge]")).toHaveCount(4);
  await expect(page.locator("[data-ata-badge]").filter({ hasText: "22.9¢/lb" })).toBeVisible();
  await expect(page.locator("[data-ata-badge]").filter({ hasText: "12¢/fl oz" })).toBeVisible();
  await expect(page.locator("[data-ata-badge]").filter({ hasText: "22.9¢/lb" })).toHaveAttribute(
    "data-ata-dimension",
    "mass"
  );
  await expect(page.locator("[data-ata-badge]").filter({ hasText: "22.9¢/lb" })).toHaveAttribute(
    "data-ata-unit",
    "lb"
  );
  await expect(page.locator("#ata-panel-root")).toHaveCount(0);
  await expect(page.getByLabel("Sort by")).toContainText("Unit price: low to high");
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
});

test("removes stale panel and medium labels left by an older build", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const panel = document.createElement("div");
        panel.id = "ata-panel-root";
        panel.dataset.ataPanelRoot = "true";
        panel.textContent = "Unit prices 48 visible medium";
        document.documentElement.append(panel);

        const firstCard = document.querySelector(".product-card");
        const staleBadge = document.createElement("div");
        staleBadge.dataset.ataBadge = "true";
        staleBadge.innerHTML = `
          <span class="ata-badge-main">old</span>
          <span class="ata-badge-confidence">medium</span>
          <span class="ata-evidence-strip"></span>
        `;
        firstCard?.append(staleBadge);
      },
      { once: true }
    );
  });

  await page.goto("http://127.0.0.1:4173/");

  await expect(page.locator("#ata-panel-root")).toHaveCount(0);
  const badgeText = (await page.locator("[data-ata-badge]").allTextContents()).join(" ");
  expect(badgeText).not.toContain("medium");
  await expect(page.locator("[data-ata-badge]").first()).not.toContainText("old");
});

test("sorts visible comparable cards by unit price and restores retailer order", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  const productTitles = page.locator(".product-card h2");
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");

  await page.getByLabel("Sort by").selectOption("ata-unit-price-asc");
  await expect(productTitles.first()).toContainText("Special Kitty Non-Clumping");

  await page.getByLabel("Sort by").selectOption("relevance");
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
});

test("does not add a separate sort component when the retailer has no visible sort control", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/no-sort.html");

  const hiddenSort = page.locator("select[aria-label='Sort by']");
  const productTitles = page.locator(".product-card h2");

  await expect(hiddenSort).toBeHidden();
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await page.waitForTimeout(1800);
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
});

test("auto-runs the conservative generic extractor on an unfamiliar host", async ({ page }) => {
  const fixture = readFileSync(
    path.join(process.cwd(), "tests", "fixtures", "generic-shopping-grid.html"),
    "utf8"
  );
  await page.route("https://unknown-shop.example/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixture })
  );

  await page.goto("https://unknown-shop.example/search?q=household");

  await expect(page.locator("[data-ata-badge]")).toHaveCount(3);
  await expect(page.locator("[data-ata-badge][data-ata-dimension='volume']")).toBeVisible();
  await expect(page.locator("[data-ata-badge][data-ata-dimension='area']")).toBeVisible();
  await expect(
    page.locator("article", { hasText: "Snack variety box" }).locator("[data-ata-badge]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
});

test("adds unit-price sort inside custom retailer sort menus without showing inline fallback", async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const staleSort = document.createElement("div");
        staleSort.dataset.ataSortControl = "true";
        staleSort.textContent = "Sort by unit price";
        document.querySelector("main")?.prepend(staleSort);

        const unrelatedPriceDropdown = document.createElement("div");
        unrelatedPriceDropdown.className = "filter-dropdown";
        unrelatedPriceDropdown.textContent = "Price Low to High High to Low";
        document.querySelector("main")?.prepend(unrelatedPriceDropdown);
      },
      { once: true }
    );
  });

  await page.goto("http://127.0.0.1:4173/custom-sort.html");

  const productTitles = page.locator(".product-card h2");

  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
  await expect(page.locator("[data-ata-custom-sort-option]")).toHaveCount(0);
  await expect(page.locator(".filter-dropdown [data-ata-custom-sort-option]")).toHaveCount(0);
  await page.waitForTimeout(1800);
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
  await expect(page.locator("[data-ata-custom-sort-option]")).toHaveCount(0);

  await page.getByRole("button", { name: "Sort by: Relevance" }).click();
  const unitSortOption = page.locator("[data-ata-custom-sort-option]");
  await expect(unitSortOption).toBeVisible();
  await expect(unitSortOption).toHaveText("Unit price: low to high");
  await expect(page.locator(".filter-dropdown [data-ata-custom-sort-option]")).toHaveCount(0);

  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await unitSortOption.click();
  await expect(productTitles.first()).toContainText("Special Kitty Non-Clumping");
});

test("adds unit-price sort to Walmart-style label-only sort popovers", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/walmart-label-sort.html");

  const productTitles = page.locator(".product-card h2");

  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
  await page.getByRole("button", { name: "Sort by Best Match" }).click();

  const unitSortOption = page.locator("[data-ata-custom-sort-option]");
  const lastRetailerSortOption = page.locator(".sort-row").filter({ hasText: "Icon Sort by New Arrivals" });
  await expect(unitSortOption).toBeVisible();
  await expect(unitSortOption).toHaveClass(/ata-custom-sort-option/);
  await expect(unitSortOption.locator("label")).toHaveText("Unit price: low to high");
  await expect(unitSortOption).toHaveAttribute("title", "Unit price: low to high");
  await expect(unitSortOption).toHaveJSProperty("tagName", "DIV");
  await expect(lastRetailerSortOption).toHaveText("Icon Sort by New Arrivals");
  await expect(lastRetailerSortOption).not.toContainText("Unit price");
  await expect(unitSortOption.locator(".sort-row-shell")).toHaveCount(0);

  const rowDisplay = await unitSortOption.evaluate((element) => getComputedStyle(element).display);
  expect(rowDisplay).toBe("block");
  const rowLayout = await unitSortOption.evaluate((element) => {
    const parent = element.parentElement;
    if (!parent) {
      return { leftDelta: Number.NaN, widthDelta: Number.NaN, top: 0, previousBottom: 0 };
    }

    const rowRect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const previousRect = element.previousElementSibling?.getBoundingClientRect();
    return {
      leftDelta: Math.abs(rowRect.left - parentRect.left),
      widthDelta: Math.abs(rowRect.width - parentRect.width),
      top: rowRect.top,
      previousBottom: previousRect?.bottom ?? 0
    };
  });
  expect(rowLayout.leftDelta).toBeLessThanOrEqual(1);
  expect(rowLayout.widthDelta).toBeLessThanOrEqual(2);
  expect(rowLayout.top).toBeGreaterThanOrEqual(rowLayout.previousBottom - 1);
  const rowRelation = await unitSortOption.evaluate((element) => ({
    parentClass: String(element.parentElement?.className || ""),
    previousText: (element.previousElementSibling?.textContent || "").replace(/\s+/g, " ").trim()
  }));
  expect(rowRelation.parentClass).toContain("sort-popover");
  expect(rowRelation.previousText).toBe("Icon Sort by New Arrivals");

  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await unitSortOption.click();
  await expect(productTitles.first()).toContainText("Special Kitty Non-Clumping");
});

test("does not block product add buttons", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  const firstButton = page.getByRole("button", { name: "Add to cart" }).first();
  await expect(firstButton).toBeVisible();
  await firstButton.click();

  const buttonBox = await firstButton.boundingBox();
  const badgeBox = await page.locator("[data-ata-badge]").first().boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(badgeBox).not.toBeNull();
  expect(boxesOverlap(buttonBox!, badgeBox!)).toBe(false);
});

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}
