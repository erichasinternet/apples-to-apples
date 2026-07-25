import type { CanonicalUnit, Dimension } from "../src/core/types";
import type { ModelAbstentionReason } from "../src/learning/contracts";
import type {
  DatasetProductChallengeTag
} from "./live-corpus-lib";

export const SYNTHETIC_GENERATOR_VERSION = 2;

export interface SyntheticQuantity {
  valuePerPackage: number;
  packCount: number;
  unit: CanonicalUnit;
  unitLabel: string;
  dimension: Dimension;
}

export interface SyntheticProduct {
  key: string;
  title: string;
  comparable: boolean;
  priceCents?: number;
  quantity?: SyntheticQuantity;
  nativeUnitPrice?: {
    centsPerUnit: number;
    unit: CanonicalUnit;
    unitLabel: string;
    dimension: Dimension;
  };
  abstainReason?: ModelAbstentionReason;
  visibleQuantity?: string;
  visiblePrice?: string;
  visibleNativeUnitPrice?: string;
  badge?: string;
  scope?: "primary-results" | "secondary-recommendation";
  challengeTags?: DatasetProductChallengeTag[];
  pricePresentation?: "plain" | "split" | "sale";
  titleIncludesQuantity?: boolean;
}

export interface SyntheticPage {
  pageId: string;
  siteId: string;
  layout: string;
  html: string;
  products: SyntheticProduct[];
}

interface SyntheticPageOptions {
  seed: number;
  domainIndex: number;
  pageIndex: number;
  productsPerPage: number;
  siteId: string;
}

interface UnitChoice {
  unit: CanonicalUnit;
  label: string;
  dimension: Dimension;
  values: readonly number[];
}

const UNIT_CHOICES: readonly UnitChoice[] = [
  { unit: "oz", label: "oz", dimension: "mass", values: [8, 12, 16, 20, 32, 40] },
  { unit: "lb", label: "lb", dimension: "mass", values: [2, 5, 8, 12, 20, 35] },
  { unit: "g", label: "g", dimension: "mass", values: [100, 250, 340, 500, 750] },
  { unit: "kg", label: "kg", dimension: "mass", values: [1, 2, 3, 5, 8] },
  {
    unit: "fl_oz",
    label: "fl oz",
    dimension: "volume",
    values: [8, 12, 16, 24, 32, 64]
  },
  { unit: "ml", label: "mL", dimension: "volume", values: [100, 250, 355, 500, 750] },
  { unit: "l", label: "L", dimension: "volume", values: [1, 1.5, 2, 3, 5] },
  { unit: "gal", label: "gal", dimension: "volume", values: [1, 2, 3, 5] },
  {
    unit: "each",
    label: "count",
    dimension: "count",
    values: [12, 24, 30, 48, 60, 100, 200]
  },
  { unit: "roll", label: "rolls", dimension: "count", values: [4, 6, 8, 12, 18] },
  { unit: "load", label: "loads", dimension: "count", values: [20, 32, 48, 64, 96] },
  { unit: "tablet", label: "tablets", dimension: "count", values: [24, 50, 80, 120] },
  {
    unit: "sq_ft",
    label: "sq ft",
    dimension: "area",
    values: [12, 25, 50, 100, 250, 500]
  },
  { unit: "ft", label: "ft", dimension: "length", values: [6, 12, 25, 50, 100] },
  { unit: "in", label: "in", dimension: "length", values: [12, 24, 36, 48, 72] }
];

const PRODUCT_NAMES: Record<Dimension, readonly string[]> = {
  mass: [
    "Fresh Roast Coffee",
    "Clumping Cat Litter",
    "Long Grain Rice",
    "Whole Grain Oats",
    "Laundry Powder",
    "Trail Mix",
    "Dry Dog Food"
  ],
  volume: [
    "Cold Brew Concentrate",
    "Plant-Based Cleaner",
    "Extra Virgin Olive Oil",
    "Liquid Laundry Soap",
    "Sparkling Water",
    "Hand Wash",
    "Maple Syrup"
  ],
  count: [
    "Dishwasher Tablets",
    "Paper Towel Rolls",
    "Coffee Pods",
    "Vitamin Tablets",
    "Storage Bags",
    "Dental Floss Picks",
    "Baby Wipes"
  ],
  area: [
    "Premium Aluminum Foil",
    "Kitchen Parchment",
    "Garden Weed Barrier",
    "Shelf Liner",
    "Flooring Underlayment",
    "Window Film"
  ],
  length: [
    "Heavy Duty Extension Cord",
    "Garden Hose",
    "Packing Tape",
    "Weather Seal",
    "Utility Rope",
    "LED Light Strip"
  ]
};

