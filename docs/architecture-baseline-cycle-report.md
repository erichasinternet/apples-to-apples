# Architecture Baseline Cycle

## Question

Can a model architecture aligned to either screenshots or DOM structure improve
site-agnostic product-card discovery over serialized-DOM generation?

All baselines used strict dataset SHA-256
`a4244fe987b6c66d4c5fe75a5a35272ecf2b84a6cc0f90102c1fc9c0c45f1fda`.
The corpus contains synthetic replay plus adjudicated real discovery data from 17
development domains. Instacart was excluded from training.

## Results

| Candidate | Objective | Internal result | Instacart diagnostic | Decision |
| --- | --- | ---: | ---: | --- |
| FLAN-T5 Base | DOM text to root-ID JSON | 0% valid JSON | 0% recall | Reject |
| Pix2Struct Base, JSON | Screenshot to normalized boxes | 0% valid JSON after 100 steps | 0 mapped roots | Reject |
| Pix2Struct Base, compact | Screenshot to compact box tags | 0% valid tags after 40 steps | 2/28 roots through title grounding | Reject for discovery |
| MarkupLM Base | DOM/XPath root classification | 0.907 node F1 | 0.814 F1 before diagnostic decoding | Advance to new sealed validation |
| MarkupLM plus structural decoder | Classification plus evidence and sibling constraints | Not independently measured | 1.000 F1 after error analysis | Diagnostic only |

The post-diagnostic MarkupLM score is not sealed evidence. Inspecting Instacart
errors directly informed the decoder, so this page is permanently retired from
model selection and final benchmark claims.

## Pix2Struct

Pix2Struct completed one-step smoke training and three bounded branches:

- A 20-step JSON-box branch reduced evaluation loss to 1.505 but produced no valid
  JSON.
- Continuing that immutable branch to 100 total steps reduced loss to 1.122 but
  still produced no valid JSON.
- A separate 40-step compact-tag branch reached loss 1.294 but produced no valid
  coordinate sequence.

The compact branch did generate nine recognizable product-title candidates on
Instacart. Conservative title-to-DOM grounding found two exact roots with no false
positives. That does not justify more discovery training, but it preserves a
possible future role as an OCR or title-evidence teacher.

## MarkupLM

A 40-step weighted binary root classifier trained in 25 seconds and completed the
Modal run in 56.67 A10 seconds. At its validation-calibrated 0.70 threshold:

- Node precision: 0.831.
- Node recall: 1.000.
- Node F1: 0.907.
- Negative-page accuracy: 1.000 across three sampled negatives.

The first external run scored only 0.222 F1 because MarkupLM was incorrectly fed
the 96-node generative prompt. Five of 28 reviewed roots were absent from every
prompt, making full recall impossible. Reading the saved full DOM raised candidate
recall to 1.000 and model F1 to 0.814 without retraining.

The remaining errors formed two deterministic slices:

1. Seven loading-skeleton roots had no descendant text or accessible evidence.
2. The first card in each of four repeated rows scored below 0.70 while at least
   six same-shaped siblings scored above it.

Constrained decoding now requires descendant evidence, excludes horizontally
clipped roots, and completes a repeated sibling row only when at least two
evidence-bearing siblings pass the calibrated threshold and each added sibling
retains model probability of at least 0.30. On the consumed Instacart page this
returns all 28 reviewed roots with no extras. Two focused regression tests cover
skeleton rejection, sibling completion, and horizontal clipping.

## Visual Mapping Correction

The visual-review mapper previously interpreted normalized model boxes relative to
the screenshot crop and then added the crop offset a second time. Mapping now uses
the page-coordinate source region. Regenerating saved Qwen mappings changed the
diagnostics materially:

| Cohort | Old F1 | Corrected F1 |
| --- | ---: | ---: |
| Development expansion | 0.163 | 0.193 |
| Remaining development | 0.182 | 0.500 |
| Held out | 0.114 | 0.253 |
| Instacart selection | 0.000 | 0.000 |

Qwen remains unsuitable for exact DOM-root gold because mapped boxes frequently
select the wrong nested or neighboring element. The corrected results can support
review prioritization only.

## Cost

The architecture cycle used an estimated 1,327.31 A10 seconds and 225.72 T4
seconds, including conservative estimates for failed setup runs. At the recorded
Modal GPU, CPU, and memory rates this is approximately $0.58, bringing estimated
project compute to $5.21 of the $30 cap.

## Decision

Do not spend more on Pix2Struct discovery or a larger generative model. Next:

1. Run the frozen MarkupLM checkpoint and decoder on newly captured, independently
   reviewed domains with no implementation changes after labels are opened.
2. Report candidate recall separately from classification and decoding metrics.
3. Add horizontal visibility policy to the next corpus rebuild; current training
   targets include two horizontally clipped carousel cards.
4. Keep extraction separate. Annotate price, quantity, native unit price, and
   abstention evidence before training an extraction model.
5. Promote nothing until discovery and extraction both pass a new domain-held-out
   production gate.
