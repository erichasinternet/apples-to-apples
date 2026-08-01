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

test("adds quiet normalized prices, suppresses native duplicates, and marks a factual lowest item", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  await expect(page.locator("[data-ata-product]")).toHaveCount(6);
  await expect(page.locator("[data-ata-badge]")).toHaveCount(4);

  const premium = page.locator(".product-card", { hasText: "Premium Clay Cat Litter" });
  const lowest = page.locator(".product-card", { hasText: "Special Kitty Non-Clumping" });
  const budget = page.locator(".product-card", { hasText: "Everyday Clumping" });

  await expect(premium).toHaveAttribute("data-ata-unit-price-source", "retailer");
  await expect(premium.locator("[data-ata-badge]")).toHaveCount(0);
  await expect(lowest.locator("[data-ata-badge]")).toHaveText("Lowest of 3");
  await expect(lowest.locator("[data-ata-badge]")).not.toContainText("22.9¢/lb");
  await expect(lowest.locator("[data-ata-badge]")).toHaveAttribute(
    "aria-label",
    "lowest of 3 comparable loaded items"
  );
  await expect(budget.locator("[data-ata-badge]")).toHaveText("60¢/lb");

  const inlineStyle = await budget.locator("[data-ata-badge]").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      padding: style.padding
    };
  });
  expect(inlineStyle).toEqual({
    background: "rgba(0, 0, 0, 0)",
    borderWidth: "0px",
    borderRadius: "0px",
    padding: "0px"
  });

  await expect(page.locator("#ata-panel-root")).toHaveCount(0);
  await expect(page.getByLabel("Sort by")).toContainText("Unit price per lb: low to high");
  await expect(page.getByLabel("Sort by")).toContainText("Unit price per fl oz: low to high");
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

  await page.getByLabel("Sort by").selectOption("ata-unit-price-asc:mass:lb");
  await expect(productTitles.first()).toContainText("Special Kitty Non-Clumping");

  await page.getByLabel("Sort by").selectOption("relevance");
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
});

test("keeps mixed comparison bases explicit and sorts only the selected basis", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/");

  const productTitles = page.locator(".product-card h2");
  await page.getByLabel("Sort by").selectOption("ata-unit-price-asc:volume:fl_oz");

  await expect(productTitles.nth(2)).toContainText("Fresh Linen Laundry Spray");
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await expect(productTitles.nth(1)).toContainText("Special Kitty Non-Clumping");
});

test("reports page status and performs the safe popup sort contract", async ({ context, page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator("[data-ata-product]")).toHaveCount(6);

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const status = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((candidate) =>
      candidate.url?.startsWith("http://127.0.0.1:4173/")
    );
    if (!tab?.id) {
      throw new Error("Fixture tab not found");
    }
    return await chrome.tabs.sendMessage(tab.id, { type: "ATA_GET_PAGE_STATUS" });
  });

  expect(status).toMatchObject({
    count: 6,
    sortActive: false,
    groups: expect.arrayContaining([
      expect.objectContaining({
        compareKey: "mass:lb",
        count: 3,
        canSort: true,
        sortLabel: "Unit price per lb: low to high"
      })
    ])
  });
  await expect
    .poll(async () =>
      worker.evaluate(async () => {
        const tab = (await chrome.tabs.query({})).find((candidate) =>
          candidate.url?.startsWith("http://127.0.0.1:4173/")
        );
        return await chrome.action.getBadgeText({ tabId: tab!.id! });
      })
    )
    .toBe("6");

  const sortedStatus = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((candidate) =>
      candidate.url?.startsWith("http://127.0.0.1:4173/")
    );
    return await chrome.tabs.sendMessage(tab!.id!, {
      type: "ATA_SORT_PAGE",
      compareKey: "mass:lb"
    });
  });

  expect(sortedStatus).toMatchObject({
    sortActive: true,
    activeSortCompareKey: "mass:lb"
  });
  await expect(page.locator(".product-card h2").first()).toContainText(
    "Special Kitty Non-Clumping"
  );

  await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((candidate) =>
      candidate.url?.startsWith("http://127.0.0.1:4173/")
    );
    return await chrome.tabs.sendMessage(tab!.id!, {
      type: "ATA_RESTORE_PAGE_ORDER"
    });
  });
  await expect(page.locator(".product-card h2").first()).toContainText(
    "Premium Clay Cat Litter"
  );
});

