import { getPreferences } from "../extension/preferences";
import {
  MESSAGE_GET_PAGE_STATUS,
  MESSAGE_PAGE_STATUS_UPDATED,
  MESSAGE_RESTORE_PAGE_ORDER,
  MESSAGE_SCAN_NOW,
  MESSAGE_SORT_PAGE,
  type PageStatus
} from "../extension/messages";
import type { UserPreferences } from "../core/types";
import { buildComparisonGroups } from "./comparison";
import { extractProductsFromDocument } from "./extractor";
import type { DomProduct } from "./extractor";
import { clearRenderedProducts, removeLegacyUi, renderProducts } from "./renderer";
import {
  canSortByUnitPrice,
  getActiveSortCompareKey,
  getUnitPriceSortMessage,
  isUnitPriceSortActive,
  restoreUnitPriceSort,
  sortByUnitPrice
} from "./sorter";

declare global {
  interface Window {
    __ATA_CONTENT_LOADED__?: boolean;
  }
}

const MESSAGE_GET_STATS = "ATA_GET_STATS";

let lastScanCount = 0;
let lastProducts: DomProduct[] = [];
let lastPreferences: UserPreferences | undefined;
let observer: MutationObserver | undefined;
let scanTimer: number | undefined;

void boot();

async function boot(): Promise<void> {
  removeLegacyUi();

  if (window.__ATA_CONTENT_LOADED__) {
    await scanNow();
    return;
  }

  window.__ATA_CONTENT_LOADED__ = true;
  await scanNow();
  setupMutationObserver();
  setupMessages();
}

async function scanNow(): Promise<void> {
  removeLegacyUi();

  const preferences = await getPreferences();
  lastPreferences = preferences;
  if (!preferences.enabled) {
    if (isUnitPriceSortActive()) {
      restoreUnitPriceSort();
    }
    lastProducts = [];
    lastScanCount = 0;
    clearRenderedProducts();
    reportPageStatus();
    return;
  }

  const products = extractProductsFromDocument(document, preferences);
  lastProducts = products;
  lastScanCount = products.length;
  renderProducts(products, preferences);
  reportPageStatus();
}

function setupMutationObserver(): void {
  observer?.disconnect();
  observer = new MutationObserver((mutations) => {
    const hasMeaningfulChange = mutations.some(isMeaningfulMutation);

    if (hasMeaningfulChange) {
      debounceScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true
  });
}

function isMeaningfulMutation(mutation: MutationRecord): boolean {
  if (mutation.type === "characterData") {
    const parent = mutation.target.parentElement;
    return Boolean(
      parent &&
        !isExtensionNode(parent) &&
        (looksLikeProductEvidence(mutation.target.textContent) ||
          looksLikeProductEvidence(mutation.oldValue))
    );
  }

  return [...mutation.addedNodes].some((node) => {
    if (node instanceof HTMLElement) {
      return !isExtensionNode(node);
    }

    const parent = node.parentElement;
    return Boolean(
      node.nodeType === Node.TEXT_NODE &&
        parent &&
        !isExtensionNode(parent) &&
        looksLikeProductEvidence(node.textContent)
    );
  });
}

function looksLikeProductEvidence(value: string | null): boolean {
  return Boolean(
    value &&
      /(?:\$\s*\d|\d(?:[\d,.]*\d)?\s*¢|\b\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|lb|lbs|count|ct|pack|roll|sheet|tablet|capsule|sq\s*ft)\b)/i.test(
        value
      )
  );
}

function isExtensionNode(node: HTMLElement): boolean {
  return Boolean(
    node.matches(
      "#ata-content-style, [data-ata-badge], [data-ata-sort-control], [data-ata-custom-sort-option]"
    ) ||
      node.closest(
        "[data-ata-badge], [data-ata-sort-control], [data-ata-custom-sort-option]"
      )
  );
}

function debounceScan(): void {
  if (scanTimer) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    void scanNow();
  }, 650);
}

function setupMessages(): void {
  if (!globalThis.chrome?.runtime?.onMessage) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_SCAN_NOW) {
      void scanNow().then(() => sendResponse(buildPageStatus()));
      return true;
    }

    if (message?.type === MESSAGE_GET_STATS || message?.type === MESSAGE_GET_PAGE_STATUS) {
      sendResponse(buildPageStatus());
      return false;
    }

    if (message?.type === MESSAGE_SORT_PAGE && typeof message.compareKey === "string") {
      const result = sortByUnitPrice(lastProducts, message.compareKey);
      if (lastPreferences) {
        renderProducts(lastProducts, lastPreferences);
      }
      reportPageStatus();
      sendResponse({ ...buildPageStatus(), result });
      return false;
    }

    if (message?.type === MESSAGE_RESTORE_PAGE_ORDER) {
      const result = restoreUnitPriceSort();
      if (lastPreferences) {
        renderProducts(lastProducts, lastPreferences);
      }
      reportPageStatus();
      sendResponse({ ...buildPageStatus(), result });
      return false;
    }

    return false;
  });
}

function buildPageStatus(): PageStatus {
  const activeSortCompareKey = getActiveSortCompareKey();

  return {
    ok: true,
    count: lastScanCount,
    groups: buildComparisonGroups(lastProducts).map((group) => ({
      ...group,
      canSort: group.count >= 2 && canSortByUnitPrice(lastProducts, group.compareKey)
    })),
    ...(activeSortCompareKey ? { activeSortCompareKey } : {}),
    sortActive: isUnitPriceSortActive(),
    sortMessage: getUnitPriceSortMessage()
  };
}

function reportPageStatus(): void {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return;
  }

  void chrome.runtime
    .sendMessage({
      type: MESSAGE_PAGE_STATUS_UPDATED,
      status: buildPageStatus()
    })
    .catch(() => undefined);
}
