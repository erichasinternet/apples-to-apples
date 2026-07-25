export const AUTORESEARCH_COLUMNS = [
  "timestamp_utc",
  "experiment_id",
  "parent_id",
  "commit",
  "hypothesis_id",
  "changed_variable",
  "phase",
  "model",
  "dataset_sha256",
  "eval_sha256",
  "accepted_correct",
  "accepted_incorrect",
  "eligible_comparable",
  "abstention_true_positive",
  "abstention_false_negative",
  "pointer_exact",
  "pointer_total",
  "grammar_valid",
  "grammar_total",
  "evidence_accepted",
  "evidence_total",
  "native_accepted_correct",
  "native_eligible",
  "derived_accepted_correct",
  "derived_eligible",
  "site_macro_coverage",
  "domain_count",
  "p50_latency_ms",
  "p95_latency_ms",
  "peak_memory_mb",
  "artifact_size_mb",
  "cost_usd",
  "status",
  "decision",
  "notes"
] as const;

export type AutoresearchColumn = (typeof AUTORESEARCH_COLUMNS)[number];
export type AutoresearchRow = Record<AutoresearchColumn, string>;

export interface AutoresearchPolicy {
  version: number;
  budget: {
    totalUsd: number;
    estimatedSpentUsd: number;
    finalReserveUsd: number;
    maxPilotUsd: number;
    maxPilotTrainingMinutes: number;
    phaseCapsUsd: Record<string, number>;
  };
  experiments: {
    maxAttemptsPerHypothesis: number;
    formulationHypothesisLimit: number;
    minimumCoverageGain: number;
    oneVariablePerRun: boolean;
    teacherRunLimit: number;
    oracleRunLimit: number;
    studentVariantLimit: number;
  };
  gates: {
    formulation: {
      grammarValidity: number;
      minimumEvidenceAcceptance: number;
      acceptedPrecision: number;
      eligibleCoverage: number;
      abstentionRecall: number;
    };
    teacher: {
      grammarValidity: number;
      pointerExact: number;
      acceptedPrecision: number;
      eligibleCoverage: number;
      nativeCoverage: number;
      derivedCoverage: number;
      abstentionRecall: number;
      siteMacroCoverage: number;
    };
    oracle: {
      maximumCases: number;
      minimumPointerExactGain: number;
    };
    student: {
      acceptedPrecision: number;
      maximumCoverageRegression: number;
      maximumPointerExactRegression: number;
      abstentionRecall: number;
    };
    browser: {
      maximumArtifactSizeMb: number;
      maximumP50LatencyMs: number;
      maximumP95LatencyMs: number;
      maximumPeakMemoryMb: number;
    };
    final: {
      minimumDomains: number;
      minimumAcceptedOutputs: number;
      maximumAcceptedErrors: number;
      minimumPrecisionLowerBound95: number;
      eligibleCoverage: number;
      nativeCoverage: number;
      derivedCoverage: number;
      abstentionRecall: number;
    };
  };
}

const TERMINAL_STATUSES = new Set(["keep", "discard", "crash", "invalid"]);
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,40}$/;
const PHASES = new Set(["formulation", "teacher", "oracle", "student", "browser", "final"]);
const INTEGER_FIELDS: AutoresearchColumn[] = [
  "accepted_correct",
  "accepted_incorrect",
  "eligible_comparable",
  "abstention_true_positive",
  "abstention_false_negative",
  "pointer_exact",
  "pointer_total",
  "grammar_valid",
  "grammar_total",
  "evidence_accepted",
  "evidence_total",
  "native_accepted_correct",
  "native_eligible",
  "derived_accepted_correct",
  "derived_eligible",
  "domain_count"
];
const OPTIONAL_NUMBER_FIELDS: AutoresearchColumn[] = [
  "site_macro_coverage",
  "p50_latency_ms",
  "p95_latency_ms",
  "peak_memory_mb",
  "artifact_size_mb"
];

export function parseAutoresearchLedger(input: string): AutoresearchRow[] {
  const lines = input.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("experiment ledger is empty");
  const header = lines[0]!.split("\t");
  if (header.join("\t") !== AUTORESEARCH_COLUMNS.join("\t")) {
    throw new Error("experiment ledger header does not match the frozen schema");
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split("\t");
    if (values.length !== AUTORESEARCH_COLUMNS.length) {
      throw new Error(
        `ledger row ${index + 2} has ${values.length} columns; expected ${AUTORESEARCH_COLUMNS.length}`
      );
    }
    return Object.fromEntries(
      AUTORESEARCH_COLUMNS.map((column, columnIndex) => [column, values[columnIndex]!])
    ) as AutoresearchRow;
  });
}

