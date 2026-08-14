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

  it("applies semantic multipack ambiguity guards to Product JSON-LD", () => {
    document.documentElement.innerHTML = `
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Product",
              "name": "Tide PODS Laundry Detergent, 42 Count (Pack of 3)",
              "offers": {
                "@type": "Offer",
                "price": "15.00",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body><main><h1>Tide PODS</h1></main></body>
      </html>
    `;

    expect(
      extractProductsFromDocument(
        document,
        DEFAULT_PREFERENCES,
        "shop.example"
      )
    ).toEqual([]);
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

  it("does not treat a storage bin's capacity as package contents", () => {
    document.documentElement.innerHTML = `
      <main>
        <article class="product-card">
          <a href="/storage-bins">
            <img alt="Sterilite storage bins" src="bins.png">
            6-Pk 27-Gal Sterilite Large Storage Bins (Black/Yellow)
          </a>
          <span>$48</span><span>$60</span><button>Get Deal</button>
        </article>
      </main>
    `;

    expect(
      extractProductsFromDocument(document, DEFAULT_PREFERENCES, "slickdeals.net")
    ).toEqual([]);
  });

  it("ignores unselected Walmart pack variants", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="dawn-single">
          <a href="/ip/dawn-single">
            <img alt="Dawn dish soap" src="dawn.png">
            <h3 data-automation-id="product-title">
              Dawn Ultra Dish Soap Liquid, Original, 38oz
            </h3>
          </a>
          <button aria-pressed="true">Single <span>$5.94</span></button>
          <button aria-pressed="false">8 Pack <span>$47.52</span></button>
          <div data-automation-id="product-price">$ 5 94 15.6 ¢/fl oz</div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product).toMatchObject({
      title: "Dawn Ultra Dish Soap Liquid, Original, 38oz",
      normalized: {
        display: "15.6¢/fl oz"
      }
    });
    expect(product?.packCount).toBeUndefined();
  });

  it("uses only the selected Walmart pack variant", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="dawn-six-pack">
          <a href="/ip/dawn-six-pack">
            <img alt="Dawn dish soap" src="dawn.png">
            <h3 data-automation-id="product-title">
              Dawn Powerwash Dish Spray, 16 fl oz
            </h3>
          </a>
          <button aria-pressed="false">Single</button>
          <button aria-pressed="false">3 Pack</button>
          <button aria-pressed="true">6 Pack</button>
          <div data-automation-id="product-price">$21.27 22.2 ¢/fl oz</div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product).toMatchObject({
      packCount: 6,
      normalized: {
        display: "22.2¢/fl oz"
      }
    });
  });

  it("retains the same Walmart product when it appears in separate collections", () => {
    const dewyDazeTitle =
      "Method Super Shine Liquid Dish Soap, Powered by Enzymes, Dewy Daze Scented, 16 fl oz";
    const coastalCitronTitle =
      "Method Super Shine Liquid Dish Soap, Powered by Enzymes, Coastal Citron Scented, 16 fl oz";
    document.documentElement.innerHTML = `
      <main>
        <div data-testid="item-stack">
          <div data-item-id="dewy-daze-main">
            <h3 data-automation-id="product-title">${dewyDazeTitle}</h3>
            <div data-testid="unified-global-product-price">$6.12 38.3 ¢/fl oz</div>
            <button>Add</button>
          </div>
          <div data-item-id="coastal-citron-main">
            <h3 data-automation-id="product-title">${coastalCitronTitle}</h3>
            <div data-testid="unified-global-product-price">$5.97 37.3 ¢/fl oz</div>
            <button>Add</button>
          </div>
        </div>
        <section aria-label="Products you may also like">
          <ul data-testid="carousel-container">
            <li>
              <div data-item-id="dewy-daze-carousel">
                <h3 data-automation-id="product-title">${dewyDazeTitle}</h3>
                <div data-testid="unified-global-product-price">$6.12 38.3 ¢/fl oz</div>
                <button>Add</button>
              </div>
            </li>
            <li>
              <div data-item-id="coastal-citron-carousel">
                <h3 data-automation-id="product-title">${coastalCitronTitle}</h3>
                <div data-testid="unified-global-product-price">$5.97 37.3 ¢/fl oz</div>
                <button>Add</button>
              </div>
            </li>
          </ul>
        </section>
      </main>
    `;

    const products = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(products).toHaveLength(4);
    expect(
      products
        .filter((product) => product.title === dewyDazeTitle)
        .map((product) => product.element.dataset.itemId)
        .sort()
    ).toEqual(["dewy-daze-carousel", "dewy-daze-main"]);
    expect(
      products
        .filter((product) => product.title === coastalCitronTitle)
        .map((product) => product.element.dataset.itemId)
        .sort()
    ).toEqual(["coastal-citron-carousel", "coastal-citron-main"]);
  });

  it("retains repeated products across separate single-item collections", () => {
    const title = "Method Laundry Detergent Fresh Air, 53.5 fl oz, 66 Loads";
    document.documentElement.innerHTML = `
      <main>
        <div data-testid="item-stack">
          <div data-item-id="method-main">
            <h3 data-automation-id="product-title">${title}</h3>
            <div data-testid="unified-global-product-price">$14.29 26.7 ¢/oz</div>
            <button>Add</button>
          </div>
        </div>
        <ul data-testid="carousel-container">
          <li>
            <div data-item-id="method-carousel">
              <h3 data-automation-id="product-title">${title}</h3>
              <div data-testid="unified-global-product-price">$14.29 26.7 ¢/oz</div>
              <button>Add</button>
            </div>
          </li>
        </ul>
      </main>
    `;

    const products = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(products.map((product) => product.element.dataset.itemId).sort()).toEqual([
      "method-carousel",
      "method-main"
    ]);
  });

  it("uses count-worded laundry pacs instead of Walmart's package-weight rate", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="gain-flings">
          <a href="/ip/gain-flings">
            <h3 data-automation-id="product-title">
              Gain Flings Laundry Detergent Soap Pacs, Original, 12 Count
            </h3>
          </a>
          <div>Options from $9.97</div>
          <div data-testid="unified-global-product-price" aria-label="Price $ 3.97 49.6 ¢/oz">
            $3.97 49.6 ¢/oz
          </div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product).toMatchObject({
      price: { cents: 397 },
      packageQuantity: { value: 12, unit: "pod" },
      normalized: { display: "33.1¢/pod", compareKey: "count:pod" }
    });
  });

  it("keeps a solid detergent pac's ounce quantity out of fluid volume", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="persil-pacs">
          <h3 data-automation-id="product-title">
            Persil Activewear Clean Laundry Detergent Ultra Pacs, Original, 8.04 oz, 12 Count
          </h3>
          <div data-testid="unified-global-product-price">$13.24 $1.65/oz</div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product?.normalized).toMatchObject({
      display: "$1.10/pod",
      compareKey: "count:pod"
    });
    expect(product?.normalized?.dimension).not.toBe("volume");
  });

  it("prefers count-worded detergent sheets over package weight", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="detergent-sheets">
          <h3 data-automation-id="product-title">
            Fresh Laundry Detergent Sheets, 30 Count, 5 oz
          </h3>
          <div data-testid="unified-global-product-price">$9.00 $1.80/oz</div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product).toMatchObject({
      packageQuantity: { value: 30, unit: "sheet" },
      normalized: { display: "30¢/sheet", compareKey: "count:sheet" }
    });
  });

  it("does not price a liquid-detergent bundle by its included dryer sheets", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="detergent-sheet-bundle">
          <h3 data-automation-id="product-title">
            Tide Liquid Laundry Detergent, 92 fl oz with Bounce Dryer Sheets, 60 Count
          </h3>
          <div data-testid="unified-global-product-price">$20.00 15¢/fl oz</div>
          <button>Add</button>
        </div>
      </main>
    `;

    expect(
      extractProductsFromDocument(
        document,
        DEFAULT_PREFERENCES,
        "www.walmart.com"
      )
    ).toEqual([]);
  });

  it("does not price pod-storage accessories as detergent pods", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="pod-storage">
          <h3 data-automation-id="product-title">
            Laundry Detergent Pods Storage Containers, 2 Count, 64 oz capacity
          </h3>
          <div data-testid="unified-global-product-price">$20.00</div>
          <button>Add</button>
        </div>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "www.walmart.com"
    );

    expect(product).toMatchObject({
      packageQuantity: { value: 2, unit: "each" },
      normalized: { display: "$10.00/count", compareKey: "count:each" }
    });
    expect(product?.normalized?.unit).not.toBe("pod");
  });

  it("abstains from direct pod counts that describe a storage drawer", () => {
    document.documentElement.innerHTML = `
      <main>
        <div role="group" data-item-id="coffee-pod-drawer">
          <h3 data-automation-id="product-title">
            Keurig K-Cup Coffee Pod Storage Drawer, Holds 36 Pods
          </h3>
          <div data-testid="unified-global-product-price">$20.00</div>
          <button>Add</button>
        </div>
      </main>
    `;

    expect(
      extractProductsFromDocument(
        document,
        DEFAULT_PREFERENCES,
        "www.walmart.com"
      )
    ).toEqual([]);
  });

  it("rejects specifications while retaining real fabric and paper units", () => {
    document.documentElement.innerHTML = `
      <main><ul>
        <li class="product-card">
          <a href="/fabric">Mid Weight Stretch Denim, 10 oz, 60 inches wide</a>
          <span>$18.99</span><span> per yard</span><button>Add to cart</button>
        </li>
        <li class="product-card">
          <a href="/bags">55 Gallon Trash Bags, Heavy Duty, 60 Count</a>
          <span>$18.00</span><button>Add to cart</button>
        </li>
        <li class="product-card">
          <a href="/towels">Bounty Paper Towels, 108 sheets per roll, 4 pack</a>
          <span>$5.49</span><span>$1.37</span><span> / ea</span><button>Add to cart</button>
        </li>
        <li class="product-card">
          <a href="/container">Clear Deli Container, 32 oz, 240 Count</a>
          <span>$48.00</span><button>Add to cart</button>
        </li>
        <li class="product-card">
          <a href="/promotion">65% Off! 65% Off!</a>
          <span>$5.00</span><span>5 oz</span><button>Add to cart</button>
        </li>
      </ul></main>
    `;

    const products = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "shop.example"
    );

    expect(products.map((product) => product.normalized?.display)).toEqual(
      expect.arrayContaining([
        "$6.33/ft",
        "30¢/bag",
        "1.27¢/sheet",
        "20¢/count"
      ])
    );
    expect(
      products.some(
        (product) =>
          product.title.includes("Trash Bags") &&
          product.normalized?.dimension === "volume"
      )
    ).toBe(false);
    expect(products.some((product) => product.title.includes("65% Off"))).toBe(
      false
    );
  });

  it("does not treat merchandising labels as product titles", () => {
    document.documentElement.innerHTML = `
      <main><ul>
        <li class="product-card">
          <a href="/syringe">Cost-Effective</a>
          <span>$0.21</span><span>3 mL</span><button>Add to cart</button>
        </li>
      </ul></main>
    `;

    expect(
      extractProductsFromDocument(document, DEFAULT_PREFERENCES, "shop.example")
    ).toEqual([]);
  });

  it("prefers package quantities in the title over unrelated card text", () => {
    document.documentElement.innerHTML = `
      <main><ul>
        <li class="product-card">
          <a href="/oil">Olive Oil, 1 Gallon Jar -- 4 Per Case</a>
          <span>$274.95</span><span>95 / case</span><button>Add to cart</button>
        </li>
      </ul></main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "shop.example"
    );
    expect(product?.normalized?.display).toBe("53.7¢/fl oz");
  });

  it("prefers a product-title link over a preceding vendor link", () => {
    document.documentElement.innerHTML = `
      <main><ul>
        <li class="product-card">
          <a class="product-item__vendor" href="/collections/vendor">Bilt Hamber</a>
          <a class="product-item__title" href="/products/auto-wash">Bilt Hamber Auto-Wash Car Shampoo 1 Litre</a>
          <span>$33.00</span><button>Add to cart</button>
        </li>
      </ul></main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "shop.example"
    );
    expect(product?.title).toBe("Bilt Hamber Auto-Wash Car Shampoo 1 Litre");
  });

  it("does not treat rating or promotion links as product titles", () => {
    for (const label of [
      "4.8 out of 5 stars. 687 reviews",
      "Extra 15% off $35+ with code JULY15",
      "Spend $50 on eligible brands, get $15 rebate",
      "Out of Stock"
    ]) {
      document.documentElement.innerHTML = `
        <main><ul><li class="product-card">
          <a href="/reviews">${label}</a><span>$12.00</span><span>12 oz</span>
          <button>Add to cart</button>
        </li></ul></main>
      `;
      expect(
        extractProductsFromDocument(document, DEFAULT_PREFERENCES, "shop.example")
      ).toEqual([]);
    }
  });

  it("rejects editorial roundups that contain several product examples", () => {
    document.documentElement.innerHTML = `
      <main>
        <article class="content-block">
          <h3>Top-Rated Construction Paper for Classroom Learning</h3>
          <p>Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. Our store offers a wide selection of classroom paper. </p>
          <p>Prices range from $1.49 to $82.99.</p>
          <p>Paper Pack - 2200 Sheets - $82.99</p>
          <a href="/construction-paper">Learn more</a>
        </article>
      </main>
    `;

    expect(
      extractProductsFromDocument(document, DEFAULT_PREFERENCES, "shop.example")
    ).toEqual([]);
  });

  it("prefers a dimensional package over a retailer per-item field", () => {
    document.documentElement.innerHTML = `
      <main>
        <article class="product-card" data-asin="foil">
          <a href="/foil"><img src="foil.jpg">Aluminum Foil, 12 inches x 1000 ft Roll</a>
          <span>$55.90</span><span>$55.90 / item</span><button>Add to cart</button>
        </article>
      </main>
    `;

    const [product] = extractProductsFromDocument(
      document,
      DEFAULT_PREFERENCES,
      "shop.example"
    );

    expect(product?.normalized?.display).toBe("5.59¢/ft");
  });
});

function loadFixture(filename: string, _url: string): void {
  const html = readFileSync(path.join(process.cwd(), "tests", "fixtures", filename), "utf8");
  document.documentElement.innerHTML = html;
}
