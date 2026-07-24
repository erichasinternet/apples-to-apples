import { mapVisualReview } from "../../scripts/visual-review-lib";
import type { ObservedNode, PageObservation } from "../../src/learning/contracts";

describe("visual review mapping", () => {
  it("maps normalized boxes to outer card roots and rejects invalid boxes", () => {
    const observation: PageObservation = {
      version: 1,
      pageId: "shop--rice",
      url: "https://shop.example/search",
      title: "Rice",
      viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
      rootNodeId: "root",
      sourceRegion: { x: 0, y: 0, width: 1000, height: 800 },
      truncated: false,
      nodes: [
        node("root", undefined, { x: 0, y: 0, width: 1000, height: 800 }),
        node("card-a", "root", { x: 100, y: 200, width: 300, height: 400 }, "listitem"),
        node("inner-a", "card-a", { x: 110, y: 210, width: 280, height: 380 }),
        node("card-b", "root", { x: 600, y: 200, width: 300, height: 400 }, "listitem")
      ]
    };
    const prediction = JSON.stringify({
      version: 1,
      pageId: observation.pageId,
      cardBoxes: [
        { x: 90, y: 190, width: 320, height: 420 },
        { x: 590, y: 190, width: 320, height: 420 },
        { x: 900, y: 900, width: 200, height: 200 }
      ]
    });

    expect(
      mapVisualReview(
        prediction,
        observation.pageId,
        { x: 0, y: 0, width: 1000, height: 800 },
        observation.sourceRegion!,
        observation
      )
    ).toEqual({
      cardNodeIds: ["card-a", "card-b"],
      boxes: 2,
      invalidBoxes: 1,
      unmappedBoxes: 0,
      duplicateMappings: 0
    });
  });
});

function node(
  id: string,
  parentId: string | undefined,
  bounds: ObservedNode["bounds"],
  role?: string
): ObservedNode {
  return {
    id,
    tag: "div",
    ...(parentId ? { parentId } : {}),
    ...(role ? { role } : {}),
    bounds,
    intersectsViewport: true,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 14,
      fontWeight: 400
    }
  };
}
