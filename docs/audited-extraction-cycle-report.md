# Audited Extraction Cycle

## Question

Can a small encoder-decoder or zero-shot vision-language model extract
evidence-grounded shopping facts from unfamiliar live DOM observations well enough
to support normalized unit-price comparison?

## Dataset

The extraction corpus contains 1,865 records:

- 1,680 synthetic records.
- 185 audited live records from 15 sites: 12 training sites and 3
  domain-held-out development sites.
- 1,493 training records and 372 validation records.
- Every live target validates against the exact serialized prompt presented to the
  model.

The final extraction dataset SHA-256 is
`4747bbc0caa47ddaae520ca337c5309a507e6ab98cdf701467ec89adc2519954`.

The frozen pilot cohort contains 32 records: 16 live records from Amazon,
PetSmart, and Publix and 16 records from eight unseen synthetic sites. It has 11
comparable targets and 21 abstention targets. Its SHA-256 is
`d5b33218ce5a2f17dce009d9fb36a1974d12b48cd43b5fdca49a8f450e0a20f7`.
These live labels are development evidence, not benchmark gold.

## Data Contract Correction

The first audited run was invalid. Required evidence container nodes were retained
in the prompt, but text-bearing descendants could still be pruned. This was most
visible on split-price markup where the currency symbol, whole dollars, and cents
are separate descendants.

The dataset builder now pins the complete subtree for every required evidence
node. It parses the serialized observation back from every generated prompt and
runs the same evidence validator used at runtime before admitting a target. The
invalid run is recorded in the experiment ledger and excluded from model claims.

## Results

| Candidate | Live field accuracy | Live abstention class | Live evidence accepted | Live normalized coverage | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| T5Gemma 2 270M, evidence pinned | 47.9% | 18.8% | 25.0% | 33.3% | Reject |
| T5Gemma 2 1B, 20 steps | 63.5% | 56.3% | 25.0% | 0.0% | Continue once |
| T5Gemma 2 1B, explicit contract | 68.8% | 37.5% | 43.8% | 0.0% | Reject |
| Qwen3-VL 2B, zero shot | 29.2% | 81.3% | 0.0% | 0.0% | Reject |

The final T5Gemma 2 1B checkpoint performed much better on unseen synthetic pages:
86.5% field accuracy, 81.3% evidence acceptance, and 87.5% normalized coverage.
The corresponding live results remained 68.8%, 43.8%, and 0%. This gap is direct
evidence that the synthetic distribution is not an adequate proxy for unfamiliar
retailer markup.

Qwen3-VL loaded and ran successfully, but it frequently emitted Markdown fences,
invented schemas, page-level arrays, unsupported units, and ungrounded evidence
IDs. Its higher live abstention-class score came from broad refusal behavior, not
useful extraction.

## Cost

Recorded training deltas for this cycle are:

- Invalid 270M run: $0.2166.
- Corrected 270M run: $0.2495.
- Initial 1B run: $0.3266.
- Explicit-contract 1B continuation: $0.4826.

The final 1B evaluation used 948.15 A10 seconds. The Qwen zero-shot evaluation used
185.61 A10 seconds. Additional bounded evaluations used T4 and A10 instances. The
project remains well below the $30 cap; the exact Modal billing meter still needs
to be reconciled before a final cost claim.

## Decision

No candidate is eligible for production or direct in-browser execution.

Do not continue unconstrained generation training on the current corpus. The next
cycle should:

1. Evaluate the frozen MarkupLM discovery model and decoder on new sealed domains.
2. Increase independently adjudicated live extraction coverage, especially
   comparable products rather than mostly abstention cases.
3. Treat card discovery and fact extraction as separate measured stages.
4. Prefer constrained field classification or span selection over free-form JSON
   generation for DOM evidence.
5. Retain deterministic unit conversion and evidence validation after model
   inference.
