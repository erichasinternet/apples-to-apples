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
| Final emitted outputs | 14,629 |
| Final outputs with review coverage | 14,629 |
| Final model-valid outputs | 14,210 |
| Final model-invalid outputs | 419 |
| Final uncertain outputs | 0 |
| Missing or malformed review outputs | 0 |
| Deterministic semantic errors | 0 |

The final inventory is a strict subset of the exhaustively reviewed post-fix evidence signatures. The 419 model-invalid decisions are retained as unresolved model disagreements, not counted as confirmed false positives. Most large residual clusters are reviewer overcalls on genuine package weights or goods sold by length, including loose-leaf tea and fabric sold by the yard. Independent human adjudication is still required for a population precision claim.

## Remediation

The audit added conservative abstention or correction rules for:

- durable-product measurements, including laptop screens, medical pad dimensions, paper plates, straws, and serving containers;
- width and size measurements that were mistaken for fabric, webbing, or wrapper sale length;
- container capacity, equipment flow rate, medical gauge, and material-weight specifications;
- `L` and `G` suffixes in SKUs or dimensional labels that were parsed as liters or grams;
- liquid products whose retailer rate omitted the `fl` marker from fluid ounces;
- nested cup packaging where package multiplication was not reliable;
- merchandising labels selected as product titles.

Positive controls retain real package weights, grocery quantities, tile area, cast-padding length, tea weight, and fabric or webbing sold by length.

## Reproduction

```bash
bun run audit:false-positives
bun run audit:false-positives:review
bun run audit:false-positives:review:summary
bun run verify
```

The raw replay and model-review outputs live under `artifacts/audits/` and are intentionally not committed. Model review is systematic triage, not human benchmark gold.
