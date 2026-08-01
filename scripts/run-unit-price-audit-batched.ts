import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(optionValue("--root") ?? "benchmark-data/live");
const output = path.resolve(
  optionValue("--output") ?? "artifacts/audits/unit-price-false-positives.json"
);
const batchSize = parsePositiveInteger(optionValue("--batch-size")) ?? 100;
const captures = (await readdir(root, { recursive: true })).filter(
  (filename) => filename.endsWith(`${path.sep}main.html`) || filename === "main.html"
);
const partsDirectory = await mkdtemp(path.join(tmpdir(), "ata-unit-price-audit-"));

try {
  for (let startPage = 0; startPage < captures.length; startPage += batchSize) {
    process.stdout.write(`Auditing batch ${startPage}-${Math.min(startPage + batchSize, captures.length)}\n`);
    run([
      "--smol",
      "scripts/audit-unit-price-false-positives.ts",
      "--root",
      root,
      "--start-page",
      String(startPage),
      "--max-pages",
      String(batchSize),
      "--output",
      path.join(partsDirectory, `part-${startPage}.json`)
    ]);
  }

  run([
    "scripts/merge-unit-price-audit-parts.ts",
    "--parts",
    partsDirectory,
    "--output",
    output
  ]);
} finally {
  await rm(partsDirectory, { recursive: true, force: true });
}

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Audit subprocess exited with status ${result.status ?? "unknown"}`);
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
