import {
  MESSAGE_GET_PAGE_STATUS,
  MESSAGE_RESTORE_PAGE_ORDER,
  MESSAGE_SCAN_NOW,
  MESSAGE_SORT_PAGE,
  type PageStatus
} from "../extension/messages";

const summaryCount = document.querySelector<HTMLElement>("#summary-count");
const summaryDetail = document.querySelector<HTMLElement>("#summary-detail");
const basisField = document.querySelector<HTMLElement>("#basis-field");
const basisSelect = document.querySelector<HTMLSelectElement>("#basis");
const sortButton = document.querySelector<HTMLButtonElement>("#sort-loaded");
const rescanButton = document.querySelector<HTMLButtonElement>("#rescan");
const statusElement = document.querySelector<HTMLElement>("#status");

let currentStatus: PageStatus | undefined;

void initialize();

async function initialize(): Promise<void> {
  basisSelect?.addEventListener("change", updateControls);
  sortButton?.addEventListener("click", () => void toggleSort());
  rescanButton?.addEventListener("click", () => void refresh(true));
  await refresh(false);
}

async function refresh(forceScan: boolean): Promise<void> {
  setOperationStatus(forceScan ? "Scanning page..." : "Reading page...");
  const tab = await getActiveTab();

  if (!tab?.id) {
    renderUnavailable("No active tab");
    return;
  }

  if (forceScan) {
    await ensureContentScript(tab.id);
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: forceScan ? MESSAGE_SCAN_NOW : MESSAGE_GET_PAGE_STATUS
    })) as PageStatus;
    renderStatus(response);
    setOperationStatus(forceScan ? "Scan complete" : "");
  } catch {
    if (!forceScan) {
      await ensureContentScript(tab.id);
      try {
        const response = (await chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_SCAN_NOW
        })) as PageStatus;
        renderStatus(response);
        setOperationStatus("");
        return;
      } catch {
        // Restricted browser pages cannot host content scripts.
      }
    }

    renderUnavailable("This page cannot be scanned");
  }
}

async function toggleSort(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id || !basisSelect || !currentStatus) {
    return;
  }

  const restoring =
    currentStatus.sortActive &&
    currentStatus.activeSortCompareKey === basisSelect.value;
  setOperationStatus(restoring ? "Restoring retailer order..." : "Sorting loaded items...");

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, {
      type: restoring ? MESSAGE_RESTORE_PAGE_ORDER : MESSAGE_SORT_PAGE,
      compareKey: basisSelect.value
    })) as PageStatus;
    renderStatus(response);
    setOperationStatus(response.sortMessage);
  } catch {
    setOperationStatus("Page order could not be changed");
  }
}

function renderStatus(status: PageStatus): void {
  currentStatus = status;
  const previousBasis = basisSelect?.value;
  const sortableGroups = status.groups.filter((group) => group.canSort);
  const primaryGroup =
    sortableGroups.find((group) => group.compareKey === status.activeSortCompareKey) ??
    sortableGroups.find((group) => group.compareKey === previousBasis) ??
    sortableGroups[0];

  setText(
    summaryCount,
    status.count === 1
      ? "1 comparable item on this page"
      : `${status.count} comparable items on this page`
  );

  if (status.count === 0) {
    setText(summaryDetail, "No unit-price comparison found");
  } else if (status.groups.length === 1) {
    setText(summaryDetail, `${status.groups[0]!.count} ${status.groups[0]!.label}`);
  } else {
    setText(summaryDetail, `${status.groups.length} comparison bases found`);
  }

  if (basisSelect) {
    basisSelect.replaceChildren(
      ...sortableGroups.map((group) => {
        const option = document.createElement("option");
        option.value = group.compareKey;
        option.textContent = `${group.label} (${group.count})`;
        return option;
      })
    );
    if (primaryGroup) {
      basisSelect.value = primaryGroup.compareKey;
    }
  }

  basisField?.toggleAttribute("hidden", sortableGroups.length === 0);
  updateControls();
}

function updateControls(): void {
  if (!sortButton || !basisSelect || !currentStatus) {
    return;
  }

  const selectedGroup = currentStatus.groups.find(
    (group) => group.compareKey === basisSelect.value
  );
  const restoring =
    currentStatus.sortActive &&
    currentStatus.activeSortCompareKey === basisSelect.value;

  sortButton.disabled = !selectedGroup?.canSort;
  sortButton.textContent = restoring
    ? "Restore retailer order"
    : selectedGroup
      ? `Sort loaded items ${selectedGroup.label}`
      : "Sort loaded items";
}

function renderUnavailable(message: string): void {
  currentStatus = undefined;
  setText(summaryCount, message);
  setText(summaryDetail, "");
  basisField?.setAttribute("hidden", "");
  if (sortButton) {
    sortButton.disabled = true;
  }
  setOperationStatus("");
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch {
    // The script may already be injected or the page may be restricted.
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setOperationStatus(value: string): void {
  setText(statusElement, value);
}

function setText(element: HTMLElement | null, value: string): void {
  if (element) {
    element.textContent = value;
  }
}
