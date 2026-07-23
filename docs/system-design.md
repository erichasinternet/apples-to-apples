# System Design

## Goal

Build a privacy-conscious Manifest V3 extension that can discover products and normalize unit prices on shopping sites that were not known during development. Retailer-specific selectors are a baseline and optional optimization, not the source of truth for extraction.

The extension must fail closed. It may omit a comparison when evidence is ambiguous, but it must not display a price or quantity that cannot be traced to the rendered page.

## Target Pipeline

```text
Rendered page
  -> generic observation builder
  -> learned product-card and fact extraction
  -> deterministic evidence validator
  -> deterministic unit conversion and arithmetic
  -> inline unit price and local sort integration
```

The current selector and regular-expression extractor remains a benchmark baseline while the learned path is evaluated. It is not assumed to satisfy the unknown-site requirement.

## Generic Observation

The observation builder does not branch on hostname and does not use product-oriented selectors. It records:

- Visible rendered nodes and stable node identifiers.
- Parent relationships and document order.
- Direct visible text and accessible names.
- Semantic attributes such as role, label, link, and Schema.org item properties.
- Bounding boxes, viewport intersection, typography, and interaction state.
- A screenshot of the captured main content.

This representation preserves semantic, structural, and visual evidence without transmitting scripts, form values, cookies, storage, or URL query parameters.

## Learned Extraction

The learned component has two responsibilities:

1. Identify product-card root nodes.
2. Extract title, current price, native unit price, quantity per package, pack count, semantic unit, and exact evidence node identifiers.

It does not calculate totals or normalized prices. It emits an explicit abstention when price, variant, quantity, or unit meaning is ambiguous. The output contract intentionally has no confidence field.

An encoder-decoder model is a candidate for the structured transformation from page observations to extraction JSON. A multimodal or layout-aware model may be required if text and geometry alone do not reach the held-out-domain target. Model architecture is selected by benchmark results, not assumed in advance.

## Evidence Gate

Before model output can reach the normalizer, the validator checks:

- Every card and evidence node exists.
- Every cited evidence node belongs to the emitted card.
- The title occurs in cited evidence.
- Every emitted numeric value occurs in cited evidence.
- Every unit occurs in cited evidence and matches its dimension.
- Multipack factors are grounded separately.
- Abstentions do not also emit comparison values.

Rejected model products produce no extension UI. Accepted quantity factors are multiplied and normalized by deterministic code.

## Unit Rules

The engine converts only within the same dimension:

- Weight: `oz`, `lb`, `g`, `kg`
- Volume: `fl oz`, `mL`, `L`, `gal`, `qt`, `pt`, `cup`
- Count: `count`, `roll`, `sheet`, `load`, `pod`, `tablet`, `capsule`, `diaper`, `bag`
- Area: `sq ft`, `sq in`
- Length: `ft`, `in`

Count units remain semantically distinct. A roll is not automatically equivalent to a sheet.

## Sorting

Extraction and sort-control integration are separate problems. The learned extractor supplies comparable values; a generic UI integration layer then attempts to identify the site's visible sort control through accessible roles, labels, and interaction behavior.

Local unit-price sorting:

- Reorders only product cards already visible in the current DOM.
- Sorts only products with the same semantic comparison unit.
- Keeps unrelated page regions in place.
- Preserves a DOM snapshot so retailer order can be restored.

Retailer adapters may remain as optional UI compatibility code, but extraction accuracy must not depend on them.

## Privacy And Deployment

Raw live captures remain local and ignored by Git. No model is shipped or called from the extension until the benchmark establishes its accuracy, latency, memory, privacy, and cost characteristics.

Deployment options are evaluated independently:

- Local model: stronger privacy, constrained by extension download size and browser inference cost.
- Remote model: easier experimentation, but requires explicit consent, redaction, retention controls, and a sustainable cost model.

The offline benchmark and evidence validator are shared across both options.
