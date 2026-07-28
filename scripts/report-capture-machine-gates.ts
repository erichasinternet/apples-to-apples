import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { countQueryRelevantCandidates } from "./candidate-query-relevance-lib";

interface BoundedResult {
  pageId: string;
  runDirectory?: string;
  timedOut: boolean;
  childStatus: {
    status: "captured" | "blocked" | "error";
    message?: string;
  } | null;
}

interface BoundedReport {
  results: BoundedResult[];
}

interface CapturePage {
  target: {
    query: string;
  };
  blocked: boolean;
  blockReasons?: string[];
  candidateCount: number;
  candidateScreenshotsCaptured: number;
  candidateScreenshotEvidenceMismatches: number;
  observationTruncated: boolean;
  queryTokenCoverage: number;
  mainScreenshotCaptured: boolean;
  annotationScreenshotCaptured: boolean;
  unresolvedObstructionCoverage: number;
}

const options = parseOptions(process.argv.slice(2));
const latestResults = new Map<
  string,
  BoundedResult & { reportPath: string }
>();

for (const reportPath of options.reportPaths) {
  const report = JSON.parse(
    await readFile(reportPath, "utf8"),
  ) as BoundedReport;
  for (const result of report.results) {
    latestResults.set(result.pageId, { ...result, reportPath });
  }
}

const pages = [];
for (const result of latestResults.values()) {
  const reasons: string[] = [];
  let metrics: CapturePage | null = null;
  let queryRelevantCandidateCount: number | null = null;
  if (
    result.timedOut ||
    result.childStatus?.status !== "captured" ||
    !result.runDirectory
  ) {
    reasons.push(
      result.timedOut
        ? "capture process timed out"
        : result.childStatus?.message ??
            `collector status ${result.childStatus?.status ?? "missing"}`,
    );
  } else {
    try {
      metrics = JSON.parse(
        await readFile(
          path.join(
            options.captureRoot,
            result.runDirectory,
            result.pageId,
            "page.json",
          ),
          "utf8",
        ),
      ) as CapturePage;
      const cardDirectory = path.join(
        options.captureRoot,
        result.runDirectory,
        result.pageId,
        "cards",
      );
      const candidateTexts = await Promise.all(
        (await readdir(cardDirectory))
          .filter((filename) => filename.endsWith(".json"))
          .sort()
          .map(async (filename) => {
            const card = JSON.parse(
              await readFile(path.join(cardDirectory, filename), "utf8"),
            ) as { text?: string };
            return card.text ?? "";
          }),
      );
      queryRelevantCandidateCount = countQueryRelevantCandidates(
        metrics.target.query,
        candidateTexts,
      );
      if (metrics.blocked) {
        reasons.push(
          `blocked: ${(metrics.blockReasons ?? ["unspecified"]).join("; ")}`,
        );
      }
      if (metrics.candidateCount < 8) {
        reasons.push(`candidateCount=${metrics.candidateCount}`);
      }
      if (
        metrics.candidateScreenshotsCaptured !== metrics.candidateCount
      ) {
        reasons.push(
          `candidateScreenshots=${metrics.candidateScreenshotsCaptured}/${metrics.candidateCount}`,
        );
      }
      if (metrics.candidateScreenshotEvidenceMismatches !== 0) {
        reasons.push(
          `evidenceMismatches=${metrics.candidateScreenshotEvidenceMismatches}`,
        );
      }
      if (metrics.observationTruncated) {
        reasons.push("observationTruncated=true");
      }
      if (metrics.queryTokenCoverage < 1) {
        reasons.push(`queryTokenCoverage=${metrics.queryTokenCoverage}`);
      }
      if (!metrics.mainScreenshotCaptured) {
        reasons.push("mainScreenshotCaptured=false");
      }
      if (!metrics.annotationScreenshotCaptured) {
        reasons.push("annotationScreenshotCaptured=false");
      }
      if (metrics.unresolvedObstructionCoverage > 0.2) {
        reasons.push(
          `unresolvedObstructionCoverage=${metrics.unresolvedObstructionCoverage}`,
        );
      }
      if (
        queryRelevantCandidateCount <
        options.minimumRelevantCandidates
      ) {
        reasons.push(
          `queryRelevantCandidates=${queryRelevantCandidateCount}/${options.minimumRelevantCandidates}`,
        );
      }
    } catch (error) {
      reasons.push(
        `capture metadata unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  pages.push({
    pageId: result.pageId,
    reportPath: path.relative(process.cwd(), result.reportPath),
    runDirectory: result.runDirectory ?? null,
    acquisitionStatus: result.childStatus?.status ?? "missing",
    status: reasons.length === 0 ? "passed" : "failed",
    reasons,
    metrics,
    queryRelevantCandidateCount,
  });
}

pages.sort((left, right) => left.pageId.localeCompare(right.pageId));
const report = {
  version: 1,
  sourceReports: options.reportPaths.map((reportPath) =>
    path.relative(process.cwd(), reportPath),
  ),
  policy:
    "The newest bounded result for each page ID is evaluated against the same structural evidence gates required by capture promotion.",
  summary: {
    pages: pages.length,
    captured: pages.filter((page) => page.acquisitionStatus === "captured")
      .length,
    blocked: pages.filter((page) => page.acquisitionStatus === "blocked")
      .length,
    errors: pages.filter(
      (page) =>
        page.acquisitionStatus === "error" ||
        page.acquisitionStatus === "missing",
    ).length,
    passed: pages.filter((page) => page.status === "passed").length,
    failed: pages.filter((page) => page.status === "failed").length,
  },
  pages,
};

if (options.outputPath) {
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(
    options.outputPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}
process.stdout.write(`${JSON.stringify(report.summary)}\n`);

function parseOptions(args: string[]): {
  reportPaths: string[];
  captureRoot: string;
  outputPath?: string;
  minimumRelevantCandidates: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/report-capture-machine-gates.ts --reports report-a.json,report-b.json [--capture-root benchmark-data/live] [--output report.json]",
      );
    }
    values.set(name, value);
  }
  const reports = values.get("--reports");
  if (!reports) {
    throw new Error("Required: --reports.");
  }
  return {
    reportPaths: reports
      .split(",")
      .map((reportPath) => path.resolve(reportPath)),
    captureRoot: path.resolve(
      values.get("--capture-root") ?? "benchmark-data/live",
    ),
    minimumRelevantCandidates: Number(
      values.get("--minimum-relevant-candidates") ?? "8",
    ),
    ...(values.get("--output")
      ? { outputPath: path.resolve(values.get("--output")!) }
      : {}),
  };
}