const BRANDS = [
  "Northstar",
  "Common Good",
  "Bright Day",
  "Field & Found",
  "Evergreen",
  "Market House",
  "Cedar Lane",
  "Daily Standard",
  "Open Pantry",
  "True Supply"
] as const;

const LAYOUTS = [
  "market-grid",
  "dense-grid",
  "clean-list",
  "split-list",
  "catalog-grid",
  "compact-rows",
  "tile-grid",
  "editorial-list"
] as const;

const ABSTENTION_REASONS: readonly ModelAbstentionReason[] = [
  "conditional-price",
  "price-range",
  "ambiguous-quantity",
  "unsupported-unit",
  "unselected-variant"
];

export function createSyntheticPage(options: SyntheticPageOptions): SyntheticPage {
  const random = createRandom(
    options.seed + options.domainIndex * 10_007 + options.pageIndex * 1_009
  );
  const layout = LAYOUTS[options.domainIndex % LAYOUTS.length]!;
  const pageId = `${options.siteId}--page-${String(options.pageIndex + 1).padStart(2, "0")}`;
  const products = Array.from({ length: options.productsPerPage }, (_, productIndex) =>
    createProduct(random, options, productIndex)
  );
  return {
    pageId,
    siteId: options.siteId,
    layout,
    products,
    html: renderPage(pageId, options.siteId, layout, options.domainIndex, products)
  };
}

function createProduct(
  random: () => number,
  options: SyntheticPageOptions,
  productIndex: number
): SyntheticProduct {
  const unitChoice =
    UNIT_CHOICES[
      (options.domainIndex * 3 + options.pageIndex * 5 + productIndex) %
        UNIT_CHOICES.length
    ]!;
  const baseValue =
    unitChoice.values[Math.floor(random() * unitChoice.values.length)]!;
  const value =
    productIndex % 10 === 8 && unitChoice.dimension !== "count"
      ? 1.5
      : baseValue;
  const packCount = productIndex % 4 === 3 ? 2 + Math.floor(random() * 4) : 1;
  const brand = BRANDS[Math.floor(random() * BRANDS.length)]!;
  const names = PRODUCT_NAMES[unitChoice.dimension];
  const name = names[Math.floor(random() * names.length)]!;
  const variant = ["Original", "Unscented", "Family Size", "Everyday", "Premium"][
    Math.floor(random() * 5)
  ]!;
  const key = `p${productIndex}`;
  const isAbstention = productIndex % 5 === 0;

  if (isAbstention) {
    const abstainReason =
      ABSTENTION_REASONS[
        (options.domainIndex + options.pageIndex + productIndex / 5) %
          ABSTENTION_REASONS.length
      ]!;
    const visible = abstentionText(abstainReason, random);
    const challengeTag = abstentionChallenge(abstainReason);
    return {
      key,
      title: `${brand} ${name}, ${variant}`,
      comparable: false,
      abstainReason,
      visiblePrice: visible.price,
      visibleQuantity: visible.quantity,
      ...(visible.badge ? { badge: visible.badge } : {}),
      ...(challengeTag ? { challengeTags: [challengeTag] } : {})
    };
  }

  const priceCents = 199 + Math.floor(random() * 4_800);
  const quantity: SyntheticQuantity = {
    valuePerPackage: value,
    packCount,
    unit: unitChoice.unit,
    unitLabel: unitChoice.label,
    dimension: unitChoice.dimension
  };
  const quantityText =
    packCount > 1
      ? `${packCount} × ${formatNumber(value)} ${unitChoice.label}`
      : `${formatNumber(value)} ${unitChoice.label}`;
  const titleIncludesQuantity = productIndex % 3 === 1;
  const title = `${brand} ${name}, ${variant}${
    titleIncludesQuantity ? `, ${quantityText}` : ""
  }`;
  const rawNativeCents = priceCents / (value * packCount);
  const nativeCents =
    rawNativeCents < 100 ? round(rawNativeCents, 1) : round(rawNativeCents, 0);
  const includeNative = productIndex % 3 !== 0;
  const nativeOnly = includeNative && productIndex % 7 === 2;
  const pricePresentation =
    productIndex % 10 === 2
      ? "split"
      : productIndex % 10 === 3
        ? "sale"
        : "plain";
  const scope =
    productIndex % 10 === 4
      ? "secondary-recommendation"
      : "primary-results";
  const challengeTags: DatasetProductChallengeTag[] = [
    ...(packCount > 1 ? (["multipack"] as const) : []),
    ...(pricePresentation === "split" ? (["split-price"] as const) : []),
    ...(pricePresentation === "sale" ? (["sale-vs-list"] as const) : []),
    ...(value % 1 !== 0 ? (["decimal-quantity"] as const) : []),
    ...(scope === "secondary-recommendation"
      ? (["sponsored-or-recommendation"] as const)
      : [])
  ];
  const visiblePrice =
    pricePresentation === "sale"
      ? `Now ${formatMoney(priceCents)}; Was ${formatMoney(priceCents + 300)}`
      : formatMoney(priceCents);

  return {
    key,
    title,
    comparable: true,
    priceCents,
    ...(nativeOnly ? {} : { quantity }),
    ...(includeNative
      ? {
          nativeUnitPrice: {
            centsPerUnit: nativeCents,
            unit: unitChoice.unit,
            unitLabel: unitChoice.label,
            dimension: unitChoice.dimension
          }
        }
      : {}),
    visiblePrice,
    ...(nativeOnly ? {} : { visibleQuantity: quantityText }),
    ...(includeNative
      ? { visibleNativeUnitPrice: formatUnitPrice(nativeCents, unitChoice.label) }
      : {}),
    ...(productIndex % 9 === 0 ? { badge: "Popular choice" } : {}),
    scope,
    challengeTags,
    pricePresentation,
    titleIncludesQuantity
  };
}

