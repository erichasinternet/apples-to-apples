import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const CAPTURE_PRIVACY_POLICY_VERSION = 1;

export interface CapturePrivacyAudit {
  version: typeof CAPTURE_PRIVACY_POLICY_VERSION;
  passed: boolean;
  findings: Array<{
    source: string;
    category:
      | "email"
      | "phone"
      | "street-address"
      | "account-greeting"
      | "credential"
      | "sensitive-url-parameter";
  }>;
}

export interface CaptureAsset {
  path: string;
  bytes: number;
  sha256: string;
}

export interface CaptureProvenance {
  version: 1;
  pageId: string;
  createdAt: string;
  anonymousContext: true;
  privacyPolicyVersion: typeof CAPTURE_PRIVACY_POLICY_VERSION;
  sourceManifestSha256: string;
  collectorSha256: string;
  assets: CaptureAsset[];
  aggregateSha256: string;
}

const SENSITIVE_QUERY_KEY =
  /^(?:access_token|auth|authorization|code|cookie|email|session|sid|token|user|userid|customer|address|postal|zip)$/i;
const SENSITIVE_TEXT: Array<{
  category: CapturePrivacyAudit["findings"][number]["category"];
  pattern: RegExp;
}> = [
  {
    category: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    category: "phone",
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/
  },
  {
    category: "street-address",
    pattern:
      /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z0-9][A-Za-z0-9.' -]{1,60}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/i
  },
  {
    category: "account-greeting",
    pattern: /\b(?:hi|hello|welcome back),?\s+[A-Z][a-z]{1,30}\b/i
  },
  {
    category: "credential",
    pattern:
      /\b(?:bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[-_]?key|access[-_]?token|session[-_]?id)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,})\b/i
  }
];
const SHA256 = /^[a-f0-9]{64}$/;

export function sanitizeCaptureUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function auditCapturePrivacy(input: {
  urls: Array<{ source: string; value: string }>;
  texts: Array<{ source: string; value: string }>;
}): CapturePrivacyAudit {
  const findings: CapturePrivacyAudit["findings"] = [];
  for (const { source, value } of input.urls) {
    const url = new URL(value);
    if ([...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) {
      findings.push({ source, category: "sensitive-url-parameter" });
    }
  }
  for (const { source, value } of input.texts) {
    for (const check of SENSITIVE_TEXT) {
      if (check.pattern.test(value)) {
        findings.push({ source, category: check.category });
      }
    }
  }
  return {
    version: CAPTURE_PRIVACY_POLICY_VERSION,
    passed: findings.length === 0,
    findings
  };
}

export async function writeCaptureProvenance(
  pageDirectory: string,
  input: {
    pageId: string;
    createdAt: string;
    sourceManifestSha256: string;
    collectorSha256: string;
  }
): Promise<CaptureProvenance> {
  const files = await listFiles(pageDirectory);
  const included = files.filter(
    (filename) =>
      filename !== "annotation.json" &&
      filename !== "provenance.json" &&
      !filename.endsWith(".review.json")
  );
  const assets = await Promise.all(
    included.map(async (filename): Promise<CaptureAsset> => {
      const value = await readFile(path.join(pageDirectory, filename));
      return {
        path: filename,
        bytes: value.byteLength,
        sha256: sha256(value)
      };
    })
  );
  assets.sort((left, right) => left.path.localeCompare(right.path));
  const aggregateSha256 = sha256(
    assets
      .map((asset) => `${asset.path}\0${asset.bytes}\0${asset.sha256}\n`)
      .join("")
  );
  const provenance: CaptureProvenance = {
    version: 1,
    pageId: input.pageId,
    createdAt: input.createdAt,
    anonymousContext: true,
    privacyPolicyVersion: CAPTURE_PRIVACY_POLICY_VERSION,
    sourceManifestSha256: input.sourceManifestSha256,
    collectorSha256: input.collectorSha256,
    assets,
    aggregateSha256
  };
  await writeFile(
    path.join(pageDirectory, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
    "utf8"
  );
  return provenance;
}

export async function validateCaptureProvenance(
  pageDirectory: string,
  provenance: CaptureProvenance
): Promise<string[]> {
  const errors: string[] = [];
  if (
    provenance.version !== 1 ||
    provenance.privacyPolicyVersion !== CAPTURE_PRIVACY_POLICY_VERSION ||
    provenance.anonymousContext !== true
  ) {
    errors.push("unsupported or non-anonymous capture provenance");
  }
  if (
    !SHA256.test(provenance.sourceManifestSha256) ||
    !SHA256.test(provenance.collectorSha256) ||
    !SHA256.test(provenance.aggregateSha256)
  ) {
    errors.push("invalid provenance SHA-256");
  }
  const currentAssets = (await listFiles(pageDirectory)).filter(
    (filename) =>
      filename !== "annotation.json" &&
      filename !== "provenance.json" &&
      !filename.endsWith(".review.json")
  );
  const listedAssets = provenance.assets.map((asset) => asset.path).sort();
  if (JSON.stringify(currentAssets.sort()) !== JSON.stringify(listedAssets)) {
    errors.push("provenance asset inventory mismatch");
  }
  for (const asset of provenance.assets) {
    const filename = path.join(pageDirectory, asset.path);
    try {
      const value = await readFile(filename);
      if (value.byteLength !== asset.bytes || sha256(value) !== asset.sha256) {
        errors.push(`asset hash mismatch: ${asset.path}`);
      }
    } catch {
      errors.push(`missing provenance asset: ${asset.path}`);
    }
  }
  const aggregate = sha256(
    [...provenance.assets]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((asset) => `${asset.path}\0${asset.bytes}\0${asset.sha256}\n`)
      .join("")
  );
  if (aggregate !== provenance.aggregateSha256) {
    errors.push("aggregate provenance hash mismatch");
  }
  return errors;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory);
  const output: string[] = [];
  for (const entry of entries.sort()) {
    const child = path.posix.join(relative, entry);
    const info = await stat(path.join(root, child));
    if (info.isDirectory()) {
      output.push(...(await listFiles(root, child)));
    } else if (info.isFile()) {
      output.push(child);
    }
  }
  return output;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
