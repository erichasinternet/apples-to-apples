# Learned Extraction Experiment

## Purpose

This experiment tests whether a learned extractor can identify products and unit-pricing facts on domains that were never represented in selectors, prompts, fixtures, or training data.

It is intentionally offline. Passing the experiment does not automatically authorize model inference in the extension.

## Contracts

Each captured page produces:

- `observation.json`: rendered nodes, parent links, text, accessible names, bounds, styles, and canonical links.
- `main.png`: a visual record of the main-content region when screenshot capture succeeds.
- `main.html`: sanitized markup used by the deterministic baseline.
- `annotation.json`: human labels and evidence-node references.
- `annotation.png`: the bounded region that reviewers must cover completely.

Model output follows [`model-extraction.schema.json`](../benchmarks/live-sites/model-extraction.schema.json). It emits raw facts and citations, not normalized prices.

## Fine-Tuning Record Format

One supervised example consists of:

```text
input:
  extraction instructions
  page observation or a bounded observation region
  optional aligned screenshot crop

target:
  model-extraction JSON with card roots, raw facts, abstentions, and evidence node IDs
```

Page regions are compacted to the recorded annotation bounds by geometry while preserving structural ancestors. Compaction is generic and deterministic; it cannot use hostname checks or gold product selectors.

## Required Baselines

Every experiment reports the same domain-held-out metrics for:

- Current deterministic extractor.
- Prompted general-purpose model.
- Fine-tuned candidate model.
- Hybrid candidate, if proposed.

Report product-card precision and recall separately from field extraction. A model that extracts perfect values from preselected cards has not solved unknown-site card discovery.

## Promotion Gates

A model is not integrated into the extension until an adjudicated test set demonstrates:

- At least 95% exact normalized accuracy on comparable products.
- At least 98% correct abstention on unsupported products.
- Less than 1% incorrect displayed unit prices across all audited cards.
- Every accepted field passes deterministic evidence validation.
- No material accuracy collapse on domains absent from training and prompt examples.
- Acceptable page latency, memory, download size or API cost.

These are product gates, not confidence thresholds. Confidence is not displayed to shoppers.
