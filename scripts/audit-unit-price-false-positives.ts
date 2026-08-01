import { JSDOM } from "jsdom";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractProductsFromDocument, type DomProduct } from "../src/content/extractor";
import { auditNormalizedProduct, type UnitPriceAuditFinding } from "../src/core/unit-price-audit";
import {
  DEFAULT_PREFERENCES,
  type CanonicalUnit,
  type Dimension
} from "../src/core/types";
import type { AnnotatedProduct, CorpusAnnotation } from "./live-corpus-lib";

interface PageMetadata {
  pageId: string;
  finalUrl: string;
  blocked: boolean;
  target: {
    dimension: Dimension;
    hostname: string;
    siteId: string;
    stratum: string;
  };
}

interface EmittedOutput {
  capture: string;
  pageId: string;
  siteId: string;
  stratum: string;
  targetDimension: Dimension;
  title: string;
  display: string;
  dimension: Dimension;
  centsPerUnit: number;
  unit: CanonicalUnit;
  source: "native-unit-price" | "price-and-package" | "unknown";
  price?: {
    cents: number;
    sourceText: string;
  };
  packageQuantity?: {
    value: number;
    unit: string;
    dimension: Dimension;
    sourceText: string;
  };
  nativeUnitPrice?: {
    centsPerUnit: number;
    unit: string;
    dimension: Dimension;
    sourceText: string;
  };
  packCount?: number;
  explanation: string;
  warnings: string[];
  evidence: Array<{ kind: string; text: string }>;
  auditReasons: UnitPriceAuditFinding[];
}

interface OutputFinding extends EmittedOutput {
  classification: "confirmed-false-positive" | "semantic-error" | "review-candidate";
  reasons: Array<UnitPriceAuditFinding | { reason: string; severity: "error" | "review" | "info"; detail: string }>;
  annotation?: {
    nodeId: string;
    comparable: boolean;
    title: string;
    reviewStatus: "in-review" | "adjudicated";
  };
}

const root = path.resolve(optionValue("--root") ?? "benchmark-data/live");
const output = path.resolve(
  optionValue("--output") ?? "artifacts/audits/unit-price-false-positives.json"
);
const markdownOutput = output.replace(/\.json$/i, ".md");
const startPage = parseNonNegativeInteger(optionValue("--start-page")) ?? 0;
const maxPages = parsePositiveInteger(optionValue("--max-pages"));
const captures = (await readdir(root, { recursive: true }))
  .filter((filename) => filename.endsWith(`${path.sep}main.html`) || filename === "main.html");
captures.sort();
if (startPage > 0) captures.splice(0, startPage);
if (maxPages) captures.splice(maxPages);

const findings: OutputFinding[] = [];
const emittedOutputs: EmittedOutput[] = [];
const errors: Array<{ capture: string; error: string }> = [];
const counts = {
  discoveredPages: captures.length,
  auditedPages: 0,
  blockedPages: 0,
  emittedUnitPrices: 0,
  outputsWithSemanticErrors: 0,
  reviewCandidates: 0,
  confirmedFalsePositives: 0,
  reviewedOutputMatches: 0,
  unreviewedOutputs: 0,
  annotationPages: 0,
  targetDimensionMismatches: 0
};
const byDimension: Record<string, number> = {};
const byReason: Record<string, number> = {};
const bySite: Record<string, { pages: number; outputs: number; findings: number }> = {};

