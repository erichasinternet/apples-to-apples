import type { NormalizedPrice, UserPreferences } from "../core/types";
import type { DomProduct } from "./extractor";
import {
  isUnitPriceSortActive,
  restoreUnitPriceSort,
  sortByUnitPrice
} from "./sorter";

const STYLE_ID = "ata-content-style";
const SORT_CONTROL_SELECTOR = "[data-ata-sort-control]";
const CUSTOM_SORT_OPTION_SELECTOR = "[data-ata-custom-sort-option]";
const SORT_OPTION_VALUE = "ata-unit-price-asc";

type CustomSortTrigger = HTMLElement & {
  __ataSortProducts?: DomProduct[];
  __ataSortPreferences?: UserPreferences;
  __ataSortMenuActivated?: boolean;
  __ataSortClickHandler?: EventListener;
  __ataSortKeyHandler?: EventListener;
  __ataSortObserver?: MutationObserver;
};

type CustomSortOption = HTMLElement & {
  __ataSelectHandler?: EventListener;
  __ataKeyHandler?: EventListener;
};

export function renderProducts(products: DomProduct[], preferences: UserPreferences): void {
  injectStyles(document);
  removeLegacyUi();
  renderBadges(products);
  renderSortControls(products, preferences);
}

function renderBadges(products: DomProduct[]): void {
  for (const product of products) {
    if (!product.normalized) {
      continue;
    }

    const badge = product.element.querySelector<HTMLElement>("[data-ata-badge]") ?? document.createElement("div");
    badge.dataset.ataBadge = "true";
    badge.dataset.ataCentsPerUnit = String(product.normalized.centsPerUnit);
    badge.dataset.ataUnit = product.normalized.unit;
    badge.dataset.ataDimension = product.normalized.dimension;
    badge.className = "ata-badge";
    badge.title = buildTitle(product.normalized);
    badge.innerHTML = badgeMarkup(product.normalized);

    if (!badge.isConnected) {
      product.insertionTarget.insertAdjacentElement("afterend", badge);
    }
  }
}

function renderSortControls(products: DomProduct[], preferences: UserPreferences): void {
  removeInlineSortControls();

  if (enhanceNativeSortSelect(products, preferences)) {
    return;
  }

  enhanceCustomSortDropdown(products, preferences);
}

function enhanceNativeSortSelect(products: DomProduct[], preferences: UserPreferences): boolean {
  const select = findSortSelect();
  if (!select) {
    return false;
  }

  let option = select.querySelector<HTMLOptionElement>(`option[value="${SORT_OPTION_VALUE}"]`);
  if (!option) {
    option = document.createElement("option");
    option.value = SORT_OPTION_VALUE;
    option.textContent = "Unit price: low to high";
    option.dataset.ataSortOption = "true";
    select.append(option);
  }

  select.dataset.ataSortEnhanced = "true";
  select.dataset.ataPreviousSortValue ||= select.value;

  const previousHandler = (select as HTMLSelectElement & { __ataSortHandler?: EventListener }).__ataSortHandler;
  if (previousHandler) {
    select.removeEventListener("change", previousHandler);
  }

  const handler: EventListener = () => {
    if (select.value === SORT_OPTION_VALUE) {
      sortByUnitPrice(products, preferences);
      return;
    }

    if (isUnitPriceSortActive()) {
      restoreUnitPriceSort();
    }

    select.dataset.ataPreviousSortValue = select.value;
  };

  (select as HTMLSelectElement & { __ataSortHandler?: EventListener }).__ataSortHandler = handler;
  select.addEventListener("change", handler);

  if (isUnitPriceSortActive()) {
    select.value = SORT_OPTION_VALUE;
  }

  return true;
}