test("restores and detaches page UI when the extension is disabled", async ({ context, page }) => {
  await page.goto("http://127.0.0.1:4173/");
  await expect(page.locator("[data-ata-product]")).toHaveCount(6);
  await page.getByLabel("Sort by").selectOption("ata-unit-price-asc:mass:lb");
  await expect(page.locator(".product-card h2").first()).toContainText(
    "Special Kitty Non-Clumping"
  );

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () => {
    const key = "ata.preferences";
    const stored = await chrome.storage.sync.get(key);
    await chrome.storage.sync.set({
      [key]: {
        ...stored[key],
        enabled: false
      }
    });
    const tab = (await chrome.tabs.query({})).find((candidate) =>
      candidate.url?.startsWith("http://127.0.0.1:4173/")
    );
    await chrome.tabs.sendMessage(tab!.id!, { type: "ATA_SCAN_NOW" });
  });

  await expect(page.locator(".product-card h2").first()).toContainText(
    "Premium Clay Cat Litter"
  );
  await expect(page.locator("[data-ata-product], [data-ata-badge]")).toHaveCount(0);
  await expect(page.getByLabel("Sort by").locator("option[data-ata-sort-option]")).toHaveCount(0);
});

test("uses popup sorting when the retailer has no visible sort control", async ({ context, page }) => {
  await page.goto("http://127.0.0.1:4173/no-sort.html");

  const hiddenSort = page.locator("select[aria-label='Sort by']");
  const productTitles = page.locator(".product-card h2");

  await expect(hiddenSort).toBeHidden();
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await page.waitForTimeout(1800);
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");

  const worker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const status = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find((candidate) =>
      candidate.url?.includes("/no-sort.html")
    );
    return await chrome.tabs.sendMessage(tab!.id!, { type: "ATA_GET_PAGE_STATUS" });
  });
  expect(status.groups).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ compareKey: "mass:lb", count: 2, canSort: true })
    ])
  );
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

  await expect(page.locator("[data-ata-product]")).toHaveCount(3);
  await expect(page.locator("[data-ata-badge]")).toHaveCount(1);
  await expect(page.locator("[data-ata-badge][data-ata-dimension='area']")).toBeVisible();
  await expect(
    page.locator("article", { hasText: "FreshWash" }).locator("[data-ata-badge]")
  ).toHaveCount(0);
  await expect(
    page.locator("article", { hasText: "FreshWash" })
  ).toHaveAttribute("data-ata-unit-price-source", "retailer");
  await expect(
    page.locator("article", { hasText: "Snack variety box" }).locator("[data-ata-badge]"),
  ).toHaveCount(0);
  await expect(page.locator("[data-ata-sort-control]")).toHaveCount(0);
});

test("does not unit-price laptop dimensions on an unfamiliar retailer", async ({ page }) => {
  await page.route("https://www.microcenter.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `
        <!doctype html>
        <html>
          <body>
            <main>
              <label for="sort">Sort by</label>
              <select id="sort" aria-label="Sort by">
                <option value="pricelow">Lowest Price</option>
              </select>
              <ul id="productGrid">
                <li class="product_wrapper">
                  <a href="/wishlist" aria-label="Add SKU:825372 to wishlist">Add</a>
                  <a href="/product/692187">
                    <img alt="Lenovo Legion 5" src="laptop.png">
                  </a>
                  <a href="/product/692187">
                    Lenovo Legion 5 15.1 in Gaming Laptop Computer; 4.19 lb
                  </a>
                  <span class="price">Our price $2,499.99</span>
                  <button>Add to cart</button>
                </li>
              </ul>
            </main>
          </body>
        </html>
      `
    })
  );

  await page.goto(
    "https://www.microcenter.com/search/search_results.aspx?fq=category:Laptops%2FNotebooks"
  );

  const laptop = page.locator(".product_wrapper");
  await expect(laptop.locator("[data-ata-badge]")).toHaveCount(0);
  await expect(laptop).not.toHaveAttribute("data-ata-product", "true");
  await expect(page.getByLabel("Sort by")).not.toContainText("Unit price");
});

test("rescans a product card when its price evidence hydrates as text", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/dynamic-price-card.html");

  const firstCard = page.locator("[data-item-id='dynamic-first']");
  const secondCard = page.locator("[data-item-id='static-second']");

  await expect(firstCard).toHaveAttribute("data-ata-cents-per-unit", "67.4");
  await expect(secondCard).toHaveAttribute("data-ata-cents-per-unit", "39.3");
  await expect(firstCard.locator("[data-ata-badge]")).toHaveCount(0);
  await expect(secondCard.locator("[data-ata-badge]")).toHaveCount(0);
  await expect(firstCard.locator("#dynamic-unit-price")).toHaveText("67.4 ¢/lb");
  await page.waitForTimeout(1_800);
  await expect(firstCard.locator("[data-ata-badge]")).toHaveCount(0);
  await expect(secondCard.locator("[data-ata-badge]")).toHaveCount(0);
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
  await expect(unitSortOption).toHaveText("Unit price per lb: low to high");
  await expect(page.locator(".filter-dropdown [data-ata-custom-sort-option]")).toHaveCount(0);

  await expect(productTitles.first()).toContainText("Premium Clay Cat Litter");
  await unitSortOption.focus();
  await page.keyboard.press("Enter");
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
  await expect(unitSortOption.locator("label")).toHaveText("Unit price per lb: low to high");
  await expect(unitSortOption).toHaveAttribute("title", "Unit price per lb: low to high");
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
