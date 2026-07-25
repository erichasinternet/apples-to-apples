import {
  AUTORESEARCH_COLUMNS,
  parseAutoresearchLedger,
  validateAutoresearchLedger,
  validateAutoresearchPolicy,
  type AutoresearchPolicy,
  type AutoresearchRow
} from "../../scripts/autoresearch-lib";

const policy: AutoresearchPolicy = {
  version: 1,
  budget: {
    totalUsd: 30,
    estimatedSpentUsd: 8,
    finalReserveUsd: 5,
    maxPilotUsd: 0.75,
    maxPilotTrainingMinutes: 15,
    phaseCapsUsd: {
      formulation: 3,
      teacher: 5,
      oracle: 2,
      student: 5,
      browser: 2,
      final: 5
    }
  },
  experiments: {
    maxAttemptsPerHypothesis: 2,
    formulationHypothesisLimit: 2,
    minimumCoverageGain: 0.02,
    oneVariablePerRun: true,
    teacherRunLimit: 3,
    oracleRunLimit: 2,
    studentVariantLimit: 2
  },
  gates: {
    formulation: {
      grammarValidity: 1,
      minimumEvidenceAcceptance: 0.6375,
      acceptedPrecision: 1,
      eligibleCoverage: 0.5,
      abstentionRecall: 0.9
    },
    teacher: {
      grammarValidity: 1,
      pointerExact: 0.98,
      acceptedPrecision: 1,
      eligibleCoverage: 0.8,
      nativeCoverage: 0.95,
      derivedCoverage: 0.75,
      abstentionRecall: 0.99,
      siteMacroCoverage: 0.7
    },
    oracle: {
      maximumCases: 500,
      minimumPointerExactGain: 0.05
    },
    student: {
      acceptedPrecision: 1,
      maximumCoverageRegression: 0.05,
      maximumPointerExactRegression: 0.03,
      abstentionRecall: 0.99
    },
    browser: {
      maximumArtifactSizeMb: 300,
      maximumP50LatencyMs: 2000,
      maximumP95LatencyMs: 6000,
      maximumPeakMemoryMb: 1536
    },
    final: {
      minimumDomains: 30,
      minimumAcceptedOutputs: 3000,
      maximumAcceptedErrors: 0,
      minimumPrecisionLowerBound95: 0.999,
      eligibleCoverage: 0.8,
      nativeCoverage: 0.95,
      derivedCoverage: 0.75,
      abstentionRecall: 0.99
    }
  }
};

describe("autoresearch safeguards", () => {
  it("parses the frozen TSV schema", () => {
    const row = makeRow();
    const input = [
      AUTORESEARCH_COLUMNS.join("\t"),
      AUTORESEARCH_COLUMNS.map((column) => row[column]).join("\t")
    ].join("\n");

    expect(parseAutoresearchLedger(input)).toEqual([row]);
  });

  it("rejects a kept run with an accepted pricing error", () => {
    const errors = validateAutoresearchLedger(
      [makeRow({ accepted_incorrect: "1", status: "keep" })],
      policy
    );

    expect(errors).toContain(
      "ledger row 2: a kept run has an accepted normalized-price error"
    );
  });

  it("rejects a kept formulation run below its evidence-acceptance gate", () => {
    const errors = validateAutoresearchLedger(
      [makeRow({ evidence_accepted: "6", evidence_total: "10" })],
      policy
    );

    expect(errors).toContain(
      "ledger row 2: evidence acceptance 0.6000 is below 0.6375"
    );
  });

  it("requires 3,000 error-free accepted outputs for the final gate", () => {
    const errors = validateAutoresearchLedger(
      [
        makeRow({
          phase: "final",
          domain_count: "30",
          accepted_correct: "2999",
          eligible_comparable: "3500",
          abstention_true_positive: "990",
          abstention_false_negative: "10",
          native_accepted_correct: "950",
          native_eligible: "1000",
          derived_accepted_correct: "750",
          derived_eligible: "1000"
        })
      ],
      policy
    );

    expect(errors).toContain("ledger row 2: final accepted outputs are below 3000");
  });

  it("rejects a kept browser row with missing runtime measurements", () => {
    const errors = validateAutoresearchLedger(
      [
        makeRow({
          phase: "browser",
          p50_latency_ms: "",
          p95_latency_ms: "",
          peak_memory_mb: "",
          artifact_size_mb: ""
        })
      ],
      policy
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("artifact size invalid"),
        expect.stringContaining("p50 latency invalid"),
        expect.stringContaining("p95 latency invalid"),
        expect.stringContaining("peak memory invalid")
      ])
    );
  });

  it("enforces the teacher run ceiling", () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      makeRow({
        experiment_id: `teacher-${index}`,
        hypothesis_id: `teacher-hypothesis-${index}`,
        phase: "teacher",
        status: "discard"
      })
    );

    expect(validateAutoresearchLedger(rows, policy)).toContain(
      "teacher has 4 runs; maximum is 3"
    );
  });

  it("protects the final evaluation reserve", () => {
    const rows = Array.from({ length: 2 }, (_, index) =>
      makeRow({
        experiment_id: `teacher-${index}`,
        hypothesis_id: `hypothesis-${index}`,
        cost_usd: "9",
        phase: "teacher",
        status: "discard"
      })
    );
    const errors = validateAutoresearchLedger(rows, {
      ...policy,
      budget: {
        ...policy.budget,
        maxPilotUsd: 10,
        phaseCapsUsd: { ...policy.budget.phaseCapsUsd, teacher: 20 }
      }
    });

    expect(errors).toContain(
      "non-final experiments consume the protected final-evaluation reserve"
    );
  });

  it("validates the checked-in policy", () => {
    expect(validateAutoresearchPolicy(policy)).toEqual([]);
  });
});

function makeRow(overrides: Partial<AutoresearchRow> = {}): AutoresearchRow {
  return {
    timestamp_utc: "2026-07-24T12:00:00Z",
    experiment_id: "pointer-baseline",
    parent_id: "",
    commit: "2483de2",
    hypothesis_id: "pointer-contract",
    changed_variable: "target-format",
    phase: "formulation",
    model: "google/t5gemma-2-1b-1b",
    dataset_sha256: "a".repeat(64),
    eval_sha256: "b".repeat(64),
    accepted_correct: "8",
    accepted_incorrect: "0",
    eligible_comparable: "10",
    abstention_true_positive: "18",
    abstention_false_negative: "1",
    pointer_exact: "27",
    pointer_total: "30",
    grammar_valid: "30",
    grammar_total: "30",
    evidence_accepted: "27",
    evidence_total: "30",
    native_accepted_correct: "19",
    native_eligible: "20",
    derived_accepted_correct: "8",
    derived_eligible: "10",
    site_macro_coverage: "0.8",
    domain_count: "10",
    p50_latency_ms: "500",
    p95_latency_ms: "900",
    peak_memory_mb: "800",
    artifact_size_mb: "250",
    cost_usd: "0.5",
    status: "keep",
    decision: "baseline",
    notes: "test row",
    ...overrides
  };
}
