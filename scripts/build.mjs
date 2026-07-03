import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const publicDir = path.join(root, "public");

const entries = [
  ["content", "src/content/index.ts"],
  ["service-worker", "src/extension/service-worker.ts"],
  ["popup", "src/popup/popup.ts"],
  ["options", "src/options/options.ts"]
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(publicDir, dist, { recursive: true });

await Promise.all(
  entries.map(([name, entry]) =>
    esbuild.build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(dist, `${name}.js`),
      bundle: true,
      format: "iife",
      platform: "browser",
      target: ["chrome120"],
      sourcemap: true,
      legalComments: "none",
      logLevel: "info"
    })
  )
);