function enhanceCustomSortDropdown(products: DomProduct[], preferences: UserPreferences): boolean {
  const trigger = findCustomSortTrigger();
  if (!trigger) {
    return false;
  }

  const enhancedTrigger = trigger as CustomSortTrigger;
  enhancedTrigger.dataset.ataCustomSortEnhanced = "true";
  enhancedTrigger.__ataSortProducts = products;
  enhancedTrigger.__ataSortPreferences = preferences;

  if (!enhancedTrigger.__ataSortClickHandler) {
    enhancedTrigger.__ataSortClickHandler = () => {
      enhancedTrigger.__ataSortMenuActivated = true;
      window.setTimeout(() => insertCustomSortMenuOption(enhancedTrigger), 0);
      window.setTimeout(() => insertCustomSortMenuOption(enhancedTrigger), 120);
    };
    enhancedTrigger.addEventListener("click", enhancedTrigger.__ataSortClickHandler);
  }

  if (!enhancedTrigger.__ataSortKeyHandler) {
    enhancedTrigger.__ataSortKeyHandler = (event) => {
      if (event instanceof KeyboardEvent && ["Enter", " ", "ArrowDown"].includes(event.key)) {
        enhancedTrigger.__ataSortMenuActivated = true;
        window.setTimeout(() => insertCustomSortMenuOption(enhancedTrigger), 0);
        window.setTimeout(() => insertCustomSortMenuOption(enhancedTrigger), 120);
      }
    };
    enhancedTrigger.addEventListener("keydown", enhancedTrigger.__ataSortKeyHandler);
  }

  if (!enhancedTrigger.__ataSortObserver) {
    enhancedTrigger.__ataSortObserver = new MutationObserver(() => {
      if (enhancedTrigger.__ataSortMenuActivated) {
        insertCustomSortMenuOption(enhancedTrigger);
      }
    });
    enhancedTrigger.__ataSortObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "hidden", "style", "class"]
    });
  }

  return true;
}

