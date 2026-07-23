import type { ObservedNode, PageObservation } from "../../src/learning/contracts";
import { cropObservationToRegion } from "../../src/learning/observation-region";

describe("observation regions", () => {
  it("retains intersecting nodes and their structural ancestors", () => {
    const observation = makeObservation([
      node("root", undefined, 0, 0, 1000, 4000),
      node("card-a", "root", 0, 100, 200, 200),
      node("title-a", "card-a", 10, 110, 180, 30),
      node("card-b", "root", 0, 3000, 200, 200),
      node("title-b", "card-b", 10, 3010, 180, 30)
    ]);

    const cropped = cropObservationToRegion(observation, {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000
    });

    expect(cropped.nodes.map((item) => item.id)).toEqual(["root", "card-a", "title-a"]);
    expect(cropped.sourceRegion).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(cropped.viewport).toEqual({ width: 1000, height: 1000, scrollX: 0, scrollY: 0 });
  });
});

function node(
  id: string,
  parentId: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number
): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag: "div",
    bounds: { x, y, width, height },
    intersectsViewport: true,
    interactive: false,
    style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
  };
}

function makeObservation(nodes: ObservedNode[]): PageObservation {
  return {
    version: 1,
    pageId: "page",
    url: "https://example.test/search",
    title: "Search",
    viewport: { width: 1000, height: 1000, scrollX: 0, scrollY: 0 },
    rootNodeId: "root",
    nodes,
    truncated: false
  };
}
