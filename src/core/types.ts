export type Dimension = "mass" | "volume" | "count" | "area" | "length";

export type CanonicalUnit =
  | "oz"
  | "lb"
  | "g"
  | "kg"
  | "fl_oz"
  | "ml"
  | "l"
  | "gal"
  | "qt"
  | "pt"
  | "cup"
  | "each"
  | "roll"
  | "sheet"
  | "load"
  | "pod"
  | "tablet"
  | "capsule"
  | "diaper"
  | "bag"
  | "sq_ft"
  | "sq_in"
  | "ft"
  | "in";

export interface UnitDefinition {
  unit: CanonicalUnit;
  dimension: Dimension;
  label: string;
  aliases: readonly string[];
  toBase: number;
}

export interface Money {
  cents: number;
  currency: "USD";
  sourceText: string;
  index: number;
}

export interface Quantity {
  value: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  sourceText: string;
  index: number;
  rank: number;
}

export interface NativeUnitPrice {
  centsPerUnit: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  sourceText: string;
  index: number;
}

export type EvidenceKind =
  | "structured-data"
  | "native-unit-price"
  | "package-size"
  | "current-price"
  | "title"
  | "multipack"
  | "dom-proximity"
  | "warning";

export interface Evidence {
  kind: EvidenceKind;
  text: string;
}

export interface ProductInput {
  id: string;
  site: string;
  pageType: "search" | "category" | "product" | "cart" | "unknown";
  title: string;
  price?: Money;
  nativeUnitPrice?: NativeUnitPrice;
  packageQuantity?: Quantity;
  packCount?: number;
  evidence: Evidence[];
}

export interface NormalizedPrice {
  centsPerUnit: number;
  unit: CanonicalUnit;
  dimension: Dimension;
  display: string;
  compareKey: string;
  explanation: string;
  warnings: string[];
  evidence: Evidence[];
}

export interface NormalizedProduct extends ProductInput {
  normalized?: NormalizedPrice;
}

export interface PreferredUnits {
  mass: CanonicalUnit;
  volume: CanonicalUnit;
  count: CanonicalUnit;
  area: CanonicalUnit;
  length: CanonicalUnit;
}

export interface UserPreferences {
  enabled: boolean;
  includeRewards: boolean;
  preferredUnits: PreferredUnits;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  enabled: true,
  includeRewards: false,
  preferredUnits: {
    mass: "lb",
    volume: "fl_oz",
    count: "each",
    area: "sq_ft",
    length: "ft"
  }
};
