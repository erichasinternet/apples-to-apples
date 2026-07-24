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
The controlled comparison queue is in
[`model-candidates.md`](./model-candidates.md).

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

A complete first visual/DOM review found 51 product-card roots across the seven
captures. After the existing runtime gate removed duplicate and nonexistent IDs,
the frozen checkpoint reached 47.0% precision, 60.8% recall, and 53.0% F1. These
single-review metrics are more representative than the sparse weak references, but
they remain ineligible for training or final benchmark claims until independently
reviewed and adjudicated.

The replay extraction checkpoint was then tested on 37 deduplicated live card
proposals. Evidence validation accepted zero: nine generations were unparseable and
all 28 parseable generations were rejected. Dominant failures were ungrounded
numbers, invalid units or dimensions, and evidence outside the proposed card.
Therefore no live extraction output is eligible for display, benchmark scoring, or
training without human annotation.

## Adjudicated Development Cycle

The opened held-out cohort remains retired and was not reused for model selection.
A new cycle adjudicated 36 exact product roots across Amazon, PetSmart, and Publix.
The independent Qwen3-VL review was useful for visual counts but unreliable for
exact DOM mapping, so these labels are training-only rather than benchmark gold.
All three domains are permanently retired from validation.

The prior balanced checkpoint scored 62.5% precision, 83.3% recall, and 71.4% F1
against the exact development roots. A strict dataset combined nine adjudicated
real-DOM chunks with synthetic discovery replay. The
`synthetic-pilot-120-adjudicated-discovery` adapter continued for 20 steps with a
50/50 repeated real/synthetic mix and a lower `5e-5` learning rate.

The candidate memorized the small real set, reaching 100% exact-root F1 on all 36
training roots. The frozen selection pair contained a 30-card FreshDirect page and
a non-shopping Rite Aid redirect:

| Metric | Prior balanced | Adjudicated candidate |
| --- | ---: | ---: |
| Exact-root precision | 42.9% | 60.7% |
| Exact-root recall | 50.0% | 56.7% |
| Exact-root F1 | 46.2% | 58.6% |
| FreshDirect true roots | 15 / 30 | 17 / 30 |
| Rite Aid false roots | 20 | 11 |

This is a measured improvement, but eleven false roots on a non-shopping page fail
the abstention gate. The adapter is retained as the best research discovery
checkpoint and rejected for production.

Extraction remained unusable. The prior checkpoint produced 35 selection proposals
and the candidate produced 28; neither had a single evidence-accepted result.
Candidate failures were 12 parse failures, 11 schema failures, and five evidence
rejections. Consequently normalized-pricing coverage is 0%, and no accuracy claim
can be made. The extension must continue to use retailer-native unit prices and
deterministic conversion only.

## Cost

The last observed Modal meter was $1.5247. Through the expanded adjudicated cycle,
the current published Modal GPU, CPU, and memory rates put estimated total project
compute at $4.16. This remains well below the $30 cap. Estimates exclude negligible
image-build overhead and should be reconciled with the Modal billing meter.

## Expanded Data Cycle

Ten additional development domains added 124 exact roots and one challenge-page
negative. A 20-step continuation improved consumed-development F1 from 63.8% to
75.4%, but regressed on a newly captured sealed Instacart page from 73.5% to 70.6%
F1 by adding two false roots with no recall gain. The branch is rejected and
`synthetic-pilot-120-adjudicated-discovery` remains the best research checkpoint.

The strict combined discovery dataset now has 47 real chunks, 160 exact roots, 335
training records, and SHA-256
`22ea3792a05883c35d51923e5843ac3bb38807e017ec7e013bdcb2bb2211acc0`.
The extraction annotation queue covers all 160 cards but remains pending and
ineligible for training.

Details are in
[`expanded-adjudicated-cycle-report.md`](./expanded-adjudicated-cycle-report.md).

## Next Gate

Do not launch full training or a larger model. Required work:

1. Add at least 17 more adjudicated development domains and independently reviewed
   selection pages before another T5Gemma training run.
2. Include non-shopping redirects, category grids, recommendations, and skeleton
   states as explicit discovery abstention examples.
3. Annotate card-local title, current price, native unit price, package quantity,
   multipack, and abstention evidence rather than training extraction from model
   outputs.
4. Fine-tune extraction on adjudicated real examples with synthetic replay.
5. Evaluate discovery, extraction, normalization, and abstention on a new sealed
   domain split. All currently opened development, selection, and held-out pages
   are retired from final evaluation.
6. Compare the same immutable corpus against Pix2Struct Base, MarkupLM Base, and
   FLAN-T5 Base before approving T5Gemma 2 1B-1B.

T5Gemma 2 1B-1B is the only larger same-family model worth approving now. Use it
only if the 270M model underfits the adjudicated real corpus. PaliGemma remains
deferred because T5Gemma 2 already accepts image and text input, and a 3B vision
model would increase cost before a measured need exists. The architecture baseline
policy is in [`model-candidates.md`](./model-candidates.md).

The complete frozen-run analysis is in
[`held-out-report.md`](./held-out-report.md).
