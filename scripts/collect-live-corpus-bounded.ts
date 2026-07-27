import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBoundedProcess } from "./bounded-process-lib";

interface ChildRunManifest {
  runId: string;
  complete: boolean;
  results: Array<{
    pageId: string;
    status: "captured" | "blocked" | "error";
    message?: string;
  }>;
}

const options = parseOptions(process.argv.slice(2));
await mkdir(options.outputRoot, { recursive: true });
const batchId = `${new Date().toISOString().replace(/[:.]/g, "-")}--p${process.pid}`;
const results = [];

for (const [index, pageId] of options.pageIds.entries()) {
  process.stdout.write(`[${index + 1}/${options.pageIds.length}] ${pageId}\n`);
  const runId = `${batchId}--${String(index + 1).padStart(3, "0")}`;
  const childArgs = [
    "scripts/collect-live-corpus.ts",
    "--targets",
    options.targetsPath,
    "--output",
    options.outputRoot,
    "--pages",
    pageId,
    "--run-id",
    runId,
    "--viewport",
    options.viewport,
    "--page-timeout-ms",
    String(options.pageTimeoutMs),
    "--card-screenshot-budget-ms",
    String(options.cardScreenshotBudgetMs),
    "--delay-ms",
    "0",
    ...(options.headed ? ["--headed"] : []),
    ...(options.disableHttp2 ? ["--disable-http2"] : [])
  ];
  const child = await runBoundedProcess(process.execPath, childArgs, {
    cwd: process.cwd(),
    timeoutMs: options.processTimeoutMs,
    onOutput: (chunk) => process.stdout.write(indent(chunk))
  });
  const runDirectory = child.exitCode === 0 || child.timedOut ? runId : undefined;
  const manifest = runDirectory
    ? await readRunManifest(path.join(options.outputRoot, runDirectory))
    : null;
  results.push({
    pageId,
    timedOut: child.timedOut,
    durationMs: child.durationMs,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    ...(runDirectory ? { runDirectory } : {}),
    childComplete: manifest?.complete ?? false,
    childStatus: manifest?.results.find((entry) => entry.pageId === pageId) ?? null
  });
  if (child.timedOut) {
    process.stderr.write(
      `  hard timeout after ${options.processTimeoutMs} ms; process group terminated\n`
    );
  }
}

const reportPath = path.resolve(
  options.reportPath ??
    path.join(options.outputRoot, `bounded-${batchId}.json`)
);
const report = {
  version: 1,
  batchId,
  createdAt: new Date().toISOString(),
  sourceManifest: path.relative(process.cwd(), options.targetsPath),
  policy:
    "Each capture target runs in an isolated process group. A hard wall-clock timeout terminates the collector and its browser descendants without stopping the batch.",
  limits: {
    pageTimeoutMs: options.pageTimeoutMs,
    processTimeoutMs: options.processTimeoutMs,
    cardScreenshotBudgetMs: options.cardScreenshotBudgetMs
  },
  requestedPages: options.pageIds.length,
  completedChildren: results.filter((result) => result.childComplete).length,
  hardTimeouts: results.filter((result) => result.timedOut).length,
  results
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({
    valid: true,
    requestedPages: report.requestedPages,
    completedChildren: report.completedChildren,
    hardTimeouts: report.hardTimeouts,
    report: reportPath
  })}\n`
);

function parseOptions(args: string[]): {
  targetsPath: string;
  outputRoot: string;
  reportPath?: string;
  pageIds: string[];
  viewport: "desktop" | "narrow";
  pageTimeoutMs: number;
  processTimeoutMs: number;
  cardScreenshotBudgetMs: number;
  headed: boolean;
  disableHttp2: boolean;
} {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--headed" || arg === "--disable-http2") {
      flags.add(arg);
      continue;
    }
    const value = args[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/collect-live-corpus-bounded.ts --pages page-a,page-b [--targets manifest.json] [--viewport desktop|narrow] [--page-timeout-ms 60000] [--process-timeout-ms 90000] [--headed]"
      );
    }
    values.set(arg, value);
    index += 1;
  }
  const pageIds = [
    ...new Set(
      (values.get("--pages") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
  const viewport = values.get("--viewport") ?? "desktop";
  const pageTimeoutMs = Number(values.get("--page-timeout-ms") ?? "60000");
  const processTimeoutMs = Number(
    values.get("--process-timeout-ms") ?? String(pageTimeoutMs + 30_000)
  );
  const cardScreenshotBudgetMs = Number(
    values.get("--card-screenshot-budget-ms") ?? "15000"
  );
  if (
    pageIds.length === 0 ||
    !["desktop", "narrow"].includes(viewport) ||
    !Number.isFinite(pageTimeoutMs) ||
    pageTimeoutMs < 30_000 ||
    !Number.isFinite(processTimeoutMs) ||
    processTimeoutMs < pageTimeoutMs + 10_000 ||
    !Number.isFinite(cardScreenshotBudgetMs) ||
    cardScreenshotBudgetMs < 0 ||
    cardScreenshotBudgetMs > pageTimeoutMs / 2
  ) {
    throw new Error("Invalid bounded collector options.");
  }
  return {
    targetsPath: path.resolve(
      values.get("--targets") ?? "benchmarks/live-sites/targets.json"
    ),
    outputRoot: path.resolve(values.get("--output") ?? "benchmark-data/live"),
    ...(values.get("--report")
      ? { reportPath: path.resolve(values.get("--report")!) }
      : {}),
    pageIds,
    viewport: viewport as "desktop" | "narrow",
    pageTimeoutMs,
    processTimeoutMs,
    cardScreenshotBudgetMs,
    headed: flags.has("--headed"),
    disableHttp2: flags.has("--disable-http2")
  };
}

async function readRunManifest(
  runDirectory: string
): Promise<ChildRunManifest | null> {
  try {
    return JSON.parse(
      await readFile(path.join(runDirectory, "run.json"), "utf8")
    ) as ChildRunManifest;
  } catch {
    return null;
  }
}

function indent(value: string): string {
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${line}\n`)
    .join("");
}