for (const [index, relativeHtml] of captures.entries()) {
  const directory = path.join(root, path.dirname(relativeHtml));
  try {
    const [page, annotation, html] = await Promise.all([
      readJson<PageMetadata>(path.join(directory, "page.json")),
      readOptionalJson<CorpusAnnotation>(path.join(directory, "annotation.json")),
      readFile(path.join(root, relativeHtml), "utf8")
    ]);
    if (page.blocked) {
      counts.blockedPages += 1;
      continue;
    }

    const site = (bySite[page.target.siteId] ??= { pages: 0, outputs: 0, findings: 0 });
    site.pages += 1;
    counts.auditedPages += 1;
    if (annotation?.products.length) counts.annotationPages += 1;

    const dom = new JSDOM(html, { url: page.finalUrl });
    const document = dom.window.document;
    const priorDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: document });

    let products: DomProduct[];
    try {
      products = extractProductsFromDocument(
        document,
        DEFAULT_PREFERENCES,
        page.target.hostname
      );
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: priorDocument
      });
    }

    counts.emittedUnitPrices += products.length;
    site.outputs += products.length;
    for (const product of products) {
      if (!product.normalized) continue;
      const annotationMatch = findAnnotationMatch(product, annotation, document);
      const reasons: OutputFinding["reasons"] = auditNormalizedProduct(
        product,
        page.target.dimension
      );
      let classification: OutputFinding["classification"] | undefined;

      if (annotationMatch) {
        counts.reviewedOutputMatches += 1;
        const annotationReason = compareWithAnnotation(product, annotationMatch.label);
        if (annotationReason) {
          if (annotationMatch.reviewStatus === "adjudicated") {
            reasons.push({ ...annotationReason, severity: "error" });
            classification = "confirmed-false-positive";
            counts.confirmedFalsePositives += 1;
          } else {
            reasons.push({ ...annotationReason, severity: "review" });
          }
        }
      } else {
        counts.unreviewedOutputs += 1;
      }

      const semanticErrors = reasons.filter((reason) => reason.severity === "error");
      const reviewReasons = reasons.filter((reason) => reason.severity === "review");
      if (reasons.some((reason) => reason.reason === "target-dimension-mismatch")) {
        counts.targetDimensionMismatches += 1;
      }
      if (!classification && semanticErrors.length > 0) {
        classification = "semantic-error";
        counts.outputsWithSemanticErrors += 1;
      } else if (!classification && reviewReasons.length > 0) {
        classification = "review-candidate";
        counts.reviewCandidates += 1;
      }

      byDimension[product.normalized.dimension] =
        (byDimension[product.normalized.dimension] ?? 0) + 1;
      for (const reason of reasons) byReason[reason.reason] = (byReason[reason.reason] ?? 0) + 1;

      const emittedOutput: EmittedOutput = {
        capture: path.relative(process.cwd(), directory),
        pageId: page.pageId,
        siteId: page.target.siteId,
        stratum: page.target.stratum,
        targetDimension: page.target.dimension,
        title: product.title,
        display: product.normalized.display,
        dimension: product.normalized.dimension,
        centsPerUnit: product.normalized.centsPerUnit,
        unit: product.normalized.unit,
        source: product.normalized.evidence.some(
          (evidence) => evidence.kind === "native-unit-price"
        )
          ? "native-unit-price"
          : product.normalized.evidence.some(
                (evidence) => evidence.kind === "current-price"
              )
            ? "price-and-package"
            : "unknown",
        ...(product.price
          ? {
              price: {
                cents: product.price.cents,
                sourceText: product.price.sourceText
              }
            }
          : {}),
        ...(product.packageQuantity
          ? {
              packageQuantity: {
                value: product.packageQuantity.value,
                unit: product.packageQuantity.unit,
                dimension: product.packageQuantity.dimension,
                sourceText: product.packageQuantity.sourceText
              }
            }
          : {}),
        ...(product.nativeUnitPrice
          ? {
              nativeUnitPrice: {
                centsPerUnit: product.nativeUnitPrice.centsPerUnit,
                unit: product.nativeUnitPrice.unit,
                dimension: product.nativeUnitPrice.dimension,
                sourceText: product.nativeUnitPrice.sourceText
              }
            }
          : {}),
        ...(product.packCount ? { packCount: product.packCount } : {}),
        explanation: product.normalized.explanation,
        warnings: product.normalized.warnings,
        evidence: product.normalized.evidence,
        auditReasons: reasons.filter(
          (reason): reason is UnitPriceAuditFinding =>
            reason.reason !== "reviewed-non-comparable-output" &&
            reason.reason !== "reviewed-normalization-mismatch"
        )
      };
      emittedOutputs.push(emittedOutput);

      if (classification) {
        site.findings += 1;
        findings.push({
          ...emittedOutput,
          classification,
          reasons,
          ...(annotationMatch
            ? {
                annotation: {
                  nodeId: annotationMatch.label.nodeId,
                  comparable: annotationMatch.label.comparable,
                  title: annotationMatch.label.title,
                  reviewStatus: annotationMatch.reviewStatus
                }
              }
            : {})
        });
      }
    }
    products.length = 0;
    dom.window.close();
    if ((index + 1) % 10 === 0) {
      const gc = (globalThis as { Bun?: { gc?: (force?: boolean) => void } }).Bun?.gc;
      gc?.(true);
    }
  } catch (error) {
    errors.push({ capture: relativeHtml, error: error instanceof Error ? error.message : String(error) });
  }

  if ((index + 1) % 100 === 0) {
    process.stderr.write(`Audited ${index + 1}/${captures.length} captures\n`);
  }
}

const report = {
  version: 2,
  createdAt: new Date().toISOString(),
  root: path.relative(process.cwd(), root),
  policy: {
    purpose: "Precision audit of every unit price emitted while replaying saved live-site DOM snapshots.",
    evidenceLimits:
      "Only conflicts with reviewed annotations are confirmed false positives. Semantic errors are deterministic rule violations. Target-dimension mismatches are informational context, not assumed failures.",
    statisticalClaim:
      "No population accuracy claim is made because the current live annotations are not adjudicated with complete output coverage."
  },
  counts,
  byDimension: sortRecord(byDimension),
  byReason: sortRecord(byReason),
  bySite: Object.fromEntries(
    Object.entries(bySite).sort((left, right) => right[1].findings - left[1].findings || left[0].localeCompare(right[0]))
  ),
  errors,
  findings,
  emittedOutputs
};

