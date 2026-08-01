import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
run(["scripts/build.mjs"]);
run(["scripts/validate-extension-release.ts"]);

const manifest = JSON.parse(
  await readFile(path.join(root, "dist", "manifest.json"), "utf8")
) as { version: string };
const releaseDirectory = path.join(root, "artifacts", "releases");
const output = path.join(
  releaseDirectory,
  `apples-to-apples-${manifest.version}.zip`
);
const staging = await mkdtemp(path.join(tmpdir(), "ata-extension-release-"));

try {
  const files = (await listFiles(path.join(root, "dist")))
    .filter((filename) => !filename.endsWith(".map"))
    .sort();

  for (const relativePath of files) {
    const destination = path.join(staging, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, "dist", relativePath), destination);
    await chmod(destination, 0o644);
    await utimes(destination, new Date("1980-01-01T00:00:00Z"), new Date("1980-01-01T00:00:00Z"));
  }

  await mkdir(releaseDirectory, { recursive: true });
  await rm(output, { force: true });
  runSystem("zip", ["-X", "-q", output, ...files], staging);

  const archive = await readFile(output);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  await writeFile(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`, "utf8");

  const entries = systemOutput("unzip", ["-Z1", output]).trim().split("\n").filter(Boolean);
  if (!entries.includes("manifest.json") || entries.some((entry) => entry.endsWith(".map"))) {
    throw new Error("Release archive has an invalid root or includes source maps");
  }

  process.stdout.write(
    `${JSON.stringify({ output, sha256, files: entries.length, bytes: archive.length }, null, 2)}\n`
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}

function run(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Bun subprocess failed: ${args.join(" ")}`);
  }
}

function runSystem(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, TZ: "UTC" },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function systemOutput(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, TZ: "UTC" },
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}
