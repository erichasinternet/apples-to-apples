import type { CanonicalUnit } from "../core/types";
import { getPreferences, setPreferences } from "../extension/preferences";

const form = document.querySelector<HTMLFormElement>("#preferences-form");
const statusElement = document.querySelector<HTMLElement>("#status");

void initialize();

async function initialize(): Promise<void> {
  const preferences = await getPreferences();
  if (!form) {
    return;
  }

  setSelect("mass", preferences.preferredUnits.mass);
  setSelect("volume", preferences.preferredUnits.volume);
  setSelect("area", preferences.preferredUnits.area);
  setSelect("length", preferences.preferredUnits.length);
  setCheckbox("includeRewards", preferences.includeRewards);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void save();
  });
}

async function save(): Promise<void> {
  if (!form) {
    return;
  }

  const data = new FormData(form);
  const preferences = await getPreferences();

  await setPreferences({
    ...preferences,
    includeRewards: data.get("includeRewards") === "on",
    preferredUnits: {
      ...preferences.preferredUnits,
      mass: readSelect("mass") as CanonicalUnit,
      volume: readSelect("volume") as CanonicalUnit,
      area: readSelect("area") as CanonicalUnit,
      length: readSelect("length") as CanonicalUnit
    }
  });

  setStatus("Saved");
}

function setSelect(name: string, value: string): void {
  const select = form?.elements.namedItem(name);
  if (select instanceof HTMLSelectElement) {
    select.value = value;
  }
}

function readSelect(name: string): string {
  const select = form?.elements.namedItem(name);
  return select instanceof HTMLSelectElement ? select.value : "";
}

function setCheckbox(name: string, checked: boolean): void {
  const checkbox = form?.elements.namedItem(name);
  if (checkbox instanceof HTMLInputElement) {
    checkbox.checked = checked;
  }
}

function setStatus(value: string): void {
  if (statusElement) {
    statusElement.textContent = value;
  }
}
