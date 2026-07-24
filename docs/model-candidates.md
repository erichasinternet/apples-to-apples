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
| 2 | `google/pix2struct-base` | Screenshot-native image-to-text baseline | Pretrained by parsing web-page screenshots into simplified HTML | Beat T5Gemma discovery F1 or materially improve visual root localization at comparable cost |
| 3 | `microsoft/markuplm-base` | DOM/XPath token-classification baseline | Explicitly encodes HTML text and markup paths for web information extraction | Beat the generative model on exact root and evidence-node tagging |
| 4 | `google/flan-t5-base` | Text-only serialized-DOM control | Separates the value of language/DOM evidence from screenshot input | Establish that images add measurable held-out value |
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
