import {
  extractImageAltTexts,
  mapPix2StructMarkup
} from "../../scripts/pix2struct-markup-lib";
import type { ObservedNode, PageObservation } from "../../src/learning/contracts";

describe("Pix2Struct markup grounding", () => {
  const region = { x: 300, y: 900, width: 1000, height: 800 };
  const observation: PageObservation = {
    version: 1,
    pageId: "shop--coffee",
    url: "https://shop.example/search",
    title: "Coffee",
    viewport: { width: 1400, height: 800, scrollX: 0, scrollY: 900 },
    rootNodeId: "root",
    sourceRegion: region,
    truncated: false,
    nodes: [
      node("root", undefined, "div", region),
      node("list", "root", "ul", { x: 320, y: 920, width: 960, height: 500 }),
      node("card-a", "list", "li", { x: 340, y: 940, width: 260, height: 420 }),
      node("image-a", "card-a", "img", { x: 350, y: 950, width: 240, height: 240 }, {
        accessibleName: "Acme Breakfast Blend Coffee Pods, 24 Count",
        attributes: { alt: "Acme Breakfast Blend Coffee Pods, 24 Count" }
      }),
      node("card-b", "list", "li", { x: 620, y: 940, width: 260, height: 420 }),
      node("image-b", "card-b", "img", { x: 630, y: 950, width: 240, height: 240 }, {
        accessibleName: "Roaster Dark Roast K-Cup Coffee, 32 Count",
        attributes: { alt: "Roaster Dark Roast K-Cup Coffee, 32 Count" }
      })
    ]
  };

  it("extracts unique image alt values", () => {
    expect(
      extractImageAltTexts(
        "<img_src=one img_alt=Acme Coffee Pods> " +
          "<img_alt=Acme Coffee Pods> <img_alt=Dark Roast Coffee>"
      )
    ).toEqual(["Acme Coffee Pods", "Dark Roast Coffee"]);
  });

  it("grounds exact and paraphrased titles to semantic outer roots", () => {
    const mapping = mapPix2StructMarkup(
      "<img_alt=Acme Breakfast Blend Coffee Pods, 24 Count> " +
        "<img_alt=Roaster Dark Roast Coffee K Cup, 32 Count>",
      region,
      observation
    );

    expect(mapping).toEqual({
      cardNodeIds: ["card-a", "card-b"],
      titleCandidates: 2,
      matchedTitles: 2,
      unmatchedTitles: 0,
      duplicateMappings: 0
    });
  });

  it("abstains when generated titles lack grounded evidence", () => {
    expect(
      mapPix2StructMarkup(
        "<img_alt=Unrelated Laundry Detergent>",
        region,
        observation
      ).cardNodeIds
    ).toEqual([]);
  });
});

function node(
  id: string,
  parentId: string | undefined,
  tag: string,
  bounds: ObservedNode["bounds"],
  extra: Partial<ObservedNode> = {}
): ObservedNode {
  return {
    id,
    tag,
    ...(parentId ? { parentId } : {}),
    bounds,
    intersectsViewport: true,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 14,
      fontWeight: 400
    },
    ...extra
  };
}
