import type { NormalizedProduct, ProductInput, Quantity, UserPreferences } from "../core/types";
import {
  extractPackCount,
  findBestPrice,
  isLikelyPackageQuantity,
  parseNativeUnitPrices,
  parseQuantities,
  selectPackageQuantity
} from "../core/pricing";
import { normalizeProduct } from "../core/normalizer";
import { getSiteAdapter, type SiteAdapter } from "./site-adapters";
import { extractStructuredProducts } from "./structured-data";

export interface DomProduct extends NormalizedProduct {
  element: HTMLElement;
  insertionTarget: HTMLElement;
}

interface CandidateElement {
  element: HTMLElement;
  score: number;
  textLength: number;
}

const MAX_CANDIDATES = 160;
const PRODUCT_WORDS =
  /\b(oz|lb|lbs|ounce|pound|count|ct|pack|roll|sheet|fl oz|fluid ounce|liter|gallon|tablet|capsule|diaper|bag|sq ft)\b/i;

export function extractProductsFromDocument(
  document: Document,
  preferences: UserPreferences,
  hostname = document.location.hostname
): DomProduct[] {
  const adapter = getSiteAdapter(hostname);
  const cards = collectProductCards(document, adapter);
  const products = cards
    .map((element, index) => extractProductFromCard(element, index, adapter, hostname, preferences))
    .filter((product): product is DomProduct => Boolean(product?.normalized));

  if (products.length > 0) {
    return dedupeProducts(products);
  }

  return structuredFallback(document, hostname, preferences);
}

function collectProductCards(document: Document, adapter: SiteAdapter): HTMLElement[] {
  const selectors = [...adapter.cardSelectors, ...getSiteAdapter("generic").cardSelectors];
  const scored = new Map<HTMLElement, CandidateElement>();

  for (const selector of selectors) {
    for (const element of [...document.querySelectorAll<HTMLElement>(selector)].slice(0, MAX_CANDIDATES * 2)) {
      const score = scoreElement(element);
      if (score <= 0) {
        continue;
      }

      const previous = scored.get(element);
      if (!previous || previous.score < score) {
        scored.set(element, {
          element,
          score,
          textLength: getVisibleText(element).length
        });
      }
    }
  }

  const ranked = [...scored.values()].sort(
    (left, right) => right.score - left.score || left.textLength - right.textLength
  );
  const selected: HTMLElement[] = [];

  for (const candidate of ranked) {
    if (selected.length >= MAX_CANDIDATES) {
      break;
    }

    const overlaps = selected.some(
      (selectedElement) =>
        selectedElement === candidate.element ||
        selectedElement.contains(candidate.element) ||
        candidate.element.contains(selectedElement)
    );

    if (!overlaps) {
      selected.push(candidate.element);
    }
  }

  return selected;
}

function scoreElement(element: HTMLElement): number {
  if (element.closest("[data-ata-sort-control], [data-ata-badge]")) {
    return 0;
  }

  const text = getVisibleText(element);
  if (text.length < 24 || text.length > 2600) {
    return 0;
  }

  let score = 0;

  if (/\$\s*\d/.test(text)) {
    score += 4;
  }

  if (/(?:¢|cents?)\s*(?:\/|per)|\$\s*\d+(?:\.\d{2})?\s*(?:\/|per)/i.test(text)) {
    score += 4;
  }

  if (PRODUCT_WORDS.test(text)) {
    score += 3;
  }

  if (element.querySelector("a[href]")) {
    score += 2;
  }

  if (element.querySelector("img, picture, source")) {
    score += 1;
  }

  if (/\b(add|cart|subscribe|options|pickup|delivery)\b/i.test(text)) {
    score += 1;
  }

  if (element.matches("[data-asin], [data-item-id], [itemtype*='Product']")) {
    score += 3;
  }

  return score >= 7 ? score : 0;
}

function extractProductFromCard(
  element: HTMLElement,
  index: number,
  adapter: SiteAdapter,
  hostname: string,
  preferences: UserPreferences
): DomProduct | undefined {
  const text = getVisibleText(element);
  const title = extractTitle(element, adapter) || extractLineTitle(text);

  if (!title || title.length < 4) {
    return undefined;
  }

  const scopedPriceText = extractScopedText(element, adapter.priceSelectors) || text;
  const nativeUnitPrices = parseNativeUnitPrices(text);
  const preferredNativeUnitPrice = nativeUnitPrices[0];
  const titleQuantities = parseQuantities(title);
  const allQuantities = [...titleQuantities, ...parseQuantities(text)].filter(
    (quantity) => isLikelyPackageQuantity(title, quantity)
  );
  const packageQuantity = selectPackageQuantity(allQuantities, preferredNativeUnitPrice?.dimension);
  const rankedPackageQuantity = raiseTitleQuantityIfFromTitle(packageQuantity, title);
  const price = findBestPrice(scopedPriceText) ?? findBestPrice(text);
  const packCount = extractPackCount(title) ?? extractPackCount(text);

  const input: ProductInput = {
    id: `${hostname}-${index}-${hashText(title)}`,
    site: adapter.id,
    pageType: inferPageType(document.location.pathname),
    title,
    evidence: [
      {
        kind: "title",
        text: title
      },
      {
        kind: "dom-proximity",
        text: adapter.label
      }
    ],
    ...(price ? { price } : {}),
    ...(preferredNativeUnitPrice ? { nativeUnitPrice: preferredNativeUnitPrice } : {}),
    ...(rankedPackageQuantity ? { packageQuantity: rankedPackageQuantity } : {}),
    ...(packCount ? { packCount } : {})
  };

  const normalized = normalizeProduct(input, preferences);
  if (!normalized.normalized) {
    return undefined;
  }

  return {
    ...normalized,
    element,
    insertionTarget: findInsertionTarget(element, adapter)
  };
}

