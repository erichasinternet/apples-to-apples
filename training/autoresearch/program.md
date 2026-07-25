# Evidence-Pointer Autoresearch Program

This program adapts the operating pattern from
[`karpathy/autoresearch`](https://github.com/karpathy/autoresearch) to a
precision-gated information-extraction task.

Read these files before starting:

- `docs/evidence-pointer-autoresearch-goal.md`
- `training/autoresearch/gates.json`
- `docs/autoresearch.md`
- `docs/audited-extraction-cycle-report.md`
- `training/experiments/evidence-pointer-results.tsv`

## Immutable Surface

During a named experiment series, do not modify:

- Dataset, split, or evaluation manifests.
- Evidence-pointer grammar.
- Deterministic evidence parser, converter, or scorer.
- Gate thresholds or budget limits.
- Final sealed cohort.

If one of these is wrong, invalidate the series, explain why, assign new hashes,
and establish a new baseline before resuming.

## Mutable Surface

The only intended mutable training surface is the evidence-pointer experiment
configuration and its corresponding model code. Change exactly one independent
variable per run. Keep diffs small enough that the causal claim is reviewable.

Do not install packages during an experiment series. Use the locked Bun and Python
environments already in the repository.

## Setup

1. Verify the working tree and current branch.
2. Run `bun run training:autoresearch:validate`.
3. Reconcile estimated spend with the Modal billing meter.
4. Freeze and record dataset and evaluation SHA-256 hashes.
5. Run the unchanged baseline first.
6. Append every result to `training/experiments/evidence-pointer-results.tsv`.

## Experiment Loop

1. Read the ledger and the last accepted checkpoint.
2. State one hypothesis and one expected failure slice.
3. Confirm the hypothesis has attempts and budget remaining.
4. Commit the one-variable change.
5. Run the fixed pilot on Modal, redirecting verbose output to an artifact.
6. Run the fixed evaluator.
7. Append the result to the ledger.
8. Run `bun run training:autoresearch:validate`.
9. Keep, discard, crash, or invalidate the experiment.
10. Continue from the best valid checkpoint, not merely the latest checkpoint.

Each pilot is limited to 15 training minutes and $0.75. Kill an experiment that
exceeds the limit and record it as a crash unless metering or shutdown itself
failed, in which case record it as invalid.

## Selection Rule

Any accepted incorrect normalized price makes a run ineligible.

For safety-eligible runs, compare in this order:

1. Accepted comparable coverage.
2. Abstention recall.
3. Evidence-pointer exact match.
4. Site-macro coverage.
5. Lower p95 latency, memory, artifact size, and cost.
6. Simpler implementation.

Keep a run only when it improves accepted comparable coverage by at least two
percentage points without regressing a required gate, or preserves quality while
removing meaningful complexity.

Training loss, synthetic performance, or a visually plausible example cannot
override the selection rule.

## Failure Classification

Assign every failure one primary class:

- `data-contract`: required evidence is absent or labels do not match input.
- `representation`: the input or pointer target obscures available evidence.
- `objective`: loss or decoding does not optimize the gated behavior.
- `capacity`: a larger frozen-family oracle materially resolves the same cases.
- `optimization`: the formulation works but the run fails to converge.
- `runtime`: browser size, latency, memory, or compatibility failure.

Do not invoke `capacity` without the bounded 4B oracle result.

## Anti-Loop Rules

- Maximum two attempts per hypothesis.
- Maximum three teacher runs and two student variants.
- Do not reopen a discarded branch without new causal evidence.
- Do not tune against the final cohort.
- Do not start a paid run whose conservative estimate exceeds its phase cap.
- When a gate exhausts its attempts or budget, stop that path and write the
  bounded no-go report.

The loop is autonomous inside these limits. It is not indefinite.
