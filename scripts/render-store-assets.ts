import { chromium } from "@playwright/test";
import { createReadStream, existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

const root = process.cwd();
const siteRoot = path.join(root, "tests", "e2e", "site");
const outputDirectory = path.join(root, "store-assets", "listing");
const profile = await mkdtemp(path.join(tmpdir(), "ata-store-assets-"));
await mkdir(outputDirectory, { recursive: true });

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "store-demo.html";
  const filename = path.resolve(siteRoot, relativePath);
  if (
    (filename !== siteRoot && !filename.startsWith(`${siteRoot}${path.sep}`)) ||
    !existsSync(filename)
  ) {
    response.writeHead(404).end();
    return;
  }
  const contentType = new Map([
    [".html", "text/html; charset=utf-8"],
    [".png", "image/png"]
  ]).get(path.extname(filename)) ?? "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  createReadStream(filename).pipe(response);
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${path.join(root, "dist")}`,
    `--load-extension=${path.join(root, "dist")}`
  ]
});

try {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:${port}/store-demo.html`);
  await page.waitForFunction(() => document.querySelectorAll("[data-ata-product]").length === 4);
  await page.screenshot({
    path: path.join(outputDirectory, "screenshot-normalized-1280x800.png")
  });

  await page.selectOption('select[aria-label="Sort by"]', {
    label: "Unit price per lb: low to high"
  });
  await page.waitForFunction(
    () => document.querySelector(".product-card h2")?.textContent?.includes("Harvest Unscented")
  );
  await page.screenshot({
    path: path.join(outputDirectory, "screenshot-sorted-1280x800.png")
  });

  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  const logo = (await readFile(path.join(root, "public", "icons", "icon-128.png"))).toString("base64");
  const product = (await readFile(path.join(siteRoot, "assets", "litter-bag.png"))).toString("base64");
  await promo.setContent(`<!doctype html>
    <html><head><style>
      *{box-sizing:border-box}body{margin:0;width:440px;height:280px;overflow:hidden;background:#fbfaf6;color:#1f241f;font-family:Inter,Arial,sans-serif}
      main{position:relative;width:100%;height:100%;display:grid;grid-template-columns:1fr 158px;align-items:center;padding:30px 28px;border:1px solid #d8d3c8}
      .copy{position:relative;z-index:2}.brand{display:flex;align-items:center;gap:11px;margin-bottom:22px;font-size:13px;font-weight:750;color:#236652}.brand img{width:38px;height:38px}
      h1{max-width:245px;margin:0;font-size:29px;line-height:1.08;letter-spacing:0}.sub{margin:13px 0 0;color:#637064;font-size:14px;line-height:1.35}
      .product{position:absolute;right:6px;bottom:-16px;width:180px;height:235px;object-fit:contain}.rate{position:absolute;right:25px;top:31px;z-index:2;padding:8px 10px;border:1px solid #ccd5d0;border-radius:6px;background:#fff;color:#174c3c;font-size:16px;font-weight:780}
      .accent{position:absolute;left:0;bottom:0;width:100%;height:7px;background:#d8a134}
    </style></head><body><main>
      <div class="copy"><div class="brand"><img src="data:image/png;base64,${logo}" alt=""/>Apples to Apples</div><h1>Know the better value.</h1><p class="sub">Unit prices in one comparable measure.</p></div>
      <img class="product" src="data:image/png;base64,${product}" alt=""/><div class="rate">22.9¢/lb</div><div class="accent"></div>
    </main></body></html>`);
  await promo.screenshot({ path: path.join(outputDirectory, "promo-small-440x280.png") });
} finally {
  await context.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(profile, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ outputDirectory, screenshots: 2, promo: true }, null, 2)}\n`);
