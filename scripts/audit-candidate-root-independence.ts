import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageObservation } from "../src/learning/contracts";
import { selectIndependentCandidateRootIds } from "../src/learning/candidate-roots";
import type { EligibleCaptureEntry } from "./capture-eligibility-lib";
import type { CaptureProvenance } from "./capture-provenance-lib";

interface EligibleCaptureManifest {
  version: 1;
  captures: EligibleCaptureEntry[];
}

interface CapturedCandidate {
  nodeId: string;
}

const captureRoot = path.resolve(process.argv[2] ?? "benchmark-data/live");
const outputPath = path.resolve(
  process.argv[3] ??
    "benchmarks/capture-pilots/candidate-root-independence-audit.json"
);
const registryPath = path.resolve(
  "benchmarks/capture-pilots/eligible-captures.json"
);
const retiredRegistryPath = path.resolve(
  "benchmarks/capture-pilots/retired-captures.json"
);
const [registryBytes, retiredRegistryBytes, provenancePaths] =
  await Promise.all([
    readFile(registryPath),
    readFile(retiredRegistryPath),
    findFiles(captureRoot, "provenance.json")
  ]);
const registry = JSON.parse(
  registryBytes.toString("utf8")
) as EligibleCaptureManifest;
const captureByIdentity = new Map<string, string[]>();

for (const provenancePath of provenancePaths) {
  const directory = path.dirname(provenancePath);
  const [provenance, page] = await Promise.all([
    readJson<CaptureProvenance>(provenancePath),
    readJson<{ capturedAt: string }>(path.join(directory, "page.json"))
  ]);
  const observation = provenance.assets.find(
    (asset) => asset.path === "observation.json"
  );
  const screenshot = provenance.assets.find(
    (asset) => asset.path === "annotation.png"
  );
  if (!observation || !screenshot) continue;
  const key = captureIdentityKey(
    page.capturedAt,
    observation.sha256,
    screenshot.sha256
  );
  const directories = captureByIdentity.get(key) ?? [];
  directories.push(directory);
  captureByIdentity.set(key, directories);
}

const missingCaptures: string[] = [];
const duplicateArtifacts: string[] = [];
const conflictingArtifacts: string[] = [];
const overlappingCaptures: Array<{
  pageId: string;
  candidateRoots: number;
  independentRoots: number;
}> = [];
let candidateRoots = 0;

for (const capture of registry.captures) {
  const directories =
    captureByIdentity.get(
      captureIdentityKey(
        capture.captureTimestamp,
        capture.observationSha256,
        capture.annotationScreenshotSha256
      )
    ) ?? [];
  if (directories.length === 0) {
    missingCaptures.push(capture.pageId);
    continue;
  }
  if (directories.length > 1) {
    duplicateArtifacts.push(capture.pageId);
  }
  const rootSets = [];
  let independentRootCount: number | undefined;
  for (const directory of directories) {
    const [observation, cardFiles] = await Promise.all([
      readJson<PageObservation>(path.join(directory, "observation.json")),
      listCandidateCardFiles(path.join(directory, "cards"))
    ]);
    const candidates = await Promise.all(
      cardFiles.map((filename) => readJson<CapturedCandidate>(filename))
    );
    const candidateIds = candidates.map((candidate) => candidate.nodeId);
    const independentIds = selectIndependentCandidateRootIds(
      observation.nodes,
      candidateIds
    );
    rootSets.push(candidateIds);
    independentRootCount =
      independentRootCount === undefined
        ? independentIds.length
        : Math.min(independentRootCount, independentIds.length);
  }
  const candidateIds = rootSets[0]!;
  if (
    rootSets.some(
      (rootSet) => JSON.stringify(rootSet) !== JSON.stringify(candidateIds)
    )
  ) {
    conflictingArtifacts.push(capture.pageId);
  }
  candidateRoots += candidateIds.length;
  if (
    independentRootCount !== candidateIds.length ||
    new Set(candidateIds).size !== candidateIds.length
  ) {
    overlappingCaptures.push({
      pageId: capture.pageId,
      candidateRoots: candidateIds.length,
      independentRoots: independentRootCount ?? 0
    });
  }
}

const report = {
  version: 1,
  auditedAt: new Date().toISOString(),
  captureRoot: path.relative(process.cwd(), captureRoot),
  eligibleCaptureRegistrySha256: sha256(registryBytes),
  retiredCaptureRegistrySha256: sha256(retiredRegistryBytes),
  eligibleCaptures: registry.captures.length,
  locatedCaptures:
    registry.captures.length - missingCaptures.length,
  candidateRoots,
  missingCaptures,
  duplicateArtifacts,
  conflictingArtifacts,
  overlappingCaptures,
  valid:
    missingCaptures.length === 0 &&
    conflictingArtifacts.length === 0 &&
    overlappingCaptures.length === 0
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.valid) process.exitCode = 1;

async function findFiles(directory: string, basename: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(filename, basename)));
    } else if (entry.name === basename) {
      files.push(filename);
    }
  }
  return files;
}

async function listCandidateCardFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((filename) => filename.endsWith(".json"))
    .sort()
    .map((filename) => path.join(directory, filename));
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function captureIdentityKey(
  capturedAt: string,
  observationSha256: string,
  screenshotSha256: string
): string {
  return `${capturedAt}\0${observationSha256}\0${screenshotSha256}`;
}