function abstentionText(
  reason: ModelAbstentionReason,
  random: () => number
): { price: string; quantity: string; badge?: string } {
  const low = 3 + Math.floor(random() * 12);
  switch (reason) {
    case "conditional-price":
      return {
        price: `$${low}.00 with membership`,
        quantity: "Standard package",
        badge: "Member offer"
      };
    case "price-range":
      return {
        price: `$${low}.00 - $${low + 8}.00`,
        quantity: "Multiple sizes"
      };
    case "ambiguous-quantity":
      return {
        price: `$${low}.49`,
        quantity: "Net weight varies"
      };
    case "unsupported-unit":
      return {
        price: `€${low}.99`,
        quantity: "1 assorted bundle",
        badge: "Imported offer"
      };
    case "unselected-variant":
      return {
        price: `From $${low}.00`,
        quantity: "Choose a size"
      };
    default:
      return {
        price: "See details",
        quantity: "Details unavailable"
      };
  }
}

function abstentionChallenge(
  reason: ModelAbstentionReason
): DatasetProductChallengeTag | undefined {
  if (reason === "conditional-price") return "conditional-price";
  if (reason === "price-range") return "price-range";
  if (reason === "unselected-variant") return "unselected-variant";
  if (reason === "unsupported-unit") return "unsupported-currency";
  if (reason === "ambiguous-quantity") return "native-derived-conflict";
  return undefined;
}

