import type { CanonicalUnit, Dimension } from "../core/types";

export const MESSAGE_SCAN_NOW = "ATA_SCAN_NOW";
export const MESSAGE_GET_PAGE_STATUS = "ATA_GET_PAGE_STATUS";
export const MESSAGE_SORT_PAGE = "ATA_SORT_PAGE";
export const MESSAGE_RESTORE_PAGE_ORDER = "ATA_RESTORE_PAGE_ORDER";
export const MESSAGE_PAGE_STATUS_UPDATED = "ATA_PAGE_STATUS_UPDATED";

export interface PageComparisonGroup {
  compareKey: string;
  unit: CanonicalUnit;
  dimension: Dimension;
  count: number;
  label: string;
  sortLabel: string;
  canSort: boolean;
}

export interface PageStatus {
  ok: true;
  count: number;
  groups: PageComparisonGroup[];
  activeSortCompareKey?: string;
  sortActive: boolean;
  sortMessage: string;
}
