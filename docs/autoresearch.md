# Autoresearch Protocol

## Objective

Develop a site-agnostic shopping-page extractor that discovers product cards and
returns evidence-grounded price, unit price, quantity, multipack, and abstention
data. Optimize domain-held-out real-page performance, not synthetic validation
alone, while keeping total Modal spend below $30.

## Loop

1. State one measurable hypothesis and its expected failure slice.
2. Branch from a named immutable adapter instead of overwriting a checkpoint.
3. Hold the evaluation cohort, seed, target schema, and generation settings fixed.
4. Change one training variable: data mixture, model, objective, or optimizer.
5. Record strict JSON, recoverable JSON, task exactness, extraction field accuracy,
   abstention accuracy, latency, and metered cost.
6. Reject regressions and catastrophic forgetting even when aggregate loss improves.
7. Promote only after evaluation on adjudicated domains excluded from training.

The machine-readable experiment ledger is
[`training/experiments/results.json`](../training/experiments/results.json).

## Current Result

`synthetic-pilot-60-replay` is the synthetic candidate:

- 96.9% strict JSON and 100% recoverable JSON.
- 87.5% discovery first-object exactness.
- 50% extraction first-object exactness.
- 77.1% extraction field accuracy.
- 50% abstention accuracy.

The extraction-only branch reached higher extraction scores but erased discovery,
demonstrating that discovery replay is required.

## Next Gate

Do not launch full synthetic training yet. The live corpus currently has 47 captured
development pages but no training-eligible pages. Required work:

1. Replace blocked or incomplete captures.
2. Annotate complete main regions with evidence node IDs.
3. Obtain two independent reviews and adjudicate disagreements.
4. Export domain-separated real training and held-out evaluation datasets.
5. Evaluate the replay candidate on unseen real domains.
6. Compare against ungated FLAN-T5 Base and MarkupLM baselines.

T5Gemma 2 1B-1B is the only additional gated model worth approving now. Use it only
if the 270M model underfits the adjudicated real corpus. PaliGemma is deferred because
T5Gemma 2 already accepts image and text input, and a 3B vision model would increase
cost before a measured need exists.
