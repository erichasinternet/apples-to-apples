import { describe, expect, it } from "vitest";
import {
  candidateMatchesQuery,
  countQueryRelevantCandidates,
  normalizeQueryTokens,
} from "../../scripts/candidate-query-relevance-lib";

describe("candidate query relevance", () => {
  it("normalizes plural shopping terms without site knowledge", () => {
    expect(normalizeQueryTokens("Plastic lids and trays")).toEqual([
      "plastic",
      "lid",
      "tray",
    ]);
    expect(normalizeQueryTokens("Dental chews")).toEqual(["dental", "chew"]);
  });

  it("requires every informative query token inside the candidate", () => {
    expect(
      candidateMatchesQuery(
        "Red rayon challis woven fabric, $6.56 per yard",
        "rayon fabric",
      ),
    ).toBe(true);
    expect(
      candidateMatchesQuery(
        "Moda floral quilt back, $15.99",
        "rayon fabric",
      ),
    ).toBe(false);
  });

  it("counts relevant roots independently", () => {
    expect(
      countQueryRelevantCandidates("cat food", [
        "Premium cat foods, 12 pack",
        "Dry dog food, 5 lb",
        "Wet cat food cans",
      ]),
    ).toBe(2);
  });
});
