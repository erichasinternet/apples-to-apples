const MESSAGE_SCAN_NOW = "ATA_SCAN_NOW";

const runButton = document.querySelector<HTMLButtonElement>("#run-tab");
const statusElement = document.querySelector<HTMLElement>("#status");

void initialize();

function initialize(): void {
  runButton?.addEventListener("click", () => {
    void runOnActiveTab();
  });
}

async function runOnActiveTab(): Promise<void> {
  setStatus("Scanning...");

  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus("No active tab");
    return;
  }

  await cleanupOldUi(tab.id);

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch {
    // It may already be injected on supported shopping sites.
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_SCAN_NOW });
    const count = typeof response?.count === "number" ? response.count : 0;
    setStatus(count > 0 ? `${count} products found` : "No comparable products found");
  } catch {
    setStatus("This page cannot be scanned");
  }
}

async function cleanupOldUi(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        for (const panel of document.querySelectorAll("#ata-panel-root, [data-ata-panel-root]")) {
          panel.remove();
        }

        for (const staleBadgePart of document.querySelectorAll(
          "[data-ata-badge] .ata-badge-confidence, [data-ata-badge] .ata-evidence-strip"
        )) {
          staleBadgePart.remove();
        }
      }
    });
  } catch {
    // Some browser pages do not allow script execution.
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(value: string): void {
  if (statusElement) {
    statusElement.textContent = value;
  }
}
