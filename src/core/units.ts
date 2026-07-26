import type { CanonicalUnit, Dimension, UnitDefinition } from "./types";

export const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  {
    unit: "oz",
    dimension: "mass",
    label: "oz",
    aliases: ["oz", "oz.", "ounce", "ounces"],
    toBase: 1
  },
  {
    unit: "lb",
    dimension: "mass",
    label: "lb",
    aliases: ["lb", "lb.", "lbs", "lbs.", "pound", "pounds"],
    toBase: 16
  },
  {
    unit: "g",
    dimension: "mass",
    label: "g",
    aliases: ["g", "gram", "grams"],
    toBase: 0.03527396195
  },
  {
    unit: "kg",
    dimension: "mass",
    label: "kg",
    aliases: ["kg", "kilogram", "kilograms"],
    toBase: 35.27396195
  },
  {
    unit: "fl_oz",
    dimension: "volume",
    label: "fl oz",
    aliases: ["fl oz", "fl. oz", "fl. oz.", "fluid ounce", "fluid ounces", "floz"],
    toBase: 1
  },
  {
    unit: "ml",
    dimension: "volume",
    label: "mL",
    aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
    toBase: 0.0338140227
  },
  {
    unit: "l",
    dimension: "volume",
    label: "L",
    aliases: ["l", "liter", "liters", "litre", "litres"],
    toBase: 33.8140227
  },
  {
    unit: "gal",
    dimension: "volume",
    label: "gal",
    aliases: ["gal", "gallon", "gallons"],
    toBase: 128
  },
  {
    unit: "qt",
    dimension: "volume",
    label: "qt",
    aliases: ["qt", "quart", "quarts"],
    toBase: 32
  },
  {
    unit: "pt",
    dimension: "volume",
    label: "pt",
    aliases: ["pt", "pint", "pints"],
    toBase: 16
  },
  {
    unit: "cup",
    dimension: "volume",
    label: "cup",
    aliases: ["cup", "cups"],
    toBase: 8
  },
  {
    unit: "each",
    dimension: "count",
    label: "count",
    aliases: ["ct", "ct.", "count", "counts", "each", "ea", "piece", "pieces", "item", "items"],
    toBase: 1
  },
  {
    unit: "roll",
    dimension: "count",
    label: "roll",
    aliases: ["roll", "rolls"],
    toBase: 1
  },
  {
    unit: "sheet",
    dimension: "count",
    label: "sheet",
    aliases: ["sheet", "sheets"],
    toBase: 1
  },
  {
    unit: "load",
    dimension: "count",
    label: "load",
    aliases: ["load", "loads"],
    toBase: 1
  },
  {
    unit: "pod",
    dimension: "count",
    label: "pod",
    aliases: ["pod", "pods", "pac", "pacs"],
    toBase: 1
  },
  {
    unit: "tablet",
    dimension: "count",
    label: "tablet",
    aliases: ["tablet", "tablets", "tab", "tabs"],
    toBase: 1
  },
  {
    unit: "capsule",
    dimension: "count",
    label: "capsule",
    aliases: ["capsule", "capsules", "cap", "caps"],
    toBase: 1
  },
  {
    unit: "diaper",
    dimension: "count",
    label: "diaper",
    aliases: ["diaper", "diapers"],
    toBase: 1
  },
  {
    unit: "bag",
    dimension: "count",
    label: "bag",
    aliases: ["bag", "bags"],
    toBase: 1
  },
  {
    unit: "sq_ft",
    dimension: "area",
    label: "sq ft",
    aliases: [
      "sq ft",
      "sq. ft",
      "sq. ft.",
      "sqft",
      "square foot",
      "square feet",
      "ft2",
      "ft^2"
    ],
    toBase: 1
  },
  {
    unit: "sq_in",
    dimension: "area",
    label: "sq in",
    aliases: ["sq in", "sq. in", "sq. in.", "square inch", "square inches", "in2", "in^2"],
    toBase: 1 / 144
  },
  {
    unit: "yd",
    dimension: "length",
    label: "yd",
    aliases: ["yd", "yd.", "yard", "yards"],
    toBase: 3
  },
  {
    unit: "ft",
    dimension: "length",
    label: "ft",
    aliases: ["ft", "ft.", "foot", "feet"],
    toBase: 1
  },
  {
    unit: "in",
    dimension: "length",
    label: "in",
    aliases: ["in", "in.", "inch", "inches"],
    toBase: 1 / 12
  }
];

const UNIT_LOOKUP = new Map<string, UnitDefinition>();

for (const definition of UNIT_DEFINITIONS) {
  UNIT_LOOKUP.set(normalizeUnitToken(definition.unit), definition);
  UNIT_LOOKUP.set(normalizeUnitToken(definition.label), definition);
  for (const alias of definition.aliases) {
    UNIT_LOOKUP.set(normalizeUnitToken(alias), definition);
  }
}

export function normalizeUnitToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/fluid\s+ounces?/g, "fl oz")
    .replace(/fl\.\s*oz\.?/g, "fl oz")
    .replace(/sq\.\s*/g, "sq ")
    .replace(/\s+/g, " ")
    .replace(/[()]/g, "")
    .trim();
}

export function parseUnit(raw: string): UnitDefinition | undefined {
  return UNIT_LOOKUP.get(normalizeUnitToken(raw));
}

export function getUnitDefinition(unit: CanonicalUnit): UnitDefinition {
  const definition = UNIT_DEFINITIONS.find((candidate) => candidate.unit === unit);
  if (!definition) {
    throw new Error(`Unknown unit: ${unit}`);
  }
  return definition;
}

export function unitsAreComparable(left: CanonicalUnit, right: CanonicalUnit): boolean {
  const leftDefinition = getUnitDefinition(left);
  const rightDefinition = getUnitDefinition(right);

  if (leftDefinition.dimension !== rightDefinition.dimension) {
    return false;
  }

  if (leftDefinition.dimension !== "count") {
    return true;
  }

  return left === right || (left === "each" && right === "each");
}

export function getDefaultUnitForDimension(dimension: Dimension): CanonicalUnit {
  switch (dimension) {
    case "mass":
      return "lb";
    case "volume":
      return "fl_oz";
    case "count":
      return "each";
    case "area":
      return "sq_ft";
    case "length":
      return "ft";
  }
}

export function getUnitLabel(unit: CanonicalUnit): string {
  return getUnitDefinition(unit).label;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getUnitRegexSource(): string {
  const aliases = new Set<string>();

  for (const definition of UNIT_DEFINITIONS) {
    aliases.add(definition.label);
    for (const alias of definition.aliases) {
      aliases.add(alias);
    }
  }

  return [...aliases]
    .sort((a, b) => b.length - a.length)
    .map((alias) => escapeRegex(alias).replace(/\\ /g, "\\s+"))
    .join("|");
}

export function convertPricePerUnit(
  centsPerSourceUnit: number,
  sourceUnit: CanonicalUnit,
  targetUnit: CanonicalUnit
): number | undefined {
  if (!unitsAreComparable(sourceUnit, targetUnit)) {
    return undefined;
  }

  const source = getUnitDefinition(sourceUnit);
  const target = getUnitDefinition(targetUnit);
  return (centsPerSourceUnit / source.toBase) * target.toBase;
}

export function convertQuantityToBase(value: number, unit: CanonicalUnit): number {
  return value * getUnitDefinition(unit).toBase;
}
