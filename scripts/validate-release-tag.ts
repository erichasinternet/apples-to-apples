import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
  version?: string;
};
const expectedTag = `v${packageJson.version ?? ""}`;
const actualTag = process.env.GITHUB_REF_NAME;

if (!packageJson.version || !/^\d+\.\d+\.\d+$/.test(packageJson.version)) {
  throw new Error("package.json must contain a valid semantic version");
}

if (!actualTag) {
  throw new Error("GITHUB_REF_NAME is required for tagged release validation");
}

if (actualTag !== expectedTag) {
  throw new Error(`release tag ${actualTag} does not match package version ${expectedTag}`);
}

process.stdout.write(`${JSON.stringify({ valid: true, tag: actualTag }, null, 2)}\n`);