function structuredFallback(document: Document, hostname: string, preferences: UserPreferences): DomProduct[] {
  const root = document.querySelector<HTMLElement>("main, [role='main'], body");
  if (!root) {
    return [];
  }

  return extractStructuredProducts(document, hostname)
    .map((product) => normalizeProduct(product, preferences))
    .filter((product): product is NormalizedProduct & { normalized: NonNullable<NormalizedProduct["normalized"]> } =>
      Boolean(product.normalized)
    )
    .map((product) => ({
      ...product,
      element: root,
      insertionTarget: root
    }));
}

function extractTitle(element: HTMLElement, adapter: SiteAdapter): string | undefined {
  for (const selector of adapter.titleSelectors) {
    const titleElement = element.querySelector<HTMLElement>(selector);
    const title = titleElement ? cleanCandidateTitle(titleElement.getAttribute("aria-label") || getVisibleText(titleElement)) : undefined;

    if (title) {
      return title;
    }
  }

  const links = [...element.querySelectorAll<HTMLAnchorElement>("a[href]")];
  for (const link of links) {
    const title = cleanCandidateTitle(link.getAttribute("aria-label") || getVisibleText(link));
    if (title) {
      return title;
    }
  }

  return undefined;
}

function extractLineTitle(text: string): string | undefined {
  const lines = text
    .split(/(?:\n| {2,})/)
    .map(cleanCandidateTitle)
    .filter((line): line is string => Boolean(line));

  return lines.sort((left, right) => Number(PRODUCT_WORDS.test(right)) - Number(PRODUCT_WORDS.test(left)))[0];
}

function cleanCandidateTitle(value: string): string | undefined {
  const cleaned = value.replace(/\s+/g, " ").trim();

  if (
    cleaned.length < 8 ||
    cleaned.length > 220 ||
    /^\$/.test(cleaned) ||
    /^(?:add|remove|compare|subscribe|sponsored|shipping|pickup|delivery|options|quick view|buy|sign in|create account)\b/i.test(
      cleaned
    ) ||
    /^\d+\s+pack$/i.test(cleaned)
  ) {
    return undefined;
  }

  return cleaned;
}

function findInsertionTarget(element: HTMLElement, adapter: SiteAdapter): HTMLElement {
  for (const selector of [...adapter.priceSelectors, ...adapter.titleSelectors]) {
    const target = element.querySelector<HTMLElement>(selector);
    if (target) {
      return target;
    }
  }

  return element;
}

function extractScopedText(element: HTMLElement, selectors: readonly string[]): string | undefined {
  const parts: string[] = [];

  for (const selector of selectors) {
    for (const matched of element.querySelectorAll<HTMLElement>(selector)) {
      parts.push(getVisibleText(matched));
    }
  }

  return parts.length > 0 ? parts.join(" ") : undefined;
}

function getVisibleText(element: Element): string {
  if (
    element.matches("[data-ata-badge], [data-ata-custom-sort-option], [data-ata-sort-control]")
  ) {
    return "";
  }

  if (
    !element.querySelector(
      "[data-ata-badge], [data-ata-custom-sort-option], [data-ata-sort-control]"
    )
  ) {
    return (
      (element as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ||
      element.textContent?.replace(/\s+/g, " ").trim() ||
      ""
    );
  }

  const clone = element.cloneNode(true) as Element;
  for (const extensionNode of clone.querySelectorAll(
    "[data-ata-badge], [data-ata-custom-sort-option], [data-ata-sort-control]"
  )) {
    extensionNode.remove();
  }

  return clone.textContent?.replace(/\s+/g, " ").trim() || "";
}

function raiseTitleQuantityIfFromTitle(quantity: Quantity | undefined, title: string): Quantity | undefined {
  if (!quantity || quantity.rank >= 3) {
    return quantity;
  }

  if (title.includes(quantity.sourceText)) {
    return {
      ...quantity,
      rank: 3
    };
  }

  return quantity;
}

function inferPageType(pathname: string): ProductInput["pageType"] {
  if (/\/(?:ip|dp|p|product)\//i.test(pathname)) {
    return "product";
  }

  if (/cart|checkout/i.test(pathname)) {
    return "cart";
  }

  if (/search|s\?|browse|category|cat/i.test(pathname)) {
    return "search";
  }

  return "unknown";
}

function dedupeProducts(products: DomProduct[]): DomProduct[] {
  const seen = new Set<string>();
  const deduped: DomProduct[] = [];

  for (const product of products) {
    const key = `${product.title.toLowerCase()}::${product.normalized?.display}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(product);
  }

  return deduped;
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}