function renderPage(
  pageId: string,
  siteId: string,
  layout: string,
  domainIndex: number,
  products: readonly SyntheticProduct[]
): string {
  const palette = palettes[domainIndex % palettes.length]!;
  const cards = products.map((product, index) => renderCard(product, index, layout));
  const midpoint = Math.ceil(cards.length / 2);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(siteId)} household essentials</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-width: 1180px; color: ${palette.ink}; background: ${palette.page}; font-family: ${palette.font}; }
    body { min-height: 2500px; }
    .site-header { height: 92px; padding: 18px 44px; display: flex; align-items: center; gap: 32px; color: ${palette.headerInk}; background: ${palette.header}; border-bottom: 1px solid ${palette.line}; }
    .brand { font-size: 25px; font-weight: 800; }
    .search { flex: 1; max-width: 720px; padding: 13px 18px; color: #333; background: white; border: 1px solid ${palette.line}; border-radius: ${domainIndex % 2 === 0 ? "4px" : "20px"}; }
    .account { margin-left: auto; font-size: 14px; }
    main { width: 1180px; min-height: 2260px; margin: 0 auto; padding: 24px 30px 40px; background: ${palette.surface}; }
    .toolbar { min-height: 150px; border-bottom: 1px solid ${palette.line}; }
    .eyebrow { margin: 0 0 8px; color: ${palette.muted}; font-size: 13px; text-transform: uppercase; }
    h1 { margin: 0 0 18px; font-size: 27px; font-weight: 750; }
    .filters { display: flex; gap: 10px; }
    .filter { padding: 8px 13px; color: ${palette.ink}; background: ${palette.chip}; border: 1px solid ${palette.line}; border-radius: 4px; font-size: 13px; }
    .results { padding-top: 22px; }
    .results.market-grid, .results.catalog-grid, .results.tile-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
    .results.dense-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    .results.clean-list, .results.split-list, .results.compact-rows, .results.editorial-list { display: flex; flex-direction: column; gap: 10px; }
    .product { position: relative; min-width: 0; color: ${palette.ink}; background: ${palette.card}; border: 1px solid ${palette.line}; }
    .market-grid .product, .catalog-grid .product, .tile-grid .product { min-height: 430px; padding: 14px; }
    .dense-grid .product { min-height: 350px; padding: 11px; }
    .clean-list .product, .split-list .product, .compact-rows .product, .editorial-list .product { min-height: 125px; padding: 12px 18px; display: grid; grid-template-columns: 128px minmax(0, 1fr) 175px; gap: 18px; align-items: center; }
    .product-media { height: 190px; display: grid; place-items: center; background: ${palette.media}; border: 1px solid ${palette.line}; overflow: hidden; }
    .dense-grid .product-media { height: 135px; }
    .clean-list .product-media, .split-list .product-media, .compact-rows .product-media, .editorial-list .product-media { width: 112px; height: 96px; }
    .package { width: 70px; height: 118px; padding: 10px 6px; display: grid; place-items: center; color: ${palette.packageInk}; background: ${palette.package}; border: 2px solid ${palette.packageInk}; font-size: 11px; font-weight: 800; text-align: center; }
    .clean-list .package, .split-list .package, .compact-rows .package, .editorial-list .package { width: 58px; height: 82px; }
    .badge { min-height: 20px; margin: 10px 0 4px; color: ${palette.accent}; font-size: 12px; font-weight: 700; }
    .title { margin: 5px 0 8px; font-size: 15px; line-height: 1.25; font-weight: 650; }
    .dense-grid .title { font-size: 13px; }
    .rating { color: ${palette.muted}; font-size: 12px; }
    .purchase { margin-top: 10px; }
    .price { font-size: 20px; font-weight: 800; }
    .quantity, .native { margin-top: 4px; color: ${palette.muted}; font-size: 13px; }
    .native { color: ${palette.accent}; font-weight: 700; }
    .add { margin-top: 12px; padding: 8px 14px; color: ${palette.buttonInk}; background: ${palette.accent}; border: 0; border-radius: 4px; font-weight: 700; }
    .decoy { grid-column: 1 / -1; min-height: 82px; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; background: ${palette.chip}; border: 1px solid ${palette.line}; }
    .footer-space { min-height: 250px; padding: 90px 20px 20px; color: ${palette.muted}; text-align: center; }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="brand">${escapeHtml(siteLabel(siteId))}</div>
    <div class="search">Search household essentials</div>
    <div class="account">Orders &nbsp; Account &nbsp; Cart (2)</div>
  </header>
  <main data-synthetic-page="${escapeHtml(pageId)}">
    <section class="toolbar">
      <p class="eyebrow">Home / Household</p>
      <h1>Household essentials</h1>
      <div class="filters">
        <span class="filter">Available today</span>
        <span class="filter">Price</span>
        <span class="filter">Brand</span>
        <span class="filter">Package size</span>
        <span class="filter">Sort: Recommended</span>
      </div>
    </section>
    <section class="results ${layout}" aria-label="Product results">
      ${cards.slice(0, midpoint).join("")}
      <aside class="decoy"><strong>Seasonal savings</strong><span>Explore offers across the store</span></aside>
      ${cards.slice(midpoint).join("")}
    </section>
    <section class="footer-space">Related categories &nbsp; Store services &nbsp; Help center</section>
  </main>
</body>
</html>`;
}

function renderCard(product: SyntheticProduct, index: number, layout: string): string {
  const tag = layout.includes("list") || layout.includes("rows") ? "div" : "article";
  const media = `<div class="product-media" aria-label="${escapeHtml(
    product.title
  )} product image"><div class="package">${escapeHtml(packageLabel(product.title))}</div></div>`;
  const details = `<div class="details">
    <div class="badge">${escapeHtml(product.badge ?? "")}</div>
    <h2 class="title" data-synth-title="${product.key}">${escapeHtml(product.title)}</h2>
    <div class="rating">${(3.8 + (index % 12) / 10).toFixed(1)} stars · ${42 + index * 137} reviews</div>
  </div>`;
  const renderedPrice =
    product.pricePresentation === "split" && product.priceCents !== undefined
      ? `<span>$</span><span>${Math.floor(product.priceCents / 100)}</span><sup>${String(
          product.priceCents % 100
        ).padStart(2, "0")}</sup>`
      : escapeHtml(product.visiblePrice ?? "");
  const purchase = `<div class="purchase">
    <div class="price" data-synth-price="${product.key}">${renderedPrice}</div>
    ${
      product.visibleQuantity
        ? `<div class="quantity" data-synth-quantity="${product.key}">${escapeHtml(
            product.visibleQuantity
          )}</div>`
        : ""
    }
    ${
      product.visibleNativeUnitPrice
        ? `<div class="native" data-synth-native="${product.key}">${escapeHtml(
            product.visibleNativeUnitPrice
          )}</div>`
        : ""
    }
    <button class="add" type="button">Add</button>
  </div>`;
  const order = index % 3 === 0 ? `${media}${purchase}${details}` : `${media}${details}${purchase}`;
  return `<${tag} class="product" data-synth-card="${product.key}">${order}</${tag}>`;
}