export function validateAutoresearchPolicy(policy: AutoresearchPolicy): string[] {
  const errors: string[] = [];
  if (policy.version !== 1) errors.push("policy version must be 1");
  if (policy.budget.totalUsd <= 0) errors.push("total budget must be positive");
  if (policy.budget.estimatedSpentUsd < 0) errors.push("estimated spend cannot be negative");
  if (policy.budget.finalReserveUsd <= 0) errors.push("final reserve must be positive");
  if (policy.budget.maxPilotUsd <= 0) errors.push("pilot cost limit must be positive");
  if (policy.budget.maxPilotTrainingMinutes <= 0) {
    errors.push("pilot training-time limit must be positive");
  }
  if (
    policy.budget.estimatedSpentUsd + policy.budget.finalReserveUsd >
    policy.budget.totalUsd
  ) {
    errors.push("estimated spend plus final reserve exceeds total budget");
  }
  if (policy.experiments.maxAttemptsPerHypothesis < 1) {
    errors.push("hypothesis attempt limit must be at least one");
  }
  if (policy.experiments.formulationHypothesisLimit < 1) {
    errors.push("formulation hypothesis limit must be at least one");
  }
  if (policy.experiments.teacherRunLimit < 1) {
    errors.push("teacher run limit must be at least one");
  }
  if (policy.experiments.oracleRunLimit < 1) {
    errors.push("oracle run limit must be at least one");
  }
  if (policy.experiments.studentVariantLimit < 1) {
    errors.push("student variant limit must be at least one");
  }
  if (
    policy.experiments.minimumCoverageGain <= 0 ||
    policy.experiments.minimumCoverageGain > 1
  ) {
    errors.push("minimum coverage gain must be in (0, 1]");
  }
  for (const [name, value] of Object.entries({
    formulationGrammarValidity: policy.gates.formulation.grammarValidity,
    formulationEvidenceAcceptance: policy.gates.formulation.minimumEvidenceAcceptance,
    formulationAcceptedPrecision: policy.gates.formulation.acceptedPrecision,
    formulationEligibleCoverage: policy.gates.formulation.eligibleCoverage,
    formulationAbstentionRecall: policy.gates.formulation.abstentionRecall,
    teacherGrammarValidity: policy.gates.teacher.grammarValidity,
    teacherPointerExact: policy.gates.teacher.pointerExact,
    teacherAcceptedPrecision: policy.gates.teacher.acceptedPrecision,
    teacherEligibleCoverage: policy.gates.teacher.eligibleCoverage,
    teacherNativeCoverage: policy.gates.teacher.nativeCoverage,
    teacherDerivedCoverage: policy.gates.teacher.derivedCoverage,
    teacherAbstentionRecall: policy.gates.teacher.abstentionRecall,
    teacherSiteMacroCoverage: policy.gates.teacher.siteMacroCoverage,
    studentAcceptedPrecision: policy.gates.student.acceptedPrecision,
    studentAbstentionRecall: policy.gates.student.abstentionRecall,
    finalPrecisionLowerBound95: policy.gates.final.minimumPrecisionLowerBound95,
    finalEligibleCoverage: policy.gates.final.eligibleCoverage,
    finalNativeCoverage: policy.gates.final.nativeCoverage,
    finalDerivedCoverage: policy.gates.final.derivedCoverage,
    finalAbstentionRecall: policy.gates.final.abstentionRecall
  })) {
    if (value < 0 || value > 1) errors.push(`${name} must be in [0, 1]`);
  }
  return errors;
}

