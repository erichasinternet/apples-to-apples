import type { NormalizedPrice, UserPreferences } from "../core/types";
import { comparisonFamilyKey } from "../core/comparison-family";
import type { DomProduct } from "./extractor";

export interface UnitSortResult {
  state: "sorted" | "restored" | "unavailable";
  changedCount: number;
  groupCount: number;
  compareKey?: string;
  message: string;
}

interface SortSnapshot {
  parent: HTMLElement;
  childNodes: Node[];
}

interface ActiveSortState {
  snapshots: SortSnapshot[];
  compareKey: string;
  message: string;
}

type SortableProduct = DomProduct & { normalized: NormalizedPrice };

interface SortItem {
  product: SortableProduct;
  element: HTMLElement;
  normalized: NormalizedPrice;
}

let activeSortState: ActiveSortState | undefined;

export function toggleUnitPriceSort(
  products: DomProduct[],
  basis: UserPreferences | string
): UnitSortResult {
  const compareKey = resolveCompareKey(products, basis);
  if (compareKey && activeSortState?.compareKey === compareKey) {
    return restoreUnitPriceSort();
  }

  return sortByUnitPrice(products, basis);
}

export function sortByUnitPrice(
  products: DomProduct[],
  basis: UserPreferences | string
): UnitSortResult {
  discardDetachedSortState();
  const compareKey = resolveCompareKey(products, basis);

  if (!compareKey) {
    return unavailableResult();
  }

  if (activeSortState?.compareKey === compareKey) {
    return {
      state: "sorted",
      changedCount: 0,
      groupCount: activeSortState.snapshots.length,
      compareKey,
      message: activeSortState.message
    };
  }

  if (activeSortState) {
    restoreUnitPriceSort();
  }

  const result = applyUnitPriceSort(products, compareKey);
  if (result.state === "sorted") {
    activeSortState = {
      snapshots: result.snapshots,
      compareKey,
      message: result.message
    };
  }

  return {
    state: result.state,
    changedCount: result.changedCount,
    groupCount: result.groupCount,
    compareKey,
    message: result.message
  };
}

export function restoreUnitPriceSort(): UnitSortResult {
  const state = activeSortState;
  activeSortState = undefined;

  if (!state) {
    return {
      state: "restored",
      changedCount: 0,
      groupCount: 0,
      message: "Retailer order restored."
    };
  }

  for (const snapshot of state.snapshots) {
    const fragment = snapshot.parent.ownerDocument.createDocumentFragment();

    for (const child of snapshot.childNodes) {
      if (child.parentNode === snapshot.parent) {
        fragment.append(child);
      }
    }

    snapshot.parent.prepend(fragment);
  }

  return {
    state: "restored",
    changedCount: 0,
    groupCount: state.snapshots.length,
    compareKey: state.compareKey,
    message: "Retailer order restored."
  };
}

export function isUnitPriceSortActive(): boolean {
  discardDetachedSortState();
  return Boolean(activeSortState);
}

export function getActiveSortCompareKey(): string | undefined {
  discardDetachedSortState();
  return activeSortState?.compareKey;
}

export function getUnitPriceSortMessage(): string {
  return activeSortState?.message ?? "Comparable loaded items only.";
}

export function canSortByUnitPrice(products: DomProduct[], compareKey: string): boolean {
  return [...groupBySortableParent(products, compareKey).values()].some((group) =>
    hasSortableCohort(group)
  );
}

export function getUnitPriceSortContainer(
  products: DomProduct[],
  compareKey?: string
): HTMLElement | undefined {
  const resolvedKey = compareKey ?? resolveCompareKey(products, "");
  if (!resolvedKey) {
    return undefined;
  }

  for (const [parent, parentProducts] of groupBySortableParent(products, resolvedKey)) {
    if (hasSortableCohort(parentProducts)) {
      return parent;
    }
  }

  return undefined;
}

export function resetUnitPriceSortState(): void {
  activeSortState = undefined;
}

function discardDetachedSortState(): void {
  if (
    activeSortState &&
    activeSortState.snapshots.every((snapshot) => !snapshot.parent.isConnected)
  ) {
    activeSortState = undefined;
  }
}

function applyUnitPriceSort(
  products: DomProduct[],
  compareKey: string
): UnitSortResult & { snapshots: SortSnapshot[] } {
  const byParent = groupBySortableParent(products, compareKey);
  const snapshots: SortSnapshot[] = [];
  let changedCount = 0;

  for (const [parent, sortableProducts] of byParent) {
    if (!hasSortableCohort(sortableProducts)) {
      continue;
    }

    snapshots.push({
      parent,
      childNodes: Array.from(parent.childNodes)
    });

    changedCount += sortParentChildren(parent, sortableProducts);
  }

  if (snapshots.length === 0) {
    return {
      ...unavailableResult(),
      compareKey,
      snapshots: []
    };
  }

  return {
    state: "sorted",
    changedCount,
    groupCount: snapshots.length,
    compareKey,
    snapshots,
    message: `Sorted ${changedCount} loaded items by unit price.`
  };
}