function findSortSelect(): HTMLSelectElement | undefined {
  const selects = [...document.querySelectorAll<HTMLSelectElement>("select")];

  return selects.find((select) => {
    if (!isVisible(select)) {
      return false;
    }

    const text = [
      select.getAttribute("aria-label"),
      select.getAttribute("name"),
      select.id,
      select.className,
      select.closest("label")?.textContent,
      select.parentElement?.textContent,
      [...select.options].map((option) => option.textContent).join(" ")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /\bsort(?:\s+by)?\b/.test(text);
  });
}

function findCustomSortTrigger(): HTMLElement | undefined {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(
      "button, [role='button'], [role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu'], [aria-label*='sort' i], [data-testid*='sort' i], [data-test*='sort' i]"
    )
  ];

  return candidates
    .map((element) => ({ element, score: scoreCustomSortTrigger(element) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.element;
}

function scoreCustomSortTrigger(element: HTMLElement): number {
  if (element instanceof HTMLSelectElement || !isVisible(element) || element.closest("[data-ata-sort-control]")) {
    return 0;
  }

  const text = getElementSearchText(element);
  if (!/\bsort(?:\s+by)?\b/i.test(text)) {
    return 0;
  }

  let score = 1;
  if (element.matches("button, [role='button'], [role='combobox']")) {
    score += 3;
  }
  if (element.getAttribute("aria-haspopup")) {
    score += 2;
  }
  if (element.hasAttribute("aria-expanded") || element.hasAttribute("aria-controls")) {
    score += 1;
  }
  if (/\b(relevance|featured|price|rating|newest|best|popular)\b/i.test(text)) {
    score += 2;
  }

  return score;
}

function insertCustomSortMenuOption(trigger: CustomSortTrigger): boolean {
  const menu = findOpenCustomSortMenu(trigger);
  const products = trigger.__ataSortProducts;
  const preferences = trigger.__ataSortPreferences;

  if (!menu || !products || !preferences) {
    return false;
  }

  const option =
    (menu.querySelector<CustomSortOption>(CUSTOM_SORT_OPTION_SELECTOR) as CustomSortOption | null) ??
    createCustomSortMenuOption(menu, trigger);

  if (option.__ataSelectHandler) {
    option.removeEventListener("pointerdown", option.__ataSelectHandler, { capture: true });
    option.removeEventListener("mousedown", option.__ataSelectHandler, { capture: true });
    option.removeEventListener("click", option.__ataSelectHandler, { capture: true });
  }

  option.__ataSelectHandler = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    sortByUnitPrice(products, preferences);
    option.setAttribute("aria-selected", "true");
    trigger.setAttribute("data-ata-unit-sort-active", "true");
  };
  option.addEventListener("pointerdown", option.__ataSelectHandler, { capture: true });
  option.addEventListener("mousedown", option.__ataSelectHandler, { capture: true });
  option.addEventListener("click", option.__ataSelectHandler, { capture: true });

  if (!option.__ataKeyHandler) {
    option.__ataKeyHandler = (event) => {
      if (!(event instanceof KeyboardEvent) || (event.key !== "Enter" && event.key !== " ")) {
        return;
      }

      event.preventDefault();
      option.click();
    };
    option.addEventListener("keydown", option.__ataKeyHandler);
  }

  return true;
}

function findOpenCustomSortMenu(trigger: HTMLElement): HTMLElement | undefined {
  const controlledMenu = findControlledMenu(trigger);
  if (controlledMenu && isVisible(controlledMenu) && menuLooksLikeSortMenu(controlledMenu)) {
    return controlledMenu;
  }

  const localMenu = findLocalSortMenu(trigger);
  if (localMenu) {
    return localMenu;
  }

  const labelMenu = findVisibleSortLabelMenu(trigger);
  if (labelMenu) {
    return labelMenu;
  }

  return undefined;
}

function findControlledMenu(trigger: HTMLElement): HTMLElement | undefined {
  const id = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
  if (!id) {
    return undefined;
  }

  return document.getElementById(id) ?? undefined;
}

function findLocalSortMenu(trigger: HTMLElement): HTMLElement | undefined {
  let current: HTMLElement | null = trigger.parentElement;

  for (let depth = 0; current && depth < 4; depth += 1) {
    const menu = [...current.querySelectorAll<HTMLElement>("[role='listbox'], [role='menu']")].find(
      (candidate) => candidate !== trigger && isVisible(candidate) && menuLooksLikeSortMenu(candidate)
    );

    if (menu) {
      return menu;
    }

    current = current.parentElement;
  }

  return undefined;
}

function findVisibleSortLabelMenu(trigger: HTMLElement): HTMLElement | undefined {
  const labels = [...document.querySelectorAll<HTMLElement>("label")]
    .filter((label) => isVisible(label) && isSortOptionText(label.innerText || label.textContent || ""))
    .filter((label) => isNearTrigger(label, trigger));

  if (labels.length < 2) {
    return undefined;
  }

  const rankedParents = new Map<HTMLElement, number>();
  for (const label of labels) {
    let current = label.parentElement;

    for (let depth = 0; current && depth < 4; depth += 1) {
      const count = labels.filter((candidate) => current?.contains(candidate)).length;
      if (count >= 2 && isVisible(current) && menuLooksLikeSortMenu(current)) {
        rankedParents.set(current, Math.max(rankedParents.get(current) ?? 0, count));
      }

      current = current.parentElement;
    }
  }

  return [...rankedParents.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function isNearTrigger(element: HTMLElement, trigger: HTMLElement): boolean {
  const elementRect = element.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const verticalDistance = elementRect.top - triggerRect.bottom;
  const horizontalDistance = Math.abs(elementRect.left - triggerRect.left);

  return verticalDistance >= -12 && verticalDistance <= 520 && horizontalDistance <= 520;
}

function createCustomSortMenuOption(menu: HTMLElement, trigger: HTMLElement): CustomSortOption {
  const referenceOption = findLastMenuOption(menu);
  const referenceRow = referenceOption?.tagName === "LABEL" ? findMenuOptionRow(referenceOption, menu) : undefined;
  const option = referenceOption
    ? cloneSortMenuOption(referenceOption, referenceRow)
    : createFallbackSortMenuOption(menu);

  option.dataset.ataCustomSortOption = "true";
  option.classList.add("ata-custom-sort-option");
  setCustomSortOptionText(option);
  option.title = "Unit price: low to high";
  option.setAttribute("aria-label", "Unit price: low to high");
  option.setAttribute("role", menu.getAttribute("role") === "listbox" ? "option" : "menuitem");
  option.setAttribute("aria-selected", "false");
  option.tabIndex = 0;
  applyCustomSortOptionLayout(option);

  if (option instanceof HTMLButtonElement) {
    option.type = "button";
  }

  if (referenceRow) {
    referenceRow.insertAdjacentElement("afterend", option);
  } else if (referenceOption) {
    referenceOption.insertAdjacentElement("afterend", option);
  } else {
    menu.append(option);
  }

  window.setTimeout(() => trigger.setAttribute("data-ata-custom-sort-menu-ready", "true"), 0);
  return option as CustomSortOption;
}

function cloneSortMenuOption(referenceOption: HTMLElement, referenceRow: HTMLElement | undefined): HTMLElement {
  if (referenceOption.tagName === "LABEL") {
    const row = referenceRow ? (referenceRow.cloneNode(false) as HTMLElement) : referenceOption.ownerDocument.createElement("div");
    const label = cloneSortLabel(referenceOption);
    resetClonedMenuNode(row);
    row.append(label);
    return row;
  }

  return cloneSortLabel(referenceOption);
}

function cloneSortLabel(referenceOption: HTMLElement): HTMLElement {
  const label = referenceOption.cloneNode(false) as HTMLElement;
  resetClonedMenuNode(label);
  label.classList.add("ata-custom-sort-option-label");
  label.style.setProperty("display", "block", "important");
  label.style.setProperty("width", "100%", "important");
  return label;
}

function resetClonedMenuNode(element: HTMLElement): void {
  element.removeAttribute("id");
  element.removeAttribute("for");
  element.removeAttribute("name");
  element.removeAttribute("value");
  element.removeAttribute("checked");
  element.removeAttribute("aria-current");
  element.removeAttribute("aria-checked");
  element.removeAttribute("data-automation-id");
}

function setCustomSortOptionText(option: HTMLElement): void {
  const label = option.matches("label") ? option : option.querySelector<HTMLElement>("label");
  if (label) {
    label.textContent = "Unit price: low to high";
    return;
  }

  option.textContent = "Unit price: low to high";
}

function createFallbackSortMenuOption(menu: HTMLElement): HTMLElement {
  const option = menu.ownerDocument.createElement("button");
  option.type = "button";
  option.dataset.ataCustomSortOption = "true";
  option.className = "ata-custom-sort-option ata-custom-sort-option--fallback";
  option.textContent = "Unit price: low to high";
  option.setAttribute("role", menu.getAttribute("role") === "listbox" ? "option" : "menuitem");
  return option;
}

function findMenuOptionRow(referenceOption: HTMLElement, menu: HTMLElement): HTMLElement | undefined {
  const repeatedRow = findRepeatedMenuRow(referenceOption, menu);
  if (repeatedRow) {
    return repeatedRow;
  }

  const referenceRect = referenceOption.getBoundingClientRect();
  let current = referenceOption.parentElement;
  let row: HTMLElement | undefined;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    const currentRect = current.getBoundingClientRect();
    const sortOptionDescendants = [
      ...current.querySelectorAll<HTMLElement>("[role='option'], [role='menuitem'], label, button, input[type='radio']")
    ]
      .filter((element) => element === referenceOption || isVisible(element))
      .filter((element) => isSortOptionText(getElementSearchText(element)));

    if (
      current.contains(referenceOption) &&
      isSortOptionText(getElementSearchText(current)) &&
      sortOptionDescendants.length <= 2 &&
      currentRect.height <= Math.max(72, referenceRect.height * 3)
    ) {
      row = current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return row;
}

function findRepeatedMenuRow(referenceOption: HTMLElement, menu: HTMLElement): HTMLElement | undefined {
  const referenceRect = referenceOption.getBoundingClientRect();
  let current = referenceOption.parentElement;
  let row: HTMLElement | undefined;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    const parent = current.parentElement;
    const currentRect = current.getBoundingClientRect();
    const sortLabelsInParent = parent ? findSortLabels(parent) : [];
    const sortLabelsInCurrent = findSortLabels(current);

    if (
      parent &&
      sortLabelsInParent.length >= 2 &&
      sortLabelsInCurrent.length === 1 &&
      sortLabelsInCurrent[0] === referenceOption &&
      currentRect.height <= Math.max(80, referenceRect.height * 3)
    ) {
      row = current;
    }

    current = current.parentElement;
    depth += 1;
  }

  return row;
}

function findSortLabels(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>("label")].filter(
    (label) => isVisible(label) && isSortOptionText(label.innerText || label.textContent || "")
  );
}

function findLastMenuOption(menu: HTMLElement): HTMLElement | undefined {
  const options = [
    ...menu.querySelectorAll<HTMLElement>(
      "[role='option'], [role='menuitem'], label, button:not([data-ata-custom-sort-option]), a, li"
    )
  ].filter((element) => isVisible(element) && !element.closest(CUSTOM_SORT_OPTION_SELECTOR));

  return options.at(-1);
}

function menuLooksLikeSortMenu(menu: HTMLElement): boolean {
  if (menu.querySelector(CUSTOM_SORT_OPTION_SELECTOR)) {
    return true;
  }

  const text = getElementSearchText(menu);
  const optionSignals = [
    /\brelevance\b/i,
    /\bfeatured\b/i,
    /\bprice\b/i,
    /\brating\b/i,
    /\bnewest\b/i,
    /\bbest\s*(match|seller|selling)?\b/i,
    /\bpopular\b/i,
    /\blow\s*to\s*high\b/i,
    /\bhigh\s*to\s*low\b/i
  ].filter((pattern) => pattern.test(text)).length;

  return /\bsort(?:\s+by)?\b/i.test(text) || optionSignals >= 2;
}

function isSortOptionText(text: string): boolean {
  return /\bsort\s+by\b/i.test(normalizeMenuText(text));
}

function normalizeMenuText(text: string): string {
  return text
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/[^\w:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function applyCustomSortOptionLayout(option: HTMLElement): void {
  option.style.setProperty("align-self", "stretch", "important");
  option.style.setProperty("box-sizing", "border-box", "important");
  option.style.setProperty("clear", "both", "important");
  option.style.setProperty("display", "block", "important");
  option.style.setProperty("flex", "0 0 100%", "important");
  option.style.setProperty("float", "none", "important");
  option.style.setProperty("grid-column", "1 / -1", "important");
  option.style.setProperty("min-width", "100%", "important");
  option.style.setProperty("width", "100%", "important");
}

function getElementSearchText(element: HTMLElement): string {
  return [
    element.getAttribute("aria-label"),
    element.getAttribute("name"),
    element.id,
    element.className,
    element.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function removeInlineSortControls(): void {
  for (const control of document.querySelectorAll<HTMLElement>(SORT_CONTROL_SELECTOR)) {
    control.remove();
  }
}

function badgeMarkup(normalized: NormalizedPrice): string {
  return `
    <span class="ata-badge-main">${escapeHtml(normalized.display)}</span>
  `;
}

function buildTitle(normalized: NormalizedPrice): string {
  const warnings = normalized.warnings.length > 0 ? ` Warnings: ${normalized.warnings.join(" ")}` : "";
  return `${normalized.explanation}.${warnings}`;
}

export function removeLegacyUi(): void {
  for (const panel of document.querySelectorAll(
    "#ata-panel-root, [data-ata-panel-root], [data-ata-sort-control]"
  )) {
    panel.remove();
  }

  for (const staleBadgePart of document.querySelectorAll(
    "[data-ata-badge] .ata-badge-confidence, [data-ata-badge] .ata-evidence-strip"
  )) {
    staleBadgePart.remove();
  }
}

function injectStyles(document: Document): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .ata-badge,
    .ata-custom-sort-option {
      --receipt-paper: #fbfaf6;
      --shelf-ink: #1f241f;
      --muted-ink: #627064;
      --tag-line: #d9d4ca;
      --ledger-green: #236652;
      --coupon-amber: #8a5a08;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }

    .ata-badge {
      position: relative;
      display: inline-grid;
      grid-template-columns: auto auto;
      align-items: center;
      gap: 5px;
      width: fit-content;
      max-width: 100%;
      margin: 5px 0;
      padding: 5px 7px;
      border: 1px solid var(--tag-line);
      border-radius: 6px;
      background: var(--receipt-paper);
      color: var(--shelf-ink);
      font-size: 12px;
      line-height: 1.15;
      z-index: 1;
    }

    .ata-badge-main {
      font-weight: 760;
      white-space: nowrap;
    }

    .ata-custom-sort-option {
      align-self: stretch !important;
      box-sizing: border-box;
      clear: both !important;
      cursor: pointer;
      display: block !important;
      flex: 0 0 100% !important;
      float: none !important;
      grid-column: 1 / -1 !important;
      min-width: 100% !important;
      width: 100% !important;
    }

    .ata-custom-sort-option-label {
      box-sizing: border-box;
      display: block !important;
      width: 100% !important;
    }

    .ata-custom-sort-option--fallback {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 36px;
      margin: 0;
      padding: 0 14px;
      border: 0;
      border-radius: 0;
      background: #fffdfa;
      color: var(--ledger-green);
      font-size: 14px;
      font-weight: 720;
      line-height: 1.2;
      text-align: left;
    }

    .ata-custom-sort-option--fallback:hover,
    .ata-custom-sort-option--fallback:focus-visible {
      background: var(--receipt-paper);
      outline: none;
    }
  `;
  document.head.append(style);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
