# Unit-price semantic audit: 2026-08-01

## Scope

- Replayed 2,133 usable pages from 2,715 saved live-site captures.
- Skipped 561 blocked captures; 21 incomplete capture directories could not be replayed.
- Reviewed every distinct emitted evidence signature with `Qwen/Qwen3-4B-Instruct-2507`, prompt version 1.
- Used deterministic checks separately for arithmetic, conversion, and source-evidence invariants.

## Results

| Measure | Result |
| --- | ---: |
| Initial emitted outputs | 15,152 |
| Initial model-invalid outputs | 898 |
| Intermediate model-invalid outputs | 419 |
| Final emitted outputs | 14,311 |
| Final outputs with review coverage | 14,311 |
| Distinct evidence signatures reviewed | 9,162 |
| Final model-valid outputs | 13,973 |
| Final model-invalid outputs | 338 |
| Final distinct model-invalid signatures | 213 |
| Final uncertain outputs | 0 |
| Missing or malformed review outputs | 0 |
| Deterministic semantic errors | 0 |

Every final output maps to exactly one reviewed evidence signature. Evidence adjudication found no additional confirmed defect class among the 213 residual model-invalid signatures. The residuals are retained as model disagreements, not relabeled as benchmark gold. Their largest clusters are reviewer overcalls on explicit tea package weights, fabric sold by the yard, grocery package contents, retailer unit-price fields, and valid case-pack arithmetic.

This is strong systematic evidence, not a population precision or 100% accuracy claim. Independent human adjudication and broader live-site sampling remain required for that claim.

## Remediation

The audit added conservative abstention or correction rules for:

- durable-product measurements, including laptop screens, medical pad dimensions, paper plates, straws, and serving containers;
- width and size measurements that were mistaken for fabric, webbing, or wrapper sale length;
- container capacity, equipment flow rate, medical gauge, and material-weight specifications;
- `L` and `G` suffixes in SKUs or dimensional labels that were parsed as liters or grams;
- liquid products whose retailer rate omitted the `fl` marker from fluid ounces;
- nested cup packaging where package multiplication was not reliable;
- merchandising, stock-status, rating, promotion, and vendor labels selected as product titles;
- explicit total counts or area coverage multiplied by a second package count;
- one-digit slash-pack counts missed in titles;
- title-local unit-price evidence overridden by unrelated card text;
- paper and cup dimensions, disher capacities, and unlabeled bag capacities treated as package contents.

Positive controls retain real package weights, grocery quantities, tile area, cast-padding length, tea weight, and fabric or webbing sold by length.

## Reproduction

```bash
bun run audit:false-positives
bun run audit:false-positives:review
bun run audit:false-positives:review:summary
bun run verify
```

The replay command uses isolated 100-page subprocesses because retaining thousands of JSDOM documents in one process can exceed local memory. Raw replay and model-review outputs live under `artifacts/audits/` and are intentionally not committed. Model review is systematic triage, not human benchmark gold.
