import type { TrainingExample } from "../../scripts/training-export-lib";
import {
  buildT5DiscoveryRecords,
  buildT5ExtractionRecord,
  buildT5TrainingRecords,
  getTrainingSplit,
  parseT5PromptObservation,
  pruneObservationForModel,
  validateTrainingDomainSplits,
  type TrainingDomainSplits
} from "../../scripts/t5-training-lib";
import { resolveEvidencePointer } from "../../src/learning/evidence-pointer";
import type { CorpusDomainSplits } from "../../scripts/live-corpus-lib";
import type {
  ModelProductExtraction,
  ObservedNode,
  PageObservation
} from "../../src/learning/contracts";

describe("T5 training records", () => {
  it("builds page-chunk discovery and per-card extraction examples", () => {
    const records = buildT5TrainingRecords(makeExample(), {
      captureId: "capture-1",
      split: "train",
      imagePath: "assets/page.png",
      discoveryChunkHeight: 900,
      cardPadding: 20
    });

    const discovery = records.filter((record) => record.task === "discover-products");
    const extraction = records.filter((record) => record.task === "extract-product");
    expect(discovery).toHaveLength(2);
    expect(extraction).toHaveLength(2);
    expect(JSON.parse(discovery[0]!.target).cardNodeIds).toEqual(["card-a"]);
    expect(JSON.parse(discovery[1]!.target).cardNodeIds).toEqual(["card-b"]);
    expect(extraction[0]!.imageCrop).toEqual({
      x: 80,
      y: 80,
      width: 440,
      height: 340
    });
    expect(extraction[0]!.prompt).toMatch(/^<start_of_image>\n/);
    expect(extraction[0]!.prompt).toContain('"id":"card-a"');
    expect(extraction[0]!.prompt).not.toContain('"id":"card-b"');
    expect(Object.values(extraction[0]!.imageCrop).every(Number.isInteger)).toBe(true);
    expect(JSON.parse(extraction[1]!.target).products[0].abstainReason).toBe(
      "ambiguous-quantity"
    );
  });

  it("builds pointer targets against the exact candidate-bearing prompt", () => {
    const records = buildT5TrainingRecords(makeExample(), {
      captureId: "capture-1",
      split: "train",
      imagePath: "assets/page.png",
      extractionTargetFormat: "evidence-pointer"
    });
    const extraction = records.filter((record) => record.task === "extract-product");
    const comparable = extraction[0]!;
    const abstention = extraction[1]!;
    const observation = parseT5PromptObservation(comparable.prompt);

    expect(comparable.prompt).toContain("CANDIDATES: ");
    expect(comparable.target).toContain("CURRENT_PRICE price-a@p0");
    expect(comparable.target).not.toContain('"cents"');
    expect(comparable.metadata.targetFormat).toBe("evidence-pointer");
    expect(resolveEvidencePointer(comparable.target, observation).valid).toBe(true);
    expect(abstention.target).toContain("STATUS ambiguous-quantity");
    expect(abstention.target).toContain("CURRENT_PRICE NONE");
  });

  it("requires the internal split to cover development domains only", () => {
    const domainSplits: CorpusDomainSplits = {
      version: 1,
      seed: 1,
      development: ["a", "b"],
      selection: ["c"],
      heldOut: ["d"]
    };
    const valid: TrainingDomainSplits = {
      version: 1,
      seed: 1,
      train: ["a"],
      validation: ["b"]
    };

    expect(validateTrainingDomainSplits(domainSplits, valid)).toEqual([]);
    expect(getTrainingSplit("b", valid)).toBe("validation");
    expect(
      validateTrainingDomainSplits(domainSplits, {
        ...valid,
        validation: ["c"]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not a development domain"),
        expect.stringContaining("unassigned")
      ])
    );
  });

  it("aligns inference crops to the captured root when the page was scrolled", () => {
    const observation = makeExample().input.observation;
    delete observation.sourceRegion;
    observation.viewport.scrollY = 900;
    observation.viewport.height = 800;

    const discovery = buildT5DiscoveryRecords(observation, {
      captureId: "capture-1",
      pageId: observation.pageId,
      siteId: "shop",
      imagePath: "assets/page.png",
      discoveryChunkHeight: 900
    });
    const extraction = buildT5ExtractionRecord(observation, "card-b", {
      captureId: "capture-1",
      pageId: observation.pageId,
      siteId: "shop",
      imagePath: "assets/page.png",
      cardPadding: 20
    });

    expect(discovery).toHaveLength(2);
    expect(discovery[0]!.imageCrop).toEqual({ x: 0, y: 0, width: 1280, height: 900 });
    expect(extraction.imageCrop).toEqual({ x: 580, y: 1030, width: 440, height: 340 });
  });

  it("prunes dense observations while retaining commerce evidence and ancestor paths", () => {
    const observation = makeExample().input.observation;
    const filler = Array.from({ length: 30 }, (_, index) =>
      node(`filler-${index}`, "root", {
        x: 0,
        y: 500 + index,
        width: 10,
        height: 10
      })
    );
    observation.nodes.splice(1, 0, ...filler);

    const pruned = pruneObservationForModel(observation, 8);
    const ids = pruned.nodes.map((entry) => entry.id);

    expect(ids).toContain("root");
    expect(ids).toContain("card-a");
    expect(ids).toContain("title-a");
    expect(ids).toContain("price-a");
    expect(pruned.nodes).toHaveLength(8);
    expect(pruned.truncated).toBe(true);
  });

  it("never prunes required nodes when their ancestor paths exceed the node budget", () => {
    const observation = makeExample().input.observation;
    const required = Array.from({ length: 6 }, (_, index) => {
      const parentId = `required-parent-${index}`;
      const childId = `required-child-${index}`;
      observation.nodes.push(
        node(parentId, "root", {
          x: index * 100,
          y: 500,
          width: 90,
          height: 100
        }),
        node(childId, parentId, {
          x: index * 100,
          y: 520,
          width: 80,
          height: 60
        })
      );
      return childId;
    });

    const pruned = pruneObservationForModel(observation, 8, required);
    const ids = new Set(pruned.nodes.map((entry) => entry.id));

    expect(required.every((id) => ids.has(id))).toBe(true);
    expect(pruned.nodes.length).toBeGreaterThan(8);
  });

  it("pins target evidence nodes in extraction prompts", () => {
    const observation = makeExample().input.observation;
    const filler = Array.from({ length: 40 }, (_, index) =>
      node(`signal-${index}`, "card-a", {
        x: 100,
        y: 200 + index,
        width: 100,
        height: 20
      }, `$${index + 1}.00`)
    );
    observation.nodes.push(...filler);

    const record = buildT5ExtractionRecord(observation, "card-a", {
      captureId: "capture-1",
      pageId: observation.pageId,
      siteId: "shop",
      imagePath: "assets/page.png",
      maxExtractionNodes: 8,
      requiredExtractionNodeIds: ["title-a", "price-a"]
    });

    expect(record.prompt).toContain('"id":"title-a"');
    expect(record.prompt).toContain('"id":"price-a"');
    expect(record.prompt).toContain(
      "Allowed abstainReason values: insufficient-evidence"
    );
    expect(record.prompt).toContain("Allowed unit values: oz, lb, g, kg");
    expect(record.prompt).toContain(
      '"nativeUnitPrice":{"centsPerUnit":1.2'
    );
  });

  it("pins text-bearing descendants of extraction evidence containers", () => {
    const observation = makeExample().input.observation;
    const price = observation.nodes.find((entry) => entry.id === "price-a")!;
    delete price.text;
    observation.nodes.push(
      node(
        "price-symbol",
        "price-a",
        { x: 120, y: 180, width: 10, height: 30 },
        "$"
      ),
      node(
        "price-whole",
        "price-a",
        { x: 130, y: 180, width: 30, height: 30 },
        "10"
      ),
      node(
        "price-fraction",
        "price-a",
        { x: 160, y: 180, width: 20, height: 30 },
        "00"
      ),
      ...Array.from({ length: 40 }, (_, index) =>
        node(
          `signal-${index}`,
          "card-a",
          { x: 100, y: 220 + index, width: 100, height: 20 },
          `$${index + 1}.00`
        )
      )
    );

    const record = buildT5ExtractionRecord(observation, "card-a", {
      captureId: "capture-1",
      pageId: observation.pageId,
      siteId: "shop",
      imagePath: "assets/page.png",
      maxExtractionNodes: 8,
      requiredExtractionNodeIds: ["title-a", "price-a"]
    });

    expect(record.prompt).toContain('"id":"price-symbol"');
    expect(record.prompt).toContain('"id":"price-whole"');
    expect(record.prompt).toContain('"id":"price-fraction"');
  });
});

