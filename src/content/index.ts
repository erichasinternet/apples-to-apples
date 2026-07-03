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
    const hasMeaningfulChange = mutations.some((mutation) =>
      [...mutation.addedNodes].some((node) => node instanceof HTMLElement && !node.closest("[data-ata-sort-control]"))
    );

    if (hasMeaningfulChange) {
      debounceScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
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
