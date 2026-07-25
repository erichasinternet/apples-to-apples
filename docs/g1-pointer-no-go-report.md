# G1 Evidence-Pointer No-Go Report

## Decision

The first evidence-pointer formulation series is stopped. It did not pass G1,
and the two-hypothesis limit is exhausted. Do not run longer training, a larger
model, teacher training, distillation, or browser integration from these
checkpoints.

The best retained adapter is
`t5gemma2-1b-evidence-pointer-g1-domain-balanced-pilot-20`. It is a diagnostic
artifact only and is not eligible for product use.

## Reproducible Inputs

- Model: `google/t5gemma-2-1b-1b`
- Synthetic dataset:
  `b7538f171b0d222d21c6219f73a165ffd784295e3fd50635cd88c83ff0c9b0bf`
- Domain-balanced training selection:
  `fce819aa0ddbbe9709b6f5f501c3e5fc20f5041b8286a066508611500d56f2c0`
- Synthetic held-out selection:
  `e63a77209112ae123c6cb0860c3bd7098b3198d5049be22185695fe2e43b4442`
- Original live-silver cohort:
  `588d55673e5ff23feffe217d4f809b0e102d8918a5740f7cc33e882592b3c766`
- Compact live-silver cohort:
  `75ee93572c326ce80c03e0f1b7726ebdf13c3e41527b1623b44388c861456073`

The live cohort is diagnostic only: 16 audited-silver records from Amazon,
PetSmart, and Publix. It is not dual-reviewed adjudicated gold and therefore
cannot pass G1 even if its measured thresholds are met.

## Results

| Metric | G1 gate | Original live | Compact live |
| --- | ---: | ---: | ---: |
| Grammar validity | 100% | 18.75% | 18.75% |
| Evidence acceptance | at least 63.75% | 18.75% | 18.75% |
| Accepted precision | 100% | no accepted outputs | no accepted outputs |
| Eligible comparable coverage | at least 50% | 0/3 | 0/3 |
| Abstention recall | at least 90% | 13/13 | 13/13 |
| Pointer exact | diagnostic | 0% | 0% |

The domain-held-out synthetic result was stronger but still insufficient:
68.75% grammar validity, 31.25% exact pointers, and 63.39% field accuracy over
32 records from 32 unseen synthetic domains.

## Failure Analysis

The initial balanced selector was invalid because it selected all validation
records from one domain. That run and its attached-client cancellation are
recorded as `g1-pointer-p00-invalid`.

The corrected pilot covered all 160 training domains and 32 unseen validation
domains. On every grammar-valid synthetic generation, all six fields before
`STATUS` were correct. The dominant failures were an invalid copied prompt
phrase after `STATUS` and incorrect status classes.

Live prompts were substantially larger than synthetic prompts. Capping card
observations at 32 nodes reduced the maximum live prompt from 24,374 to 11,018
characters and stopped Amazon DOM-copy generations. It did not improve any
gated live metric.

A post-hoc status-prefix oracle demonstrated why grammar constraints alone are
unsafe. It produced 100% grammar and precision on the synthetic slice, but only
25% accepted precision on live data: one correct and three incorrect accepted
products. The audit is recorded in
`benchmarks/experiments/g1-status-prefix-oracle.json`.

Primary failure class: `data-contract` for the missing adjudicated live
supervision, followed by `objective` for status generation. Capacity is not
established, so the 4B oracle is not authorized.

## Dataset Blocker

The current readiness audit reports:

| Cohort | Live domains | Labeled products | Target products | Dual reviewed | Pointer ready |
| --- | ---: | ---: | ---: | ---: | ---: |
| Training | 24 | 24 | 8,000 | 0% | 0% |
| Validation | 6 | 0 | 2,000 | 0% | 0% |
| Selection | 9 | 0 | 2,000 | 0% | 0% |
| Final | 0 | 0 | 5,500 | 0% | 0% |

The synthetic corpus is valid and useful for grammar warm-starting, but it
cannot satisfy these live-data requirements.

## Budget

- Estimated prior spend before this series: `$8.0000`
- Recorded formulation-series spend: `$0.6279`
- Projected total spend: `$8.6279`
- Remaining total budget: `$21.3721`
- Protected final reserve: `$5.0000`

## Restart Condition

Start a new named formulation series only after a representative,
domain-disjoint live development cohort is pointer-ready and dual-reviewed.
The next workstream is capture, privacy filtering, independent review,
adjudication, and dataset-quality auditing. Freeze new dataset and evaluation
hashes before any additional paid model run.
