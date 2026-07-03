import type { NormalizedPrice, UserPreferences } from "../core/types";
import type { DomProduct } from "./extractor";

export interface UnitSortResult {
  state: "sorted" | "restored" | "unavailable";
  changedCount: number;
  groupCount: number;
  message: string;
}

interface SortSnapshot {
  parent: HTMLElement;
  childNodes: Node[];
}

interface ActiveSortState {
  snapshots: SortSnapshot[];
  message: string;
}

type SortableProduct = DomProduct & { normalized: NormalizedPrice };
interface SortItem {
  product: SortableProduct;
  element: HTMLElement;
  normalized: NormalizedPrice;
}

let activeSortState: ActiveSortState | undefined;

export function toggleUnitPriceSort(products: DomProduct[], preferences: UserPreferences): UnitSortResult {
  if (activeSortState) {
    return restoreUnitPriceSort();
  }

  return sortByUnitPrice(products, preferences);
}

export function sortByUnitPrice(products: DomProduct[], preferences: UserPreferences): UnitSortResult {
  if (activeSortState) {
    return {
      state: "sorted",
      changedCount: 0,
      groupCount: 0,
      message: activeSortState.message
    };
  }

  const result = applyUnitPriceSort(products, preferences);
  if (result.state === "sorted") {
    activeSortState = {
      snapshots: result.snapshots,
      message: result.message
    };
  }

  return {
    state: result.state,
    changedCount: result.changedCount,
    groupCount: result.groupCount,
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
    groupCount: 0,
    message: "Retailer order restored."
  };
}

export function isUnitPriceSortActive(): boolean {
  return Boolean(activeSortState);
}

export function getUnitPriceSortMessage(): string {
  return activeSortState?.message ?? "Comparable cards only.";
}

export function getUnitPriceSortContainer(products: DomProduct[]): HTMLElement | undefined {
  for (const [parent, parentProducts] of groupBySortableParent(products)) {
    if (groupSortableProducts(parentProducts).size > 0) {
      return parent;
    }
  }

  return undefined;
}

export function resetUnitPriceSortState(): void {
  activeSortState = undefined;
}

function applyUnitPriceSort(
  products: DomProduct[],
  preferences: UserPreferences
): UnitSortResult & { snapshots: SortSnapshot[] } {
  const byParent = groupBySortableParent(products);
  const snapshots: SortSnapshot[] = [];
  let changedCount = 0;
  let groupCount = 0;

  for (const [parent, parentProducts] of byParent) {
    const sortableGroups = groupSortableProducts(parentProducts);

    if (sortableGroups.size === 0) {
      continue;
    }

    snapshots.push({
      parent,
      childNodes: Array.from(parent.childNodes)
    });

    groupCount += sortableGroups.size;
    changedCount += sortParentChildren(parent, sortableGroups);
  }

  if (snapshots.length === 0) {
    return {
      state: "unavailable",
      changedCount: 0,
      groupCount: 0,
      snapshots: [],
      message: "No comparable group to sort."
    };
  }

  return {
    state: "sorted",
    changedCount,
    groupCount,
    snapshots,
    message: `Sorted ${changedCount} cards by unit price.`
  };
}

function groupBySortableParent(products: DomProduct[]): Map<HTMLElement, SortItem[]> {
  const sortable = products.filter((product): product is SortableProduct =>
    Boolean(product.normalized && product.element.parentElement)
  );
  const groups = new Map<HTMLElement, SortItem[]>();
  const seenElements = new Set<HTMLElement>();

  for (const product of sortable) {
    const sortElement = findSortableElement(product, sortable);
    const parent = sortElement?.parentElement;

    if (!sortElement || !parent || seenElements.has(sortElement)) {
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

function findSortableElement(product: SortableProduct, products: SortableProduct[]): HTMLElement | undefined {
  let current: HTMLElement | null = product.element;

  while (current?.parentElement && current.parentElement !== current.ownerDocument.body) {
    const siblingProductCount = Array.from(current.parentElement.children).filter((sibling) =>
      products.some((candidate) => sibling.contains(candidate.element))
    ).length;

    if (siblingProductCount >= 2) {
      return current;
    }

    current = current.parentElement;
  }

  return product.element.parentElement ? product.element : undefined;
}

function groupSortableProducts(products: SortItem[]): Map<string, SortItem[]> {
  const groups = new Map<string, SortItem[]>();

  for (const product of products) {
    const group = groups.get(product.normalized.compareKey) ?? [];
    group.push(product);
    groups.set(product.normalized.compareKey, group);
  }

  for (const [key, group] of groups) {
    if (group.length < 2) {
      groups.delete(key);
      continue;
    }

    group.sort((left, right) => left.normalized.centsPerUnit - right.normalized.centsPerUnit);
  }

  return groups;
}

function sortParentChildren(parent: HTMLElement, sortableGroups: Map<string, SortItem[]>): number {
  const originalChildren = Array.from(parent.childNodes);
  const productByElement = new Map<HTMLElement, SortItem>();
  const queues = new Map<string, SortItem[]>();
  let changedCount = 0;

  for (const group of sortableGroups.values()) {
    queues.set(group[0]!.normalized.compareKey, [...group]);

    for (const product of group) {
      productByElement.set(product.element, product);
    }
  }

  const fragment = parent.ownerDocument.createDocumentFragment();

  for (const child of originalChildren) {
    const product = child instanceof HTMLElement ? productByElement.get(child) : undefined;

    if (!product) {
      fragment.append(child);
      continue;
    }

    const queue = queues.get(product.normalized.compareKey);
    const replacement = queue?.shift();

    if (replacement) {
      fragment.append(replacement.element);
      changedCount += 1;
    } else {
      fragment.append(child);
    }
  }

  parent.append(fragment);
  return changedCount;
}
