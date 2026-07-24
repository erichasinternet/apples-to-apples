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

## Current Results

`synthetic-pilot-60-replay` is the synthetic candidate:

- 96.9% strict JSON and 100% recoverable JSON.
- 87.5% discovery first-object exactness.
- 50% extraction first-object exactness.
- 77.1% extraction field accuracy.
- 50% abstention accuracy.

The extraction-only branch reached higher extraction scores but erased discovery,
demonstrating that discovery replay is required.

`synthetic-pilot-80-real-discovery` is a discovery-only preannotation candidate.
It continued from replay for 20 steps on synthetic discovery plus generic card
candidates from five real development domains. Two other real development domains
were reserved for internal validation. Amazon, PetSmart, and Publix were untouched.

On the fixed nine-chunk live validation bundle:

- JSON completion improved from 66.7% to 100%.
- Weak-label card-root precision improved from 20.5% to 56.0%.
- Weak-label card-root recall improved from 33.3% to 58.3%.
- Weak-label F1 improved from 25.4% to 57.1%.

These are diagnostics against generic collector candidates, not adjudicated gold
labels. The checkpoint is promoted only for discovery preannotations.

The replay extraction checkpoint was then tested on 37 deduplicated live card
proposals. Evidence validation accepted zero: nine generations were unparseable and
all 28 parseable generations were rejected. Dominant failures were ungrounded
numbers, invalid units or dimensions, and evidence outside the proposed card.
Therefore no live extraction output is eligible for display, benchmark scoring, or
training without human annotation.

## Cost

The last observed Modal meter was $1.5247. Runs added in this iteration used about
$0.574 of compute at published per-second GPU, CPU, and memory rates, for an estimated
total near $2.10. This remains well below the $30 cap. Estimates exclude negligible
image-build overhead and should be reconciled with the Modal billing meter.

## Next Gate

Do not launch full training or a larger model. Required work:

1. Capture selection and sealed held-out domains without changing prompts or site rules.
2. Use the discovery candidate to create an explicit preannotation queue.
3. Annotate complete main regions with field-level evidence.
4. Obtain two independent reviews and adjudicate disagreements.
5. Fine-tune extraction on adjudicated real examples with synthetic replay.
6. Evaluate exact normalization and abstention on untouched, adjudicated domains.
7. Compare against ungated FLAN-T5 Base and MarkupLM baselines.

T5Gemma 2 1B-1B is the only additional gated model worth approving now. Use it only
if the 270M model underfits the adjudicated real corpus. PaliGemma remains deferred because
T5Gemma 2 already accepts image and text input, and a 3B vision model would increase
cost before a measured need exists.
