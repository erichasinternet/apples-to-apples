import { DEFAULT_PREFERENCES } from "../core/types";
import { MESSAGE_PAGE_STATUS_UPDATED, type PageStatus } from "./messages";
import { getPreferences, setPreferences } from "./preferences";

chrome.runtime.onInstalled.addListener(() => {
  void getPreferences().then((preferences) => {
    void setPreferences({
      ...DEFAULT_PREFERENCES,
      ...preferences,
      preferredUnits: {
        ...DEFAULT_PREFERENCES.preferredUnits,
        ...preferences.preferredUnits
      }
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    message?.type !== MESSAGE_PAGE_STATUS_UPDATED ||
    !sender.tab?.id ||
    !isPageStatus(message.status)
  ) {
    return;
  }

  const count = message.status.count;
  void chrome.action.setBadgeBackgroundColor({
    tabId: sender.tab.id,
    color: "#236652"
  });
  void chrome.action.setBadgeText({
    tabId: sender.tab.id,
    text: count > 99 ? "99+" : count > 0 ? String(count) : ""
  });
  void chrome.action.setTitle({
    tabId: sender.tab.id,
    title: count > 0 ? `${count} comparable items on this page` : "Compare unit prices"
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") {
    return;
  }

  void chrome.action.setBadgeText({ tabId, text: "" });
  void chrome.action.setTitle({ tabId, title: "Compare unit prices" });
});

function isPageStatus(value: unknown): value is PageStatus {
  return Boolean(
    value &&
      typeof value === "object" &&
      "count" in value &&
      typeof (value as { count: unknown }).count === "number"
  );
}
