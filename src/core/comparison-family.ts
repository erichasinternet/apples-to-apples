import type { NormalizedProduct } from "./types";

type ComparisonCandidate = Pick<NormalizedProduct, "title" | "normalized">;

/**
 * Keeps a physical unit basis separate from product substitutability.
 *
 * The default family preserves existing behavior outside categories where the
 * title provides strong, deterministic evidence that equally measured items
 * have different shopping purposes.
 */
export function comparisonFamilyKey(product: ComparisonCandidate): string {
  const title = product.title;

  if (looksLikeLaundryAccessory(title)) {
    return "general";
  }

  if (looksLikeMixedLaundryBundle(title)) {
    return "general";
  }

  if (
    /\bfabric\s+(?:softeners?|conditioners?)\b/i.test(title) &&
    !/\blaundry\b[^,;]{0,100}\bdetergent\b|\bdetergent\b[^,;]{0,100}\blaundry\b/i.test(
      title
    )
  ) {
    return "laundry:fabric-softener";
  }

  if (/\b(?:color\s+catchers?|dye[-\s]?trapping\s+sheets?)\b/i.test(title)) {
    return "laundry:dye-catcher";
  }

  if (/\b(?:washing\s+machine|washer)\s+cleaners?\b/i.test(title)) {
    return "laundry:washer-cleaner";
  }

  if (/\b(?:scent\s+boosters?|booster\s+beads?|scent\s+beads?)\b/i.test(title)) {
    return "laundry:scent-booster";
  }

  if (/\blaundry\s+sanitizers?\b/i.test(title)) {
    return "laundry:sanitizer";
  }

  const nonLaundryDetergent =
    /\b(?:carpet|dish|dishwasher|dishwashing|upholstery)\b/i.test(title);
  const explicitlyLaundryDetergent =
    /\blaundry\b[^,;]{0,100}\b(?:detergent|soap)\b|\b(?:detergent|soap)\b[^,;]{0,100}\blaundry\b/i.test(
      title
    ) ||
    /\bmighty\s+pacs?\b/i.test(title) ||
    (!nonLaundryDetergent &&
      /\bdetergent\b/i.test(title) &&
      /\b(?:liquid|powders?|pods?|pacs?|flings?|sheets?)\b/i.test(title));

  if (explicitlyLaundryDetergent) {
    return laundryDetergentFormKey(product);
  }

  if (
    /\b(?:stain|spot)\s+(?:removers?|treatments?)\b/i.test(title) &&
    /\b(?:clothes?|clothing|fabric|garments?|laundry)\b|\b\d+(?:\.\d+)?\s+loads?\b/i.test(
      title
    ) &&
    !/\b(?:automotive|carpet|rug|upholstery)\b/i.test(title)
  ) {
    return "laundry:stain-remover";
  }

  if (/\blaundry\b[^,;]{0,80}\b(?:odor|odour)\s+(?:removers?|eliminators?)\b/i.test(title)) {
    return "laundry:odor-remover";
  }

  if (
    /\bbleach\b/i.test(title) &&
    (/\blaundry\b/i.test(title) || /\b\d+(?:\.\d+)?\s+loads?\b/i.test(title))
  ) {
    return "laundry:bleach";
  }

  return "general";
}

function looksLikeLaundryAccessory(title: string): boolean {
  return (
    /\b(?:storage|disposal)\s+(?:bags?|boxes?|caddies?|carousels?|cases?|containers?|dispensers?|drawers?|filters?|holders?|jars?|organizers?|pails?|racks?|tins?)\b/i.test(
      title
    ) ||
    /\b(?:pods?|pacs?|tablets?|sheets?)\s+(?:storage\s+)?(?:boxes?|caddies?|carousels?|cases?|containers?|dispensers?|drawers?|filters?|holders?|jars?|organizers?|racks?|tins?)\b/i.test(
      title
    )
  );
}

function looksLikeMixedLaundryBundle(title: string): boolean {
  const physicalQuantities = title.match(
    /\b\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|fluid\s+ounces?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|gal|gallons?|qt|quarts?)\b/gi
  );
  const isMixedPhysicalBundle =
    (physicalQuantities?.length ?? 0) >= 2 &&
    (/\bdetergent\b.{0,140}?(?:\+|&|\bwith\b|\band\b).{0,140}?\bfabric\s+(?:softener|conditioner)\b/i.test(
      title
    ) ||
      /\bfabric\s+(?:softener|conditioner)\b.{0,140}?(?:\+|&|\bwith\b|\band\b).{0,140}?\bdetergent\b/i.test(
        title
      ));

  return (
    isMixedPhysicalBundle ||
    /\b(?:detergent|softener)\b.{0,140}?(?:\+|&|\bwith\b|\band\b).{0,140}?\b(?:dryer\s+sheets?|pods?|pacs?|tablets?)\b/i.test(
      title
    ) ||
    /\b(?:dryer\s+sheets?|pods?|pacs?|tablets?)\b.{0,140}?(?:\+|&|\bwith\b|\band\b).{0,140}?\b(?:detergent|softener)\b/i.test(
      title
    ) ||
    (/\b(?:bundle|combo|kit)\b/i.test(title) &&
      /\b(?:detergent|softener)\b/i.test(title) &&
      /\b(?:dryer\s+sheets?|pods?|pacs?|tablets?)\b/i.test(title))
  );
}

function laundryDetergentFormKey(product: ComparisonCandidate): string {
  const title = product.title;
  if (/\b(?:pods?|pacs?|flings?|unit[-\s]?doses?)\b/i.test(title)) {
    return "laundry:detergent-pod";
  }
  if (/\bpowders?\b/i.test(title)) {
    return "laundry:detergent-powder";
  }
  if (/\bsheets?\b/i.test(title)) {
    return "laundry:detergent-sheet";
  }
  if (/\bliquid\b/i.test(title) || product.normalized?.dimension === "volume") {
    return "laundry:detergent-liquid";
  }
  return "laundry:detergent-other";
}