function groupBySortableParent(
  products: DomProduct[],
  compareKey: string
): Map<HTMLElement, SortItem[]> {
  const sortable = products.filter(
    (product): product is SortableProduct =>
      Boolean(
        product.normalized &&
          product.normalized.compareKey === compareKey &&
          product.element.isConnected &&
          product.element.parentElement
      )
  );
  const groups = new Map<HTMLElement, SortItem[]>();
  const seenElements = new Set<HTMLElement>();

  for (const product of sortable) {
    const sortElement = findSortableElement(product, sortable);
    const parent = sortElement?.parentElement;

    if (
      !sortElement ||
      !parent ||
      parent === document.body ||
      parent === document.documentElement ||
      seenElements.has(sortElement)
    ) {
      continue;
    }

    const group = groups.get(parent) ?? [];
    group.push({
      product,
      element: sortElement,
      normalized: product.normalized
    });
    groups.set(parent, group);
    seenElements.add(sortElement);
  }

  return groups;
}

function findSortableElement(
  product: SortableProduct,
  products: SortableProduct[]
): HTMLElement | undefined {
  let current: HTMLElement | null = product.element;

  while (
    current?.parentElement &&
    current.parentElement !== current.ownerDocument.body &&
    current.parentElement !== current.ownerDocument.documentElement
  ) {
    const siblingsContainingProducts = Array.from(current.parentElement.children).filter(
      (sibling) => products.some((candidate) => sibling.contains(candidate.element))
    );

    if (siblingsContainingProducts.length >= 2) {
      return current;
    }

    current = current.parentElement;
  }

  return product.element.parentElement ? product.element : undefined;
}

function sortParentChildren(
  parent: HTMLElement,
  originalItems: SortItem[]
): number {
  const originalChildren = Array.from(parent.childNodes);
  const productByElement = new Map(originalItems.map((item) => [item.element, item]));
  const queues = new Map<string, SortItem[]>();
  for (const item of originalItems) {
    const family = comparisonFamilyKey(item.product);
    const queue = queues.get(family) ?? [];
    queue.push(item);
    queues.set(family, queue);
  }
  for (const [family, queue] of queues) {
    if (queue.length < 2) {
      queues.delete(family);
      continue;
    }
    queue.sort(
      (left, right) => left.normalized.centsPerUnit - right.normalized.centsPerUnit
    );
  }
  let changedCount = 0;
  const fragment = parent.ownerDocument.createDocumentFragment();

  for (const child of originalChildren) {
    const product = child instanceof HTMLElement ? productByElement.get(child) : undefined;

    if (!product) {
      fragment.append(child);
      continue;
    }

    const queue = queues.get(comparisonFamilyKey(product.product));
    if (!queue) {
      fragment.append(child);
      continue;
    }

    const replacement = queue.shift();
    if (!replacement) {
      fragment.append(child);
      continue;
    }

    fragment.append(replacement.element);
    if (replacement.element !== child) {
      changedCount += 1;
    }
  }

  parent.append(fragment);
  return changedCount;
}

function hasSortableCohort(items: SortItem[]): boolean {
  return sortableCohortCount(items) >= 2;
}

function sortableCohortCount(items: SortItem[]): number {
  const counts = new Map<string, number>();
  for (const item of items) {
    const family = comparisonFamilyKey(item.product);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }

  return [...counts.values()].reduce(
    (total, count) => total + (count >= 2 ? count : 0),
    0
  );
}

function resolveCompareKey(
  products: DomProduct[],
  basis: UserPreferences | string
): string | undefined {
  if (typeof basis === "string" && basis.includes(":")) {
    return basis;
  }

  const compareKeys = new Set<string>();
  for (const product of products) {
    if (product.normalized) {
      compareKeys.add(product.normalized.compareKey);
    }
  }

  return [...compareKeys]
    .map((compareKey) => [
      compareKey,
      [...groupBySortableParent(products, compareKey).values()].reduce(
        (total, group) => total + sortableCohortCount(group),
        0
      )
    ] as const)
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

function unavailableResult(): UnitSortResult {
  return {
    state: "unavailable",
    changedCount: 0,
    groupCount: 0,
    message: "No safely reorderable comparison group is loaded."
  };
}
