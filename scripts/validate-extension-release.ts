import { readFile } from "node:fs/promises";
import path from "node:path";

interface Manifest {
  version?: string;
  description?: string;
  minimum_chrome_version?: string;
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string> };
}

const root = process.cwd();
const errors: string[] = [];
const packageJson = await readJson<{ version?: string }>(path.join(root, "package.json"));
const manifest = await readJson<Manifest>(path.join(root, "public", "manifest.json"));

if (manifest.version !== packageJson.version) {
  errors.push(`manifest version ${manifest.version ?? "missing"} does not match package version ${packageJson.version ?? "missing"}`);
}

if (!manifest.description || manifest.description.length > 132) {
  errors.push("manifest description must contain 1-132 characters");
}

if (manifest.minimum_chrome_version !== "120") {
  errors.push("minimum_chrome_version must match the build target (120)");
}

const permissions = [...(manifest.permissions ?? [])].sort();
if (permissions.join(",") !== "scripting,storage") {
  errors.push(`permissions must be exactly scripting and storage; received ${permissions.join(", ") || "none"}`);
}

const hosts = [...(manifest.host_permissions ?? [])].sort();
if (hosts.join(",") !== "http://*/*,https://*/*") {
  errors.push("host permissions must cover HTTP(S) pages and no other origins");
}

const iconSizes = [16, 32, 48, 128];
for (const size of iconSizes) {
  const relativePath = manifest.icons?.[String(size)];
  if (!relativePath) {
    errors.push(`manifest is missing its ${size}px icon declaration`);
    continue;
  }
  await validatePng(path.join(root, "public", relativePath), size, size, `manifest ${size}px icon`);
}

for (const size of [16, 32]) {
  if (manifest.action?.default_icon?.[String(size)] !== `icons/icon-${size}.png`) {
    errors.push(`action icon ${size}px is missing or points to an unexpected file`);
  }
}

await validatePng(
  path.join(root, "store-assets", "listing", "icon-128.png"),
  128,
  128,
  "store icon"
);
await validatePng(
  path.join(root, "store-assets", "listing", "promo-small-440x280.png"),
  440,
  280,
  "small promotional image"
);
for (const filename of [
  "screenshot-normalized-1280x800.png",
  "screenshot-sorted-1280x800.png"
]) {
  await validatePng(
    path.join(root, "store-assets", "listing", filename),
    1280,
    800,
    filename
  );
}

const privacy = await readText(path.join(root, "public", "privacy.html"), "privacy policy");
const normalizedPrivacy = privacy.replace(/\s+/g, " ").toLowerCase();
for (const phrase of [
  "does not send page contents",
  "do not sell user data",
  "Limited Use requirements"
]) {
  if (!normalizedPrivacy.includes(phrase.toLowerCase())) {
    errors.push(`privacy policy is missing required disclosure: ${phrase}`);
  }
}

await readText(path.join(root, "store-assets", "STORE_LISTING.md"), "store listing copy");
await readText(
  path.join(root, "public", "THIRD_PARTY_NOTICES.txt"),
  "packaged third-party notices"
);

if (errors.length > 0) {
  throw new Error(`Extension release validation failed:\n- ${errors.join("\n- ")}`);
}

process.stdout.write(
  `${JSON.stringify({ valid: true, version: manifest.version, icons: iconSizes.length, screenshots: 2 }, null, 2)}\n`
);

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

async function readText(filename: string, label: string): Promise<string> {
  try {
    return await readFile(filename, "utf8");
  } catch {
    errors.push(`${label} is missing: ${path.relative(root, filename)}`);
    return "";
  }
}

async function validatePng(
  filename: string,
  expectedWidth: number,
  expectedHeight: number,
  label: string
): Promise<void> {
  try {
    const bytes = await readFile(filename);
    const signature = bytes.subarray(0, 8).toString("hex");
    if (signature !== "89504e470d0a1a0a" || bytes.length < 24) {
      errors.push(`${label} is not a valid PNG`);
      return;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== expectedWidth || height !== expectedHeight) {
      errors.push(`${label} must be ${expectedWidth}x${expectedHeight}; received ${width}x${height}`);
    }
  } catch {
    errors.push(`${label} is missing: ${path.relative(root, filename)}`);
  }
}
