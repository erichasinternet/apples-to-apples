import { vi } from "vitest";
import type { PageStatus } from "../../src/extension/messages";

describe("popup page status controls", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <p id="summary-count"></p>
      <p id="summary-detail"></p>
      <div id="basis-field" hidden>
        <label for="basis">Compare</label>
        <select id="basis"></select>
      </div>
      <button id="sort-loaded" type="button" disabled>Sort loaded items</button>
      <button id="rescan" type="button">Rescan</button>
      <div id="status"></div>
    `;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads automatically and sends explicit basis sort and restore commands", async () => {
    const initial = status(false);
    const sorted = status(true);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(sorted)
      .mockResolvedValueOnce(initial);

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 42 }]),
        sendMessage
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    });

    await import("../../src/popup/popup");
    await vi.waitFor(() => {
      expect(document.querySelector("#summary-count")?.textContent).toBe(
        "18 comparable items on this page"
      );
    });

    const select = document.querySelector<HTMLSelectElement>("#basis")!;
    const sortButton = document.querySelector<HTMLButtonElement>("#sort-loaded")!;
    expect(select.value).toBe("mass:lb");
    expect(select.selectedOptions[0]?.textContent).toBe("per lb (18)");
    expect(sortButton.textContent).toBe("Sort loaded items per lb");

    sortButton.click();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(42, {
        type: "ATA_SORT_PAGE",
        compareKey: "mass:lb"
      });
      expect(sortButton.textContent).toBe("Restore retailer order");
    });

    sortButton.click();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(42, {
        type: "ATA_RESTORE_PAGE_ORDER",
        compareKey: "mass:lb"
      });
      expect(sortButton.textContent).toBe("Sort loaded items per lb");
    });
  });
});

function status(sorted: boolean): PageStatus {
  return {
    ok: true,
    count: 18,
    groups: [
      {
        compareKey: "mass:lb",
        unit: "lb",
        dimension: "mass",
        count: 18,
        label: "per lb",
        sortLabel: "Unit price per lb: low to high",
        canSort: true
      }
    ],
    ...(sorted ? { activeSortCompareKey: "mass:lb" } : {}),
    sortActive: sorted,
    sortMessage: sorted
      ? "Sorted 18 loaded items by unit price."
      : "Comparable loaded items only."
  };
}
