import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

interface BoundedReport {
  results: Array<{
    pageId: string;
    runDirectory: string;
  }>;
}

const options = parseOptions(process.argv.slice(2));
await mkdir(options.outputDirectory, { recursive: true });

const pages = (
  await Promise.all(
    options.reportPaths.map(async (reportPath) => {
      const report = JSON.parse(
        await readFile(reportPath, "utf8"),
      ) as BoundedReport;
      return report.results;
    }),
  )
).flat();

for (const page of pages) {
  const cardDirectory = path.resolve(
    options.captureRoot,
    page.runDirectory,
    page.pageId,
    "cards",
  );
  const cardPaths = (await readdir(cardDirectory))
    .filter((filename) => filename.endsWith(".png"))
    .sort()
    .map((filename) => path.join(cardDirectory, filename));
  if (cardPaths.length === 0) {
    throw new Error(`${page.pageId}: no candidate screenshots`);
  }

  const columns = Math.min(4, cardPaths.length);
  const rows = Math.ceil(cardPaths.length / columns);
  const filters = cardPaths.map(
    (_, index) =>
      `[${index}:v]scale=400:470:force_original_aspect_ratio=decrease,` +
      `pad=400:470:(ow-iw)/2:(oh-ih)/2:color=white[v${index}]`,
  );
  const layout = cardPaths
    .map(
      (_, index) =>
        `${(index % columns) * 400}_${Math.floor(index / columns) * 470}`,
    )
    .join("|");
  filters.push(
    `${cardPaths.map((_, index) => `[v${index}]`).join("")}` +
      `xstack=inputs=${cardPaths.length}:layout=${layout}:fill=white[out]`,
  );

  const outputPath = path.join(
    options.outputDirectory,
    `${page.pageId}.png`,
  );
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...cardPaths.flatMap((cardPath) => ["-i", cardPath]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-frames:v",
      "1",
      outputPath,
    ],
    { encoding: "utf8" },
  );
  if (ffmpeg.error) {
    throw ffmpeg.error;
  }
  if (ffmpeg.status !== 0) {
    throw new Error(
      `${page.pageId}: FFmpeg failed: ${ffmpeg.stderr.trim()}`,
    );
  }

  if (rows * columns < cardPaths.length) {
    throw new Error(`${page.pageId}: sheet layout omitted a card`);
  }
}

process.stdout.write(
  `${JSON.stringify({
    valid: true,
    pages: pages.length,
    outputDirectory: options.outputDirectory,
  })}\n`,
);

function parseOptions(args: string[]): {
  reportPaths: string[];
  captureRoot: string;
  outputDirectory: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(
        "Usage: bun scripts/build-card-review-sheets.ts --reports report-a.json,report-b.json --output sheets [--capture-root benchmark-data/live]",
      );
    }
    values.set(name, value);
  }
  const reports = values.get("--reports");
  const output = values.get("--output");
  if (!reports || !output) {
    throw new Error("Required: --reports and --output.");
  }
  return {
    reportPaths: reports.split(",").map((filename) => path.resolve(filename)),
    captureRoot: path.resolve(
      values.get("--capture-root") ?? "benchmark-data/live",
    ),
    outputDirectory: path.resolve(output),
  };
}
