import { getPreferences } from "../extension/preferences";
import { extractProductsFromDocument } from "./extractor";
import { removeLegacyUi, renderProducts } from "./renderer";

declare global {
  interface Window {
    __ATA_CONTENT_LOADED__?: boolean;
  }
}

const MESSAGE_SCAN_NOW = "ATA_SCAN_NOW";
const MESSAGE_GET_STATS = "ATA_GET_STATS";

let lastScanCount = 0;
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
  if (!preferences.enabled) {
    return;
  }

  const products = extractProductsFromDocument(document, preferences);
  lastScanCount = products.length;
  renderProducts(products, preferences);
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
      void scanNow().then(() => sendResponse({ ok: true, count: lastScanCount }));
      return true;
    }

    if (message?.type === MESSAGE_GET_STATS) {
      sendResponse({ ok: true, count: lastScanCount });
      return false;
    }

    return false;
  });
}
