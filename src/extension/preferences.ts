import type { UserPreferences } from "../core/types";
import { DEFAULT_PREFERENCES } from "../core/types";

const STORAGE_KEY = "ata.preferences";

export async function getPreferences(): Promise<UserPreferences> {
  const stored = await readStoredPreferences();
  return mergePreferences(stored);
}

export async function setPreferences(preferences: UserPreferences): Promise<void> {
  await writeStoredPreferences(mergePreferences(preferences));
}

export function mergePreferences(value: unknown): UserPreferences {
  const input = isRecord(value) ? value : {};
  const preferredUnits = isRecord(input.preferredUnits) ? input.preferredUnits : {};

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_PREFERENCES.enabled,
    includeRewards:
      typeof input.includeRewards === "boolean" ? input.includeRewards : DEFAULT_PREFERENCES.includeRewards,
    showLowestSignal:
      typeof input.showLowestSignal === "boolean"
        ? input.showLowestSignal
        : DEFAULT_PREFERENCES.showLowestSignal,
    preferredUnits: {
      mass: preferredUnits.mass === "oz" || preferredUnits.mass === "kg" || preferredUnits.mass === "g" ? preferredUnits.mass : "lb",
      volume:
        preferredUnits.volume === "l" ||
        preferredUnits.volume === "ml" ||
        preferredUnits.volume === "gal" ||
        preferredUnits.volume === "fl_oz"
          ? preferredUnits.volume
          : "fl_oz",
      count: "each",
      area: preferredUnits.area === "sq_in" ? "sq_in" : "sq_ft",
      length: preferredUnits.length === "in" ? "in" : "ft"
    }
  };
}

async function readStoredPreferences(): Promise<unknown> {
  if (globalThis.chrome?.storage?.local) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY];
  }

  try {
    return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return undefined;
  }
}

async function writeStoredPreferences(preferences: UserPreferences): Promise<void> {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: preferences });
    return;
  }

  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
