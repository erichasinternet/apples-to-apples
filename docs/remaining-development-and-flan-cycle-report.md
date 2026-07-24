# Remaining Development and FLAN Control

## Purpose

This cycle tests two separate hypotheses:

1. More unfamiliar development domains and explicit negative pages improve the
   evidence available for site-agnostic discovery research.
2. A text-only serialized-DOM encoder-decoder is a competitive low-cost control
   for the current multimodal T5Gemma discovery model.

The newly opened pages are permanently retired from validation. The Instacart
selection page remains single-review diagnostic data and is not training or
benchmark gold.

## Development Corpus

Fresh isolated Chromium collection attempted the 17 unadjudicated development
domains. Fourteen domains produced usable observations after blocked pages were
retained as explicit negatives. Office Depot, Sephora, and Walgreens supplied 30
visually verified product-card roots. Eleven challenge, redirect, or blocked pages
were labeled with zero product roots.

The parent `synthetic-pilot-120-adjudicated-discovery` checkpoint scored:

| Metric | Result |
| --- | ---: |
| Exact-root precision | 52.3% |
| Exact-root recall | 76.7% |
| Exact-root F1 | 62.2% |
| Negative-page false roots | 0 |

Office Depot accounted for 16 of the 21 false positives because the model selected
nested descendants and inner product nodes instead of the repeated outer card.
Sephora and Walgreens generalized substantially better. This is direct evidence
for an outer-root versus nested-node failure slice.

An independent Qwen3-VL review reached only 28.6% precision and 13.3% recall after
mapping visual boxes back to DOM nodes. It remains reviewer evidence only. The
human-reviewed roots are training-eligible but not benchmark gold.

The rebuilt strict dataset contains 361 training records, 72 validation records,
73 adjudicated real discovery chunks, 67 domains, and 190 product cards. Its
SHA-256 is
`a4244fe987b6c66d4c5fe75a5a35272ecf2b84a6cc0f90102c1fc9c0c45f1fda`.

## FLAN-T5 Control

`google/flan-t5-base` received the same discovery prompts with the image marker
removed. A LoRA pilot used 320 records, a fixed 50/50 real/synthetic mixture, and
20 A10 training steps.

The first run trained successfully but failed after evaluation because the harness
decoded padded labels instead of comparing against the immutable target strings.
The harness was corrected, the adapter was saved before evaluation, and the failed
compute remains in the cost ledger.

The corrected run reached evaluation loss `1.2715`, but generated valid JSON for
zero of 32 validation records. Production-path inference on the three sealed
Instacart chunks also produced three malformed predictions and recovered zero of
28 reference roots.

This rejects the bounded FLAN-T5 configuration. It does not prove that text-only
DOM models cannot work, but there is no evidence supporting additional FLAN spend
before the higher-priority Pix2Struct and MarkupLM controls are measured.

## Cost and Decision

This cycle used 423.07 T4 seconds and 937.43 A10 seconds, including an estimated
465 A10 seconds for the failed first FLAN run. At the recorded Modal GPU, CPU, and
memory rates, the cycle is estimated at `$0.48`; total project compute is about
`$4.63`, below the `$30` cap.

Retain `synthetic-pilot-120-adjudicated-discovery` as the best research checkpoint.
Do not promote any model to the extension. Next work is extraction annotation and
the Pix2Struct and MarkupLM architecture controls.