function makeExample(): TrainingExample {
  const observation: PageObservation = {
    version: 1,
    pageId: "shop--coffee",
    url: "https://shop.example/search",
    title: "Coffee",
    viewport: { width: 1280, height: 1800, scrollX: 0, scrollY: 0 },
    rootNodeId: "root",
    sourceRegion: { x: 0, y: 0, width: 1280, height: 1800 },
    nodes: [
      node("root", undefined, { x: 0, y: 0, width: 1280, height: 1800 }),
      node("card-a", "root", { x: 100, y: 100, width: 400, height: 300 }),
      node("title-a", "card-a", { x: 120, y: 120, width: 300, height: 30 }, "Coffee, 20 oz"),
      node("price-a", "card-a", { x: 120, y: 180, width: 100, height: 30 }, "$10.00"),
      node("card-b", "root", { x: 600, y: 1050, width: 400, height: 300 }),
      node("title-b", "card-b", { x: 620, y: 1070, width: 300, height: 30 }, "Coffee")
    ],
    truncated: false
  };
  return {
    version: 1,
    split: "development",
    pageId: observation.pageId,
    siteId: "shop",
    input: {
      instructions: "extract",
      observation
    },
    target: {
      version: 1,
      pageId: observation.pageId,
      products: [
        product("card-a", "title-a", {
          currentPrice: {
            cents: 1000,
            currency: "USD",
            evidenceNodeIds: ["price-a"]
          },
          packageQuantity: {
            valuePerPackage: 20,
            packCount: 1,
            unit: "oz",
            dimension: "mass",
            evidenceNodeIds: ["title-a"]
          }
        }),
        product("card-b", "title-b", {
          abstainReason: "ambiguous-quantity"
        })
      ]
    }
  };
}

function product(
  cardNodeId: string,
  titleNodeId: string,
  values: Partial<ModelProductExtraction>
): ModelProductExtraction {
  return {
    cardNodeId,
    title: {
      value: "Coffee",
      evidenceNodeIds: [titleNodeId]
    },
    ...values
  };
}

function node(
  id: string,
  parentId: string | undefined,
  bounds: { x: number; y: number; width: number; height: number },
  text?: string
): ObservedNode {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag: parentId ? "span" : "main",
    ...(text ? { text } : {}),
    bounds,
    intersectsViewport: bounds.y < 800,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 16,
      fontWeight: 400
    }
  };
}
