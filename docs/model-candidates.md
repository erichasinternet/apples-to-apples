# Model Candidate Policy

## Decision Rule

Models are accepted for experiments, not for automatic promotion. Every candidate
must use the same observation schema, evidence validator, domain split, generation
limits, and cost ledger. A larger model is tested only when a smaller candidate's
learning curve or error slices show a capacity limitation rather than a data,
label, prompt, or evaluation defect.

## Approved Queue

| Priority | Model | Role | Why it is useful | Promotion condition |
| --- | --- | --- | --- | --- |
| 1 | `google/t5gemma-2-270m-270m` | Current multimodal encoder-decoder | Smallest end-to-end structured extractor already integrated | Continue only bounded data-mixture experiments |
| 2 | `microsoft/markuplm-base` | Selected DOM/XPath discovery architecture | A 40-step classifier reached 0.907 internal node F1 and 0.814 F1 on unseen Instacart before diagnostic structural decoding | Pass a new sealed multi-domain discovery cohort without decoder changes |
| 3 | `google/pix2struct-base` | Rejected discovery baseline; optional visual teacher | JSON and compact-box branches produced no valid coordinates, but title grounding recovered 2/28 roots without false positives | Revisit only as an OCR/title teacher with a separately measured downstream gain |
| 4 | `google/flan-t5-base` | Rejected bounded text-only control | A 20-step serialized-DOM pilot produced no valid JSON on internal or sealed selection inference | Revisit only with evidence that a different objective or decoding contract fixes the measured failure |
| 5 | `google/t5gemma-2-1b-1b` | Same-family capacity check | Preserves the multimodal encoder-decoder contract with more capacity | Run only after the 270M learning curve underfits a sufficiently large adjudicated corpus |

Official references:

- [T5Gemma 2 1B-1B](https://huggingface.co/google/t5gemma-2-1b-1b)
- [Pix2Struct Base](https://huggingface.co/google/pix2struct-base)
- [MarkupLM Base](https://huggingface.co/microsoft/markuplm-base)
- [FLAN-T5 Base](https://huggingface.co/google/flan-t5-base)

## Reviewer-Only Models

`microsoft/Florence-2-base` is approved as a visual box-localization teacher or
reviewer. Its object-detection interface is relevant to card rectangles, but it
does not solve DOM-node identity or evidence-grounded field extraction by itself.

`Qwen/Qwen3-VL-2B-Instruct` remains reviewer-only. In current tests its free-form
boxes frequently map to nested descendants, over-enumerate dense carousels, and
truncate before valid JSON. It must not create training or benchmark gold without
manual adjudication.

The normalized-box mapper now uses the page-coordinate source region. Corrected
Qwen F1 remains low: 0.193 on development expansion, 0.500 on remaining
development, 0.253 on held out, and 0 on Instacart selection.

## Deferred

- T5Gemma 2 4B-4B and other multi-billion-parameter VLMs: too expensive before a
  measured capacity bottleneck.
- PaliGemma-family models: no demonstrated advantage over the current multimodal
  encoder-decoder contract for this task.
- Decoder-only chat models: useful as offline teachers, but inefficient for the
  constrained browser artifact and structured extraction target.

Model size does not relax the production gate. The extension receives model output
only after exact evidence validation, deterministic normalization, and a
domain-held-out benchmark demonstrate acceptable false-positive and abstention
rates.

The measured architecture comparison is in
[`architecture-baseline-cycle-report.md`](./architecture-baseline-cycle-report.md).
