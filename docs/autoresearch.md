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

The last observed Modal meter was $1.5247. Through the architecture baseline
cycle, the recorded Modal GPU, CPU, and memory rates put estimated total project
compute at $5.21. This remains well below the $30 cap. Estimates exclude
negligible image-build overhead and should be reconciled with the Modal billing
meter.

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

## Remaining Development and Text Control

Fourteen additional development domains added 30 exact roots and eleven explicit
negative pages. The parent checkpoint reached 52.3% precision, 76.7% recall, and
62.2% F1, with no false roots on the negative pages. Office Depot exposed a
specific nested-node failure: 16 false positives from selecting inner product
elements instead of repeated outer cards.

The strict dataset now has 73 adjudicated real discovery chunks, 190 exact roots,
361 training records, and SHA-256
`a4244fe987b6c66d4c5fe75a5a35272ecf2b84a6cc0f90102c1fc9c0c45f1fda`.
The extraction annotation queue now covers 190 cards and remains ineligible for
training.

A 20-step `google/flan-t5-base` serialized-DOM control reached evaluation loss
1.2715 but produced zero valid JSON outputs on 32 internal records. All three
sealed Instacart predictions were malformed, giving zero recall against 28 roots.
The bounded FLAN configuration is rejected with no additional budget.

Details are in
[`remaining-development-and-flan-cycle-report.md`](./remaining-development-and-flan-cycle-report.md).

## Architecture Baseline Cycle

Pix2Struct Base failed both JSON and compact coordinate serialization after
bounded 20-, 40-, and 100-step experiments. Its generated product titles could be
grounded conservatively to 2/28 Instacart roots, so it is rejected for discovery
but retained as a possible title-evidence teacher.

MarkupLM Base reached 0.907 internal node F1 after 40 steps. The first Instacart
run exposed an input-contract defect: the 96-node generative prompt omitted five
reviewed roots and yielded only 0.222 F1. Direct full-DOM inference restored 100%
candidate recall and reached 0.814 F1 before selection-specific decoding changes.
A descendant-evidence gate and repeated-sibling constrained decoder then produced
all 28 reviewed roots with no extras.

The 1.000 result is diagnostic, not a sealed generalization score, because the
Instacart errors informed the decoder. That page is retired. MarkupLM advances only
to a new sealed multi-domain discovery evaluation.

The same cycle corrected a visual-box coordinate-frame bug and regenerated all
saved Qwen mappings. Qwen remains reviewer-only. Details are in
[`architecture-baseline-cycle-report.md`](./architecture-baseline-cycle-report.md).

## Audited Extraction Cycle

An audited extraction corpus now contains 1,680 synthetic and 185 live records.
Every target is validated against the exact evidence-pruned prompt. The first
training run was invalidated after a prompt audit found that text-bearing
descendants of required evidence containers could be pruned; complete evidence
subtrees are now pinned and covered by regression tests.

T5Gemma 2 1B with an explicit output contract reached 68.8% live field accuracy
and 43.8% live evidence acceptance, but 0% live normalized-pricing coverage on the
frozen pilot cohort. Qwen3-VL 2B zero shot reached 29.2% live field accuracy, 0%
evidence acceptance, and 0% normalized coverage. Both are rejected for production.
The full results and cost ledger are in
[`audited-extraction-cycle-report.md`](./audited-extraction-cycle-report.md).

## Next Gate

Do not launch full training or a larger model. Required work:

1. Capture and independently review a new multi-domain selection cohort for the
   frozen MarkupLM checkpoint and structural decoder. Do not change decoding after
   opening its labels.
2. Include non-shopping redirects, category grids, recommendations, and skeleton
   states as explicit discovery abstention examples.
3. Annotate card-local title, current price, native unit price, package quantity,
   multipack, and abstention evidence rather than training extraction from model
   outputs.
4. Fine-tune extraction on adjudicated real examples with synthetic replay.
5. Evaluate discovery, extraction, normalization, and abstention on a new sealed
   domain split. All currently opened development, selection, and held-out pages
   are retired from final evaluation.
6. Report candidate recall, root-classification F1, and post-decoder F1 separately.
   Pix2Struct and FLAN-T5 are rejected discovery baselines; MarkupLM is the selected
   discovery architecture pending new sealed-domain validation.

T5Gemma 2 1B-1B is the only larger same-family model worth approving now. Use it
only if the 270M model underfits the adjudicated real corpus. PaliGemma remains
deferred because T5Gemma 2 already accepts image and text input, and a 3B vision
model would increase cost before a measured need exists. The architecture baseline
policy is in [`model-candidates.md`](./model-candidates.md).

The complete frozen-run analysis is in
[`held-out-report.md`](./held-out-report.md).
