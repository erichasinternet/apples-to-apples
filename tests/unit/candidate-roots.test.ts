import { selectIndependentCandidateRootIds } from "../../src/learning/candidate-roots";

describe("candidate root independence", () => {
  it("removes candidate ancestors while preserving leaf-most roots in source order", () => {
    const nodes = [
      { id: "root" },
      { id: "group", parentId: "root" },
      { id: "table", parentId: "group" },
      { id: "row-a", parentId: "table" },
      { id: "row-b", parentId: "table" },
      { id: "sibling", parentId: "root" }
    ];

    expect(
      selectIndependentCandidateRootIds(nodes, [
        "row-a",
        "row-b",
        "table",
        "sibling"
      ])
    ).toEqual(["row-a", "row-b", "sibling"]);
  });

  it("deduplicates exact roots and tolerates malformed parent cycles", () => {
    const nodes = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "leaf" }
    ];

    expect(selectIndependentCandidateRootIds(nodes, ["a", "a", "leaf"])).toEqual([
      "a",
      "leaf"
    ]);
  });
});
