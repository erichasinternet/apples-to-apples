import type { Evidence, Money, ProductInput, Quantity } from "../core/types";
import {
  findBestPrice,
  isLikelyPackageQuantity,
  parseQuantities,
  selectPackageQuantity
} from "../core/pricing";

interface JsonObject {
  [key: string]: unknown;
}

export function extractStructuredProducts(document: Document, site: string): ProductInput[] {
  const products: ProductInput[] = [];
  const scripts = [...document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']")];

  scripts.forEach((script, scriptIndex) => {
    const json = parseJson(script.textContent ?? "");
    if (!json) {
      return;
    }

    for (const node of flattenJsonLd(json)) {
      if (!isProductNode(node)) {
        continue;
      }

      const title = textValue(node.name) || textValue(node.headline) || document.title || "Product";
      const offer = firstObject(node.offers);
      const price = moneyFromOffer(offer) ?? findBestPrice(JSON.stringify(node));
      const quantities = parseQuantities(JSON.stringify(node)).filter(
        (quantity) => isLikelyPackageQuantity(title, quantity)
      );
      const packageQuantity = selectPackageQuantity(quantities);
      const evidence: Evidence[] = [
        {
          kind: "structured-data",
          text: "Product JSON-LD"
        }
      ];

      products.push({
        id: `structured-${scriptIndex}-${products.length}`,
        site,
        pageType: "product",
        title,
        evidence,
        ...(price ? { price } : {}),
        ...(packageQuantity ? { packageQuantity } : {})
      });
    }
  });

  return products;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function flattenJsonLd(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJsonLd);
  }

  if (isObject(value)) {
    const graph = value["@graph"];
    return [value, ...flattenJsonLd(graph)];
  }

  return [];
}

function isProductNode(value: JsonObject): boolean {
  const type = value["@type"];
  if (Array.isArray(type)) {
    return type.some((entry) => String(entry).toLowerCase() === "product");
  }

  return String(type).toLowerCase() === "product";
}

function moneyFromOffer(offer: JsonObject | undefined): Money | undefined {
  if (!offer) {
    return undefined;
  }

  const price = Number.parseFloat(String(offer.price ?? ""));
  if (!Number.isFinite(price) || price <= 0) {
    return undefined;
  }

  return {
    cents: Math.round(price * 100),
    currency: "USD",
    sourceText: `$${price.toFixed(2)}`,
    index: 0
  };
}

function firstObject(value: unknown): JsonObject | undefined {
  if (Array.isArray(value)) {
    return value.find(isObject);
  }

  return isObject(value) ? value : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
