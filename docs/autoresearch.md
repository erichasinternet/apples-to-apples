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

`synthetic-pilot-100-real-discovery-balanced` continued for 20 steps with 50%
silver real-DOM presentations and 50% synthetic replay. It regressed on mixed
internal exactness (81.25% to 62.5%) but improved both untouched live cohorts:

- Development validation: 70.0% weak precision, 87.5% recall, 77.8% F1.
- Selection FreshDirect: 100% weak precision, 41.7% recall, 58.8% F1.
- JSON completion remained 100% on both cohorts.

The balanced checkpoint, prompt format, 96-node discovery pruning policy, and
192-token deterministic generation settings are now frozen. No training or model
selection may occur after opening held-out domains. This checkpoint is still
discovery-only and is approved only for preannotation.

The frozen checkpoint failed the sealed held-out gate. Of 20 previously unseen
domains, seven produced usable captures, six were blocked, and seven failed page
acquisition. The seven captured domains produced 13 discovery chunks. JSON
completion was 100%, but the weak-reference metrics were 16.7% precision, 33.3%
recall, and 22.2% F1. Only two chunks contained generic collector references, so
these numbers are directional rather than statistically conclusive. Four duplicate
IDs and two IDs absent from the page observation were also generated. The checkpoint is
rejected for production and remains usable only to seed a human review queue.

The replay extraction checkpoint was then tested on 37 deduplicated live card
proposals. Evidence validation accepted zero: nine generations were unparseable and
all 28 parseable generations were rejected. Dominant failures were ungrounded
numbers, invalid units or dimensions, and evidence outside the proposed card.
Therefore no live extraction output is eligible for display, benchmark scoring, or
training without human annotation.

## Cost

The last observed Modal meter was $1.5247. Subsequent runs used about $1.06 of
compute at published per-second GPU, CPU, and memory rates, for an estimated
total near $2.58. This remains well below the $30 cap. Estimates exclude negligible
image-build overhead and should be reconciled with the Modal billing meter.

## Next Gate

Do not launch full training or a larger model. Required work:

1. Annotate complete main regions with field-level evidence.
2. Obtain two independent reviews and adjudicate disagreements.
3. Add at least 30 development domains and 10 selection domains with real gold
   product roots before another training run.
4. Fine-tune extraction on adjudicated real examples with synthetic replay.
5. Evaluate exact normalization and abstention on a new untouched, adjudicated
   domain split. The opened held-out split cannot be reused for model selection.
6. Compare against ungated FLAN-T5 Base and MarkupLM baselines.

T5Gemma 2 1B-1B is the only additional gated model worth approving now. Use it only
if the 270M model underfits the adjudicated real corpus. PaliGemma remains deferred because
T5Gemma 2 already accepts image and text input, and a 3B vision model would increase
cost before a measured need exists.

The complete frozen-run analysis is in
[`held-out-report.md`](./held-out-report.md).
