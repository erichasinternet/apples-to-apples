import { DEFAULT_PREFERENCES } from "../core/types";
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