export function validateAutoresearchLedger(
  rows: readonly AutoresearchRow[],
  policy: AutoresearchPolicy
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const attempts = new Map<string, number>();
  const phaseSpend = new Map<string, number>();
  const phaseRuns = new Map<string, number>();
  const rowsById = new Map<string, AutoresearchRow>();
  let ledgerSpend = 0;

  for (const [index, row] of rows.entries()) {
    const label = `ledger row ${index + 2}`;
    if (ids.has(row.experiment_id)) errors.push(`${label}: duplicate experiment_id`);
    ids.add(row.experiment_id);
    rowsById.set(row.experiment_id, row);

    if (!row.experiment_id) errors.push(`${label}: experiment_id is required`);
    if (!row.hypothesis_id) errors.push(`${label}: hypothesis_id is required`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(row.changed_variable)) {
      errors.push(`${label}: changed_variable must name one kebab-case variable`);
    }
    if (!PHASES.has(row.phase)) errors.push(`${label}: unknown phase ${row.phase}`);
    if (!COMMIT.test(row.commit)) errors.push(`${label}: invalid commit`);
    if (!HASH.test(row.dataset_sha256)) errors.push(`${label}: invalid dataset_sha256`);
    if (!HASH.test(row.eval_sha256)) errors.push(`${label}: invalid eval_sha256`);
    if (!TERMINAL_STATUSES.has(row.status)) errors.push(`${label}: invalid status ${row.status}`);
    if (row.notes.includes("\t") || row.notes.includes("\n")) {
      errors.push(`${label}: notes must remain on one TSV line`);
    }

    const timestamp = Date.parse(row.timestamp_utc);
    if (!Number.isFinite(timestamp)) errors.push(`${label}: invalid timestamp_utc`);

    for (const field of INTEGER_FIELDS) {
      if (!isNonNegativeInteger(row[field])) {
        errors.push(`${label}: ${field} must be a non-negative integer`);
      }
    }
    for (const field of OPTIONAL_NUMBER_FIELDS) {
      if (row[field] !== "" && !isNonNegativeNumber(row[field])) {
        errors.push(`${label}: ${field} must be blank or a non-negative number`);
      }
    }
    if (!isNonNegativeNumber(row.cost_usd)) {
      errors.push(`${label}: cost_usd must be a non-negative number`);
      continue;
    }

    const acceptedCorrect = Number(row.accepted_correct);
    const acceptedIncorrect = Number(row.accepted_incorrect);
    const eligibleComparable = Number(row.eligible_comparable);
    const pointerExact = Number(row.pointer_exact);
    const pointerTotal = Number(row.pointer_total);
    const grammarValid = Number(row.grammar_valid);
    const grammarTotal = Number(row.grammar_total);
    if (acceptedCorrect + acceptedIncorrect > eligibleComparable) {
      errors.push(`${label}: accepted outputs exceed eligible comparable products`);
    }
    if (pointerExact > pointerTotal) errors.push(`${label}: pointer_exact exceeds pointer_total`);
    if (grammarValid > grammarTotal) errors.push(`${label}: grammar_valid exceeds grammar_total`);
    if (row.status === "keep" && acceptedIncorrect !== 0) {
      errors.push(`${label}: a kept run has an accepted normalized-price error`);
    }
    if (row.status === "keep" && grammarValid !== grammarTotal) {
      errors.push(`${label}: a kept run does not have 100% grammar validity`);
    }

    const cost = Number(row.cost_usd);
    ledgerSpend += cost;
    phaseSpend.set(row.phase, (phaseSpend.get(row.phase) ?? 0) + cost);
    phaseRuns.set(row.phase, (phaseRuns.get(row.phase) ?? 0) + 1);
    if (row.phase !== "final" && cost > policy.budget.maxPilotUsd) {
      errors.push(`${label}: pilot cost exceeds $${policy.budget.maxPilotUsd.toFixed(2)}`);
    }

    attempts.set(row.hypothesis_id, (attempts.get(row.hypothesis_id) ?? 0) + 1);
  }

  for (const [index, row] of rows.entries()) {
    if (row.status !== "keep") continue;
    validateKeptRun(row, rowsById, policy, `ledger row ${index + 2}`, errors);
  }

  for (const [hypothesis, count] of attempts) {
    if (count > policy.experiments.maxAttemptsPerHypothesis) {
      errors.push(
        `hypothesis ${hypothesis} has ${count} attempts; maximum is ${policy.experiments.maxAttemptsPerHypothesis}`
      );
    }
  }
  const formulationHypotheses = new Set(
    rows.filter((row) => row.phase === "formulation").map((row) => row.hypothesis_id)
  );
  if (formulationHypotheses.size > policy.experiments.formulationHypothesisLimit) {
    errors.push(
      `formulation has ${formulationHypotheses.size} hypotheses; maximum is ${policy.experiments.formulationHypothesisLimit}`
    );
  }
  enforceRunLimit("teacher", policy.experiments.teacherRunLimit, phaseRuns, errors);
  enforceRunLimit("oracle", policy.experiments.oracleRunLimit, phaseRuns, errors);
  enforceRunLimit("student", policy.experiments.studentVariantLimit, phaseRuns, errors);
  for (const [phase, spend] of phaseSpend) {
    const cap = policy.budget.phaseCapsUsd[phase];
    if (cap === undefined) errors.push(`phase ${phase} has no configured budget cap`);
    else if (spend > cap) {
      errors.push(`phase ${phase} spend $${spend.toFixed(2)} exceeds $${cap.toFixed(2)} cap`);
    }
  }
  const projectedTotal = policy.budget.estimatedSpentUsd + ledgerSpend;
  if (projectedTotal > policy.budget.totalUsd) {
    errors.push(
      `projected total spend $${projectedTotal.toFixed(2)} exceeds $${policy.budget.totalUsd.toFixed(2)} budget`
    );
  }
  const nonFinalSpend = [...phaseSpend]
    .filter(([phase]) => phase !== "final")
    .reduce((sum, [, spend]) => sum + spend, 0);
  if (
    policy.budget.estimatedSpentUsd + nonFinalSpend + policy.budget.finalReserveUsd >
    policy.budget.totalUsd
  ) {
    errors.push("non-final experiments consume the protected final-evaluation reserve");
  }

  return errors;
}

