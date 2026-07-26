import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface BatchManifest {
  version: 1;
  campaignId: string;
  totals: {
    batches: number;
    pages: number;
    candidateCards: number;
  };
  batches: Array<{
    batchNumber: number;
    pages: number;
    candidateCards: number;
    reviewerQueues: Array<{
      reviewerId: string;
      path: string;
    }>;
  }>;
}

interface ValidationReport {
  version: 1;
  queueId: string;
  browser: string;
  pagesLoaded: number;
  screenshotsLoaded: number;
  candidateCards: number;
  onlyFrozenCardRootOffered: boolean;
  directFrozenCardNavigation: string;
  nonCandidateAncestor: string;
  incompleteCoverage: string;
  consoleErrors: number;
  reviewFilesWritten: number;
}

const options = parseOptions(process.argv.slice(2));
const manifestBytes = await readFile(options.manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as BatchManifest;
if (
  manifest.version !== 1 ||
  manifest.batches.length !== manifest.totals.batches
) {
  throw new Error("Batch manifest is invalid.");
}

await mkdir(options.outputDirectory, { recursive: true });
const reports: Array<{ bytes: Buffer; value: ValidationReport }> = [];

for (const [index, batch] of manifest.batches.entries()) {
  const reviewerQueue = batch.reviewerQueues.find(
    (queue) => queue.reviewerId === options.reviewerId,
  );
  if (!reviewerQueue) {
    throw new Error(
      `Batch ${batch.batchNumber} lacks reviewer ${options.reviewerId}.`,
    );
  }
  const suffix = String(batch.batchNumber).padStart(2, "0");
  const reviewDirectory = path.join(
    options.outputDirectory,
    `reviews-${suffix}`,
  );
  const validationPath = path.join(
    options.outputDirectory,
    `batch-${suffix}.json`,
  );
  const serverLogPath = path.join(
    options.outputDirectory,
    `server-${suffix}.log`,
  );
  const url = `http://127.0.0.1:${options.port}/`;
  process.stdout.write(
    `[${index + 1}/${manifest.batches.length}] ${reviewerQueue.path}\n`,
  );

  const server = spawn(
    process.execPath,
    [
      "scripts/serve-evidence-review.ts",
      "--queue",
      reviewerQueue.path,
      "--output",
      reviewDirectory,
      "--port",
      String(options.port),
    ],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const serverOutput: Buffer[] = [];
  server.stdout?.on("data", (chunk: Buffer) => serverOutput.push(chunk));
  server.stderr?.on("data", (chunk: Buffer) => serverOutput.push(chunk));

  try {
    await waitForServer(url, server);
    const validatorArgs = [
      "scripts/validate-evidence-review-workbench.ts",
      "--url",
      url,
      "--output",
      validationPath,
      "--reviews-dir",
      reviewDirectory,
      ...(options.headed ? ["--headed"] : []),
    ];
    const validation = await runProcess(process.execPath, validatorArgs);
    if (validation.code !== 0) {
      throw new Error(
        `Batch ${batch.batchNumber} validation failed:\n${validation.output}`,
      );
    }
  } finally {
    await stopProcess(server);
    await writeFile(serverLogPath, Buffer.concat(serverOutput));
  }

  const bytes = await readFile(validationPath);
  const report = JSON.parse(bytes.toString("utf8")) as ValidationReport;
  if (
    report.pagesLoaded !== batch.pages ||
    report.screenshotsLoaded !== batch.pages ||
    report.candidateCards !== batch.candidateCards ||
    !report.onlyFrozenCardRootOffered ||
    report.directFrozenCardNavigation !== "passed" ||
    report.nonCandidateAncestor !== "rejected-404" ||
    report.incompleteCoverage !== "rejected-422" ||
    report.consoleErrors !== 0 ||
    report.reviewFilesWritten !== 0
  ) {
    throw new Error(`Batch ${batch.batchNumber} report failed validation.`);
  }
  reports.push({ bytes, value: report });
}

const totals = reports.reduce(
  (result, report) => {
    result.pagesLoaded += report.value.pagesLoaded;
    result.screenshotsLoaded += report.value.screenshotsLoaded;
    result.candidateCards += report.value.candidateCards;
    result.consoleErrors += report.value.consoleErrors;
    result.reviewFilesWritten += report.value.reviewFilesWritten;
    return result;
  },
  {
    pagesLoaded: 0,
    screenshotsLoaded: 0,
    candidateCards: 0,
    consoleErrors: 0,
    reviewFilesWritten: 0,
  },
);
if (
  totals.pagesLoaded !== manifest.totals.pages ||
  totals.screenshotsLoaded !== manifest.totals.pages ||
  totals.candidateCards !== manifest.totals.candidateCards
) {
  throw new Error("Aggregate validation totals differ from the batch manifest.");
}

const aggregate = {
  version: 1,
  auditId: options.auditId,
  createdAt: new Date().toISOString(),
  source: {
    batchManifest: path.relative(process.cwd(), options.manifestPath),
    batchManifestSha256: sha256(manifestBytes),
    validationReportSha256: reports.map((report) => sha256(report.bytes)),
  },
  browser: options.headed
    ? "headed Playwright Chromium"
    : "headless Playwright Chromium",
  batches: reports.length,
  ...totals,
  onlyFrozenCardRootOffered: reports.every(
    (report) => report.value.onlyFrozenCardRootOffered,
  ),
  directFrozenCardNavigation: "passed",
  nonCandidateAncestor: "rejected-404",
  incompleteCoverage: "rejected-422",
  validation: {
    passed: true,
  },
  eligibility: {
    dualReviewed: false,
    adjudicated: false,
    reason:
      "Workbench validation proves batch integrity and usability, not semantic label correctness.",
  },
};
await mkdir(path.dirname(options.reportPath), { recursive: true });
await writeFile(
  options.reportPath,
  `${JSON.stringify(aggregate, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);

function parseOptions(args: string[]): {
  manifestPath: string;
  outputDirectory: string;
  reportPath: string;
  auditId: string;
  reviewerId: string;
  port: number;
  headed: boolean;
} {
  const values = new Map<string, string>();
  let headed = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--headed") {
      headed = true;
      continue;
    }
    const value = args[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/validate-evidence-review-batches.ts --manifest manifest.json --output-dir reports --report aggregate.json --audit-id id [--reviewer reviewer-a] [--port 4327] [--headed]",
      );
    }
    values.set(arg, value);
    index += 1;
  }
  const manifest = values.get("--manifest");
  const outputDirectory = values.get("--output-dir");
  const report = values.get("--report");
  const auditId = values.get("--audit-id");
  const port = Number(values.get("--port") ?? "4327");
  if (
    !manifest ||
    !outputDirectory ||
    !report ||
    !auditId ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  ) {
    throw new Error("Required: --manifest, --output-dir, --report, --audit-id.");
  }
  return {
    manifestPath: path.resolve(manifest),
    outputDirectory: path.resolve(outputDirectory),
    reportPath: path.resolve(report),
    auditId,
    reviewerId: values.get("--reviewer") ?? "reviewer-a",
    port,
    headed,
  };
}

async function waitForServer(url: string, process: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`Review server exited with code ${process.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Review server did not become ready.");
}

async function runProcess(
  command: string,
  args: string[],
): Promise<{ code: number; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        output: Buffer.concat(output).toString("utf8"),
      }),
    );
  });
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => process.once("close", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (process.exitCode === null) process.kill("SIGKILL");
        resolve();
      }, 2_000),
    ),
  ]);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
