import { test as base, chromium, expect, type BrowserContext } from "@playwright/test";
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
  ["Walmart cat litter", "https://www.walmart.com/search?q=cat+litter"],
  ["Amazon laundry detergent", "https://www.amazon.com/s?k=laundry+detergent"],
  ["Target coffee pods", "https://www.target.com/s?searchTerm=coffee+pods"],
  ["Chewy cat food", "https://www.chewy.com/s?query=cat%20food"],
  ["Petco dog food", "https://www.petco.com/shop/en/petcostore/search?query=dog%20food"],
  ["Walgreens vitamins", "https://www.walgreens.com/search/results.jsp?Ntt=vitamins"],
  ["CVS paper towels", "https://www.cvs.com/search?searchTerm=paper%20towels"],
  ["Home Depot trash bags", "https://www.homedepot.com/s/trash%20bags"],
  ["Lowes air filters", "https://www.lowes.com/search?searchTerm=air+filters"],
  ["Staples printer paper", "https://www.staples.com/printer-paper/cat_CL140557"],
  ["Costco coffee", "https://www.costco.com/CatalogSearch?keyword=coffee"],
  ["Sam's Club detergent", "https://www.samsclub.com/s/laundry%20detergent"]
] as const;

for (const [name, url] of targets) {
  live(`${name} live smoke`, async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    await page.mouse.wheel(0, 1200);

    await expect.poll(async () => page.locator("[data-ata-badge]").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });
}
