import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  auditCapturePrivacy,
  redactSensitiveCaptureText,
  sanitizeCaptureUrl,
  validateCaptureProvenance,
  writeCaptureProvenance
} from "../../scripts/capture-provenance-lib";

describe("capture privacy and provenance", () => {
  it("removes every URL query and fragment", () => {
    expect(
      sanitizeCaptureUrl(
        "https://shop.example/search?q=coffee&access_token=secret#results"
      )
    ).toBe("https://shop.example/search");
  });

  it("detects direct identifiers, credentials, and sensitive URL parameters", () => {
    const result = auditCapturePrivacy({
      urls: [
        {
          source: "finalUrl",
          value: "https://shop.example/search?q=coffee&session=private"
        }
      ],
      texts: [
        {
          source: "observation",
          value:
            "Hi, Eric. Deliver to 123 Main Street. eric@example.com bearer abcdefghijklmnopqrstuvwxyz"
        }
      ]
    });

    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining([
        "sensitive-url-parameter",
        "email",
        "street-address",
        "account-greeting",
        "credential"
      ])
    );
  });

  it("does not treat a product count followed by a new-line brand as an address", () => {
    const result = auditCapturePrivacy({
      urls: [{ source: "page", value: "https://shop.example/search" }],
      texts: [{ source: "candidate", value: "2 sizes\nDr. Elsey's cat litter" }]
    });

    expect(result.passed).toBe(true);
  });

  it("redacts serialized addresses without flattening product text", () => {
    const value =
      "2 sizes\nDr. Elsey's cat litter; pickup at 160 Wadsworth Blvd";
    const redacted = redactSensitiveCaptureText(value);

    expect(redacted).toContain("2 sizes\nDr. Elsey's cat litter");
    expect(redacted).toContain("[REDACTED ADDRESS]");
    expect(redacted).not.toContain("160 Wadsworth Blvd");
  });

  it("hashes immutable assets while allowing annotations to evolve", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ata-provenance-"));
    await writeFile(path.join(directory, "observation.json"), "{}");
    await writeFile(path.join(directory, "annotation.json"), '{"status":"unreviewed"}');
    const provenance = await writeCaptureProvenance(directory, {
      pageId: "page",
      createdAt: "2026-07-24T20:00:00.000Z",
      sourceManifestSha256: "a".repeat(64),
      collectorSha256: "b".repeat(64)
    });

    expect(provenance.assets.map((asset) => asset.path)).toEqual([
      "observation.json"
    ]);
    await writeFile(path.join(directory, "annotation.json"), '{"status":"adjudicated"}');
    expect(await validateCaptureProvenance(directory, provenance)).toEqual([]);

    await writeFile(path.join(directory, "observation.json"), '{"changed":true}');
    expect(await validateCaptureProvenance(directory, provenance)).toContain(
      "asset hash mismatch: observation.json"
    );
    await writeFile(path.join(directory, "unlisted.html"), "new source");
    expect(await validateCaptureProvenance(directory, provenance)).toContain(
      "provenance asset inventory mismatch"
    );
    expect(JSON.parse(await readFile(path.join(directory, "provenance.json"), "utf8"))).toMatchObject({
      aggregateSha256: provenance.aggregateSha256
    });
  });
});