function validateKeptRun(
  row: AutoresearchRow,
  rowsById: ReadonlyMap<string, AutoresearchRow>,
  policy: AutoresearchPolicy,
  label: string,
  errors: string[]
): void {
  const accepted = Number(row.accepted_correct) + Number(row.accepted_incorrect);
  const precision = ratio(Number(row.accepted_correct), accepted);
  const coverage = ratio(Number(row.accepted_correct), Number(row.eligible_comparable));
  const abstentionRecall = ratio(
    Number(row.abstention_true_positive),
    Number(row.abstention_true_positive) + Number(row.abstention_false_negative)
  );
  const pointerExact = ratio(Number(row.pointer_exact), Number(row.pointer_total));
  const grammarValidity = ratio(Number(row.grammar_valid), Number(row.grammar_total));
  const evidenceAcceptance = ratio(
    Number(row.evidence_accepted),
    Number(row.evidence_total)
  );
  const nativeCoverage = ratio(
    Number(row.native_accepted_correct),
    Number(row.native_eligible)
  );
  const derivedCoverage = ratio(
    Number(row.derived_accepted_correct),
    Number(row.derived_eligible)
  );

  if (row.phase === "formulation") {
    const gate = policy.gates.formulation;
    requireMinimum(label, "grammar validity", grammarValidity, gate.grammarValidity, errors);
    requireMinimum(
      label,
      "evidence acceptance",
      evidenceAcceptance,
      gate.minimumEvidenceAcceptance,
      errors
    );
    requireMinimum(label, "accepted precision", precision, gate.acceptedPrecision, errors);
    requireMinimum(label, "eligible coverage", coverage, gate.eligibleCoverage, errors);
    requireMinimum(label, "abstention recall", abstentionRecall, gate.abstentionRecall, errors);
    return;
  }

  if (row.phase === "teacher") {
    const gate = policy.gates.teacher;
    requireMinimum(label, "grammar validity", grammarValidity, gate.grammarValidity, errors);
    requireMinimum(label, "pointer exact", pointerExact, gate.pointerExact, errors);
    requireMinimum(label, "accepted precision", precision, gate.acceptedPrecision, errors);
    requireMinimum(label, "eligible coverage", coverage, gate.eligibleCoverage, errors);
    requireMinimum(label, "native coverage", nativeCoverage, gate.nativeCoverage, errors);
    requireMinimum(label, "derived coverage", derivedCoverage, gate.derivedCoverage, errors);
    requireMinimum(label, "abstention recall", abstentionRecall, gate.abstentionRecall, errors);
    requireMinimum(
      label,
      "site-macro coverage",
      optionalNumber(row.site_macro_coverage),
      gate.siteMacroCoverage,
      errors
    );
    return;
  }

  if (row.phase === "oracle") {
    const gate = policy.gates.oracle;
    if (Number(row.pointer_total) > gate.maximumCases) {
      errors.push(`${label}: oracle cases exceed ${gate.maximumCases}`);
    }
    const parent = rowsById.get(row.parent_id);
    if (!parent) {
      errors.push(`${label}: kept oracle run has no ledger parent`);
      return;
    }
    const parentPointerExact = ratio(
      Number(parent.pointer_exact),
      Number(parent.pointer_total)
    );
    requireMinimum(
      label,
      "oracle pointer-exact gain",
      pointerExact - parentPointerExact,
      gate.minimumPointerExactGain,
      errors
    );
    return;
  }

  if (row.phase === "student") {
    const gate = policy.gates.student;
    const parent = rowsById.get(row.parent_id);
    if (!parent) {
      errors.push(`${label}: kept student run has no ledger teacher parent`);
      return;
    }
    const parentCoverage = ratio(
      Number(parent.accepted_correct),
      Number(parent.eligible_comparable)
    );
    const parentPointerExact = ratio(
      Number(parent.pointer_exact),
      Number(parent.pointer_total)
    );
    requireMinimum(label, "accepted precision", precision, gate.acceptedPrecision, errors);
    requireMinimum(
      label,
      "eligible coverage",
      coverage,
      parentCoverage - gate.maximumCoverageRegression,
      errors
    );
    requireMinimum(
      label,
      "pointer exact",
      pointerExact,
      parentPointerExact - gate.maximumPointerExactRegression,
      errors
    );
    requireMinimum(label, "abstention recall", abstentionRecall, gate.abstentionRecall, errors);
    return;
  }

  if (row.phase === "browser") {
    const gate = policy.gates.browser;
    requireMaximum(
      label,
      "artifact size",
      optionalNumber(row.artifact_size_mb),
      gate.maximumArtifactSizeMb,
      errors
    );
    requireMaximum(
      label,
      "p50 latency",
      optionalNumber(row.p50_latency_ms),
      gate.maximumP50LatencyMs,
      errors
    );
    requireMaximum(
      label,
      "p95 latency",
      optionalNumber(row.p95_latency_ms),
      gate.maximumP95LatencyMs,
      errors
    );
    requireMaximum(
      label,
      "peak memory",
      optionalNumber(row.peak_memory_mb),
      gate.maximumPeakMemoryMb,
      errors
    );
    return;
  }

  const gate = policy.gates.final;
  if (Number(row.domain_count) < gate.minimumDomains) {
    errors.push(`${label}: final domain count is below ${gate.minimumDomains}`);
  }
  if (accepted < gate.minimumAcceptedOutputs) {
    errors.push(`${label}: final accepted outputs are below ${gate.minimumAcceptedOutputs}`);
  }
  if (Number(row.accepted_incorrect) > gate.maximumAcceptedErrors) {
    errors.push(`${label}: final accepted errors exceed ${gate.maximumAcceptedErrors}`);
  }
  const lowerBound = accepted > 0 && Number(row.accepted_incorrect) === 0
    ? Math.pow(0.05, 1 / accepted)
    : 0;
  requireMinimum(
    label,
    "precision lower bound 95",
    lowerBound,
    gate.minimumPrecisionLowerBound95,
    errors
  );
  requireMinimum(label, "eligible coverage", coverage, gate.eligibleCoverage, errors);
  requireMinimum(label, "native coverage", nativeCoverage, gate.nativeCoverage, errors);
  requireMinimum(label, "derived coverage", derivedCoverage, gate.derivedCoverage, errors);
  requireMinimum(label, "abstention recall", abstentionRecall, gate.abstentionRecall, errors);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function optionalNumber(value: string): number {
  return value === "" ? Number.NaN : Number(value);
}

function enforceRunLimit(
  phase: string,
  limit: number,
  phaseRuns: ReadonlyMap<string, number>,
  errors: string[]
): void {
  const count = phaseRuns.get(phase) ?? 0;
  if (count > limit) errors.push(`${phase} has ${count} runs; maximum is ${limit}`);
}

function requireMinimum(
  label: string,
  metric: string,
  actual: number,
  minimum: number,
  errors: string[]
): void {
  if (!Number.isFinite(actual) || actual < minimum) {
    errors.push(`${label}: ${metric} ${formatMetric(actual)} is below ${minimum}`);
  }
}

function requireMaximum(
  label: string,
  metric: string,
  actual: number,
  maximum: number,
  errors: string[]
): void {
  if (!Number.isFinite(actual) || actual > maximum) {
    errors.push(`${label}: ${metric} ${formatMetric(actual)} exceeds ${maximum}`);
  }
}

function formatMetric(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "invalid";
}

function isNonNegativeInteger(value: string): boolean {
  return /^(0|[1-9]\d*)$/.test(value);
}

function isNonNegativeNumber(value: string): boolean {
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(value) && Number.isFinite(Number(value));
}