await mkdir(path.dirname(output), { recursive: true });
await Promise.all([
  writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(markdownOutput, renderMarkdown(report), "utf8")
]);
process.stdout.write(
  `${JSON.stringify({ output, markdownOutput, counts, byReason: report.byReason, errors: errors.length }, null, 2)}\n`
);

function findAnnotationMatch(
  product: DomProduct,
  annotation: CorpusAnnotation | undefined,
  document: Document
): { label: AnnotatedProduct; reviewStatus: "in-review" | "adjudicated" } | undefined {
  if (!annotation || annotation.reviewStatus === "unreviewed") return undefined;
  const matches: Array<{ label: AnnotatedProduct; element: HTMLElement }> = [];
  for (const label of annotation.products) {
    const element = document.querySelector<HTMLElement>(
      `[data-ata-benchmark-node="${label.nodeId}"]`
    );
    if (
      element &&
      (element === product.element ||
        element.contains(product.element) ||
        product.element.contains(element))
    ) {
      matches.push({ label, element });
    }
  }
  const label = matches.sort(
    (left, right) =>
      (left.element.textContent?.length ?? 0) -
      (right.element.textContent?.length ?? 0)
  )[0]?.label;
  return label ? { label, reviewStatus: annotation.reviewStatus } : undefined;
}

function compareWithAnnotation(
  product: DomProduct,
  annotation: AnnotatedProduct
): OutputFinding["reasons"][number] | undefined {
  if (!annotation.comparable) {
    return {
      reason: "reviewed-non-comparable-output",
      severity: "error",
      detail: "A reviewed label requires abstention, but the runtime emitted a unit price."
    };
  }
  const expected = annotation.expectedNormalized;
  const predicted = product.normalized;
  if (!expected || !predicted) return undefined;
  const relativeError = Math.abs(predicted.centsPerUnit - expected.centsPerUnit) / expected.centsPerUnit;
  const absoluteError = Math.abs(predicted.centsPerUnit - expected.centsPerUnit);
  if (
    predicted.dimension !== expected.dimension ||
    predicted.unit !== expected.unit ||
    !Number.isFinite(relativeError) ||
    (relativeError > 0.005 && absoluteError > 0.05)
  ) {
    return {
      reason: "reviewed-normalization-mismatch",
      severity: "error",
      detail: `Expected ${expected.centsPerUnit} cents/${expected.unit}; emitted ${predicted.centsPerUnit} cents/${predicted.unit}.`
    };
  }
  return undefined;
}

function renderMarkdown(reportValue: {
  createdAt: string;
  counts: typeof counts;
  byReason: Record<string, number>;
  errors: Array<{ capture: string; error: string }>;
  findings: OutputFinding[];
}): string {
  const topReasons = Object.entries(reportValue.byReason)
    .map(([reason, count]) => `| ${reason} | ${count} |`)
    .join("\n");
  const examples = reportValue.findings
    .slice(0, 100)
    .map((finding) => `| ${finding.classification} | ${finding.siteId} | ${finding.display} | ${escapeCell(finding.title)} | ${finding.reasons.map((reason) => reason.reason).join(", ")} |`)
    .join("\n");
  return `# Unit-price false-positive audit\n\nGenerated: ${reportValue.createdAt}\n\n## Scope\n\n- Saved pages discovered: ${reportValue.counts.discoveredPages}\n- Pages audited: ${reportValue.counts.auditedPages}\n- Unit prices emitted: ${reportValue.counts.emittedUnitPrices}\n- Confirmed false positives: ${reportValue.counts.confirmedFalsePositives}\n- Deterministic semantic errors: ${reportValue.counts.outputsWithSemanticErrors}\n- Review candidates: ${reportValue.counts.reviewCandidates}\n- Unreviewed outputs: ${reportValue.counts.unreviewedOutputs}\n- Replay errors: ${reportValue.errors.length}\n\nNo population accuracy claim is made until annotations have complete output coverage and adjudication.\n\n## Reasons\n\n| Reason | Count |\n| --- | ---: |\n${topReasons || "| None | 0 |"}\n\n## First 100 findings\n\n| Class | Site | Unit price | Title | Reasons |\n| --- | --- | ---: | --- | --- |\n${examples || "| None | - | - | - | - |"}\n`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function sortRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received ${value}`);
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`);
  }
  return parsed;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(filename, "utf8")) as T;
}

async function readOptionalJson<T>(filename: string): Promise<T | undefined> {
  try {
    return await readJson<T>(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
