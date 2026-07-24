import { execFile } from "node:child_process";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { CorpusAnnotation } from "../../scripts/live-corpus-lib";
import type { PageObservation } from "../../src/learning/contracts";

describe("training preparation CLI", () => {
  it("sanitizes generation padding before tokenizer decoding", async () => {
    const result = await promisify(execFile)(
      "python3",
      [
        "-c",
        [
          "import json",
          "from training.train_t5gemma2 import sanitize_token_ids",
          "print(json.dumps(sanitize_token_ids(",
          "  [[0, 5, -100, -1, 9, 10]],",
          "  pad_token_id=0,",
          "  vocabulary_size=10,",
          ")))"
        ].join("\n")
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    expect(JSON.parse(result.stdout)).toEqual([[0, 5, 0, 0, 9, 0]]);
  });

  it("exports domain-separated discovery and extraction records", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ata-training-"));
    const runDirectory = path.join(temporaryRoot, "run");
    const outputDirectory = path.join(temporaryRoot, "dataset");
    try {
      await mkdir(runDirectory, { recursive: true });
      await writeJson(path.join(runDirectory, "run.json"), {
        runId: "fixture-run",
        results: [
          { pageId: "walmart--fixture", status: "captured" },
          { pageId: "amazon--fixture", status: "captured" }
        ]
      });
      await writePage(runDirectory, "walmart--fixture", "walmart");
      await writePage(runDirectory, "amazon--fixture", "amazon");

      const result = await promisify(execFile)(
        "bun",
        [
          "scripts/prepare-t5-training.ts",
          runDirectory,
          "--output",
          outputDirectory
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );
      expect(result.stderr).toBe("");

      const manifest = JSON.parse(
        await readFile(path.join(outputDirectory, "dataset-manifest.json"), "utf8")
      );
      expect(manifest.records).toEqual({
        train: 2,
        validation: 2,
        discovery: 2,
        extraction: 2
      });
      const trainRecord = JSON.parse(
        (await readFile(path.join(outputDirectory, "train.jsonl"), "utf8")).trim()
          .split("\n")[0]!
      );
      const validationRecord = JSON.parse(
        (await readFile(path.join(outputDirectory, "validation.jsonl"), "utf8")).trim()
          .split("\n")[0]!
      );
      expect(trainRecord.siteId).toBe("walmart");
      expect(validationRecord.siteId).toBe("amazon");

      const configPath = path.join(temporaryRoot, "config.json");
      await writeJson(configPath, {
        modelId: "google/t5gemma-2-270m-270m",
        datasetManifest: path.join(outputDirectory, "dataset-manifest.json")
      });
      const validation = await promisify(execFile)(
        "python3",
        [
          "training/train_t5gemma2.py",
          "--config",
          configPath,
          "--validate-only"
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      );
      expect(JSON.parse(validation.stdout)).toEqual(
        expect.objectContaining({
          valid: true,
          products: 2,
          records: { train: 2, validation: 2 }
        })
      );

      await appendFile(
        path.join(outputDirectory, manifest.assets[0].path),
        Buffer.from("tampered")
      );
      await expect(
        promisify(execFile)(
          "python3",
          [
            "training/train_t5gemma2.py",
            "--config",
            configPath,
            "--validate-only"
          ],
          {
            cwd: process.cwd(),
            encoding: "utf8"
          }
        )
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Asset hash does not match manifest")
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

async function writePage(runDirectory: string, pageId: string, siteId: string): Promise<void> {
  const pageDirectory = path.join(runDirectory, pageId);
  await mkdir(pageDirectory, { recursive: true });
  await writeJson(path.join(pageDirectory, "page.json"), {
    target: { siteId }
  });
  const observation: PageObservation = {
    version: 1,
    pageId,
    url: "https://shop.example/search",
    title: "Coffee",
    viewport: { width: 1, height: 1, scrollX: 0, scrollY: 0 },
    rootNodeId: "card",
    nodes: [
      {
        id: "card",
        tag: "article",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        intersectsViewport: true,
        interactive: false,
        style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
      },
      {
        id: "title",
        parentId: "card",
        tag: "span",
        text: "Coffee, 20 oz",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        intersectsViewport: true,
        interactive: false,
        style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
      },
      {
        id: "price",
        parentId: "card",
        tag: "span",
        text: "$10.00",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        intersectsViewport: true,
        interactive: false,
        style: { display: "block", position: "static", fontSize: 16, fontWeight: 400 }
      }
    ],
    truncated: false
  };
  const annotation: CorpusAnnotation = {
    version: 1,
    pageId,
    reviewStatus: "adjudicated",
    coverage: "complete-main-region",
    region: { x: 0, y: 0, width: 1, height: 1 },
    annotators: ["reviewer-a", "reviewer-b"],
    products: [
      {
        nodeId: "card",
        scope: "primary-results",
        comparable: true,
        title: "Coffee, 20 oz",
        evidenceNodeIds: ["title", "price"],
        fieldEvidence: {
          title: ["title"],
          currentPrice: ["price"],
          packageQuantity: ["title"]
        },
        currentPriceCents: 1000,
        packageQuantity: {
          valuePerPackage: 20,
          packCount: 1,
          unit: "oz",
          dimension: "mass"
        }
      }
    ]
  };
  await Promise.all([
    writeJson(path.join(pageDirectory, "observation.json"), observation),
    writeJson(path.join(pageDirectory, "annotation.json"), annotation),
    writeFile(
      path.join(pageDirectory, "annotation.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4S8AAAAASUVORK5CYII=",
        "base64"
      )
    )
  ]);
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
