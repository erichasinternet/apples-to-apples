import { readFileSync } from "node:fs";
import path from "node:path";
import { extractProductsFromDocument } from "../../src/content/extractor";
import { DEFAULT_PREFERENCES } from "../../src/core/types";

describe("DOM extraction", () => {
  it("extracts and normalizes Walmart-style cat litter cards", () => {
    loadFixture("walmart-cat-litter.html", "https://www.walmart.com/search?q=cat+litter");

    const products = extractProductsFromDocument(document, DEFAULT_PREFERENCES, "www.walmart.com");

    expect(products).toHaveLength(3);
    expect(products.map((product) => product.normalized?.display)).toContain("67.4¢/lb");
    expect(products.map((product) => product.normalized?.display)).toContain("39.3¢/lb");
    expect(products.map((product) => product.normalized?.display)).toContain("$1.47/lb");
  });

  it("works on a generic shopping grid and skips unclear cards", () => {
    loadFixture("generic-shopping-grid.html", "https://shop.example/search?q=household");

    const products = extractProductsFromDocument(document, DEFAULT_PREFERENCES, "shop.example");

    expect(products.length).toBeGreaterThanOrEqual(3);
    expect(products.some((product) => product.title.includes("Snack variety"))).toBe(false);
    expect(products.some((product) => product.normalized?.compareKey === "volume:fl_oz")).toBe(true);
    expect(products.some((product) => product.normalized?.compareKey === "area:sq_ft")).toBe(true);
  });

  it("uses Product JSON-LD as a product-page fallback", () => {
    document.documentElement.innerHTML = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Pantry Rice, 10 lb Bag",
              "offers": {
                "@type": "Offer",
                "price": "8.99",
                "priceCurrency": "USD"
              },
              "weight": {
                "@type": "QuantitativeValue",
                "value": "10",
                "unitText": "lb"
              }
            }
          </script>
        </head>
        <body><main><h1>Pantry Rice, 10 lb Bag</h1></main></body>
      </html>
    `;

    const products = extractProductsFromDocument(document, DEFAULT_PREFERENCES, "shop.example");

    expect(products).toHaveLength(1);
    expect(products[0]?.normalized?.display).toBe("89.9¢/lb");
  });

  it("does not treat laptop specifications as package quantities", () => {
    document.documentElement.innerHTML = `
      <main>
        <ul>
          <li class="product-card">
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
    `;

    const products = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "shop.example"
    );

    expect(products).toEqual([]);
  });
});

function loadFixture(filename: string, _url: string): void {
  const html = readFileSync(path.join(process.cwd(), "tests", "fixtures", filename), "utf8");
  document.documentElement.innerHTML = html;
}
