# Adjudicated Development Cycle

## Hypothesis

Exact product-root supervision on real DOM observations should reduce nested-node
and non-product false positives relative to weak generic-collector labels. The
experiment changes only the discovery data source and learning rate while retaining
the 270M model, prompt, pruning policy, output limit, and synthetic replay.

## Data

Three development domains contain 36 exact roots:

| Domain | Roots | Review evidence |
| --- | ---: | --- |
| Amazon | 12 | Screenshot, listitem hierarchy, card-local descendants |
| PetSmart | 12 | Screenshot, direct product-grid children, card-local descendants |
| Publix | 12 | Screenshot, repeated grid geometry, card-local descendants |

Reviewer A selected exact DOM roots. Qwen3-VL 2B independently saw screenshot crops
only. It helped confirm visual grids but selected PetSmart category tiles and could
not map approximate rectangles to exact DOM roots reliably. The reconciled labels
are eligible for exploratory training, not benchmark gold, and the three domains
are retired from validation.

The generated dataset has SHA-256
`6a330ba358e354202fe43c36f5b5bbdedad39ad01438f6a499635fd4541e2fc7`.
It contains 297 training and 72 validation records across 43 domains. Nine real
records are repeated to form 50% of a bounded 320-presentation training run; the
other half is synthetic discovery replay.

## Training

| Setting | Value |
| --- | --- |
| Parent | `synthetic-pilot-100-real-discovery-balanced` |
| Candidate | `synthetic-pilot-120-adjudicated-discovery` |
| Steps | 20 |
| Learning rate | `5e-5` |
| Maximum input/output | 8,192 / 192 tokens |
| Training GPU | A10 |
| Elapsed | 1,009.37 seconds |
| Estimated all-resource cost | $0.40 |

Internal synthetic discovery prefix accuracy was 90.6%. This metric is a runtime
sanity check, not the promotion criterion.

## Discovery Results

The training domains moved from 71.4% to 100% exact-root F1. On the frozen
FreshDirect/Rite Aid selection pair:

| Metric | Parent | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Precision | 42.9% | 60.7% | +17.9 pp |
| Recall | 50.0% | 56.7% | +6.7 pp |
| F1 | 46.2% | 58.6% | +12.5 pp |
| True positives | 15 | 17 | +2 |
| False positives | 20 | 11 | -9 |
| False negatives | 15 | 13 | -2 |

All 17 candidate true positives are FreshDirect product roots. All 11 false
positives are from a Rite Aid blood-test marketing redirect that contains no retail
product grid. Exact fit on three training domains plus modest selection improvement
is evidence of memorization and partial transfer, not site-agnostic reliability.

## Extraction Results

| Metric | Parent | Candidate |
| --- | ---: | ---: |
| Proposals | 35 | 28 |
| Parse failures | 14 | 12 |
| Schema failures | 14 | 11 |
| Evidence accepted | 0 | 0 |
| Abstained | 1 | 0 |
| Evidence rejected | 6 | 5 |
| Normalized-pricing coverage | 0% | 0% |

No output passed the deterministic evidence gate. Frequent errors include decimal
values emitted where integer cents are required, invalid currency/dimension enums,
evidence outside the card root, and malformed repeated closing tokens. No model
output is eligible for shopper display or training reuse.

## Decision

Retain `synthetic-pilot-120-adjudicated-discovery` as the best research discovery
adapter. Reject it for production and do not use model extraction in the extension.
The next cost-effective experiment is data work: more independent real domains,
explicit non-shopping negatives, and field-level adjudicated extraction evidence.
A larger model is not justified by this result.
