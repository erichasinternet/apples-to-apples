export interface SiteAdapter {
  id: string;
  label: string;
  hostnames: readonly string[];
  cardSelectors: readonly string[];
  titleSelectors: readonly string[];
  priceSelectors: readonly string[];
}

export const SITE_ADAPTERS: readonly SiteAdapter[] = [
  {
    id: "walmart",
    label: "Walmart",
    hostnames: ["www.walmart.com", "walmart.com"],
    cardSelectors: [
      "[data-item-id]",
      "[data-testid='item-stack']",
      "[data-testid='list-view']",
      "div[role='group']"
    ],
    titleSelectors: ["[data-automation-id='product-title']", "h1", "h2", "h3", "a[href*='/ip/']"],
    priceSelectors: [
      "[data-automation-id='product-price']",
      "[data-testid='unified-global-product-price']",
      "[itemprop='price']",
      "[aria-label*='current price' i]"
    ]
  },
  {
    id: "amazon",
    label: "Amazon",
    hostnames: ["www.amazon.com", "amazon.com"],
    cardSelectors: [
      "[data-asin]:not([data-asin=''])",
      ".s-result-item",
      "[data-component-type='s-search-result']"
    ],
    titleSelectors: ["h1", "h2 a span", "#productTitle", "a.a-link-normal span"],
    priceSelectors: [".a-price", ".a-offscreen", "#corePriceDisplay_desktop_feature_div"]
  },
  {
    id: "target",
    label: "Target",
    hostnames: ["www.target.com", "target.com"],
    cardSelectors: [
      "[data-test='product-card']",
      "[data-test='@web/ProductCard/ProductCardVariantDefault']",
      "li[data-test]"
    ],
    titleSelectors: ["[data-test='product-title']", "a[href*='/p/']", "h1", "h2", "h3"],
    priceSelectors: ["[data-test='current-price']", "[data-test='product-price']"]
  },
  {
    id: "costco",
    label: "Costco",
    hostnames: ["www.costco.com", "costco.com"],
    cardSelectors: [".product", ".product-tile", "[automation-id='productList'] li"],
    titleSelectors: [".description", ".product-title", "a[href*='.product.']", "h1", "h2", "h3"],
    priceSelectors: [".price", ".product-price"]
  },
  {
    id: "chewy",
    label: "Chewy",
    hostnames: ["www.chewy.com", "chewy.com"],
    cardSelectors: ["[data-testid='product-card']", ".product-holder", ".kib-product-card"],
    titleSelectors: ["[data-testid='product-title']", "a[href*='/dp/']", "h1", "h2", "h3"],
    priceSelectors: ["[data-testid='advertised-price']", ".price", ".ga-eec__price"]
  },
  {
    id: "generic",
    label: "Shopping page",
    hostnames: [],
    cardSelectors: [
      "article",
      "li",
      "[data-testid*='product' i]",
      "[data-test*='product' i]",
      "[class*='product' i]",
      "[class*='Product' i]",
      "[itemtype*='Product']"
    ],
    titleSelectors: ["h1", "h2", "h3", "[itemprop='name']", "a[href]"],
    priceSelectors: ["[itemprop='price']", "[class*='price' i]", "[data-testid*='price' i]", "[data-test*='price' i]"]
  }
];

export function getSiteAdapter(hostname: string): SiteAdapter {
  return SITE_ADAPTERS.find((adapter) => adapter.hostnames.includes(hostname)) ?? SITE_ADAPTERS[SITE_ADAPTERS.length - 1]!;
}