export function syntheticStructuralFamily(
  layout: string,
  product: SyntheticProduct
): string {
  const dimension =
    product.quantity?.dimension ??
    product.nativeUnitPrice?.dimension ??
    "none";
  const evidenceMode = product.abstainReason
    ? `abstain:${product.abstainReason}`
    : product.quantity && product.nativeUnitPrice
      ? "native-and-derived"
      : product.nativeUnitPrice
        ? "native-only"
        : "derived-only";
  return [
    layout,
    product.scope ?? "primary-results",
    dimension,
    evidenceMode,
    product.quantity && product.quantity.packCount > 1 ? "multipack" : "single",
    product.pricePresentation ?? "plain",
    product.titleIncludesQuantity ? "quantity-in-title" : "quantity-separate",
    [...(product.challengeTags ?? [])].sort().join("+") || "ordinary"
  ].join("|");
}

const palettes = [
  {
    page: "#e7edf0",
    surface: "#ffffff",
    card: "#ffffff",
    header: "#123d35",
    headerInk: "#ffffff",
    ink: "#17201f",
    muted: "#596663",
    line: "#c8d1ce",
    chip: "#eef5f0",
    media: "#eef1ed",
    package: "#f0d84a",
    packageInk: "#173d35",
    accent: "#0b6b55",
    buttonInk: "#ffffff",
    font: "Arial, sans-serif"
  },
  {
    page: "#f2f3f5",
    surface: "#fdfdfd",
    card: "#ffffff",
    header: "#f5c400",
    headerInk: "#202020",
    ink: "#222222",
    muted: "#686868",
    line: "#d8d8d8",
    chip: "#f5f5f5",
    media: "#e9eef5",
    package: "#2457a6",
    packageInk: "#ffffff",
    accent: "#b42318",
    buttonInk: "#ffffff",
    font: "Verdana, sans-serif"
  },
  {
    page: "#edf0f5",
    surface: "#ffffff",
    card: "#fbfcfe",
    header: "#1d3557",
    headerInk: "#ffffff",
    ink: "#17253b",
    muted: "#607087",
    line: "#cfd7e3",
    chip: "#eaf1fa",
    media: "#f3eee8",
    package: "#d1495b",
    packageInk: "#ffffff",
    accent: "#1d5e91",
    buttonInk: "#ffffff",
    font: "Tahoma, sans-serif"
  },
  {
    page: "#f0eee8",
    surface: "#fffefa",
    card: "#ffffff",
    header: "#ffffff",
    headerInk: "#121212",
    ink: "#20201e",
    muted: "#69675f",
    line: "#d6d2c7",
    chip: "#f1eee5",
    media: "#e7f0ed",
    package: "#ef8354",
    packageInk: "#20201e",
    accent: "#326771",
    buttonInk: "#ffffff",
    font: "Georgia, serif"
  }
] as const;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatUnitPrice(centsPerUnit: number, unitLabel: string): string {
  return centsPerUnit < 100
    ? `${round(centsPerUnit, 1).toFixed(1)} ¢/${unitLabel}`
    : `$${(centsPerUnit / 100).toFixed(2)}/${unitLabel}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function packageLabel(title: string): string {
  return title
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 3)
    .join(" ")
    .toUpperCase();
}

function siteLabel(siteId: string): string {
  return siteId
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
