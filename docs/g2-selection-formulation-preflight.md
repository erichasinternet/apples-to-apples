# G2 Compact Evidence-Selection Preflight

## Decision

The compact evidence-selection representation is ready for independently
reviewed live data. It is not yet authorized for paid training.

G1 required T5Gemma 2 to generate seven labeled lines containing source DOM IDs,
deterministic candidate IDs, and a free-text status. Its best live diagnostic
produced 18.75% valid grammar and zero exact pointers. The dominant failure was
output formulation: generations copied prompt text into `STATUS` despite
otherwise selecting correct fields on valid synthetic outputs.

G2 reduces the learned task to closed-set selection. The model emits exactly:

```text
T## P## U## Q## K## S#
```

Each `##` is a two-character, card-local base-36 index from the prompt, or `--`
when the field is absent. The one-character status is selected from:

| Code | Meaning               |
| ---- | --------------------- |
| `C`  | comparable            |
| `E`  | insufficient evidence |
| `D`  | conditional price     |
| `R`  | price range           |
| `V`  | unselected variant    |
| `Q`  | ambiguous quantity    |
| `U`  | unsupported unit      |
| `N`  | not a product         |

The target is always 22 characters. It contains no generated numeric value,
unit, arithmetic result, source DOM ID, or unrestricted text.

## Responsibility Boundary

The model selects:

- one title node;
- either a native unit-price candidate or a current-price plus quantity
  candidate;
- an optional pack-count candidate;
- one comparable or abstention status.

Deterministic code remains responsible for:

- candidate enumeration from the exact model observation;
- candidate-kind and card-local evidence checks;
- unit parsing and dimension compatibility;
- package and multipack arithmetic;
- canonical unit conversion and display formatting;
- rejecting invalid or unsupported selections.

This preserves fail-closed behavior. A grammar-valid output cannot introduce a
number or evidence pointer that was absent from the prompt catalog.

## Synthetic Preflight

The existing domain-disjoint synthetic pointer corpus was converted without
regenerating semantic labels.

| Measure                         |                         Result |
| ------------------------------- | -----------------------------: |
| Records                         |                         20,000 |
| Train / validation              |                 16,000 / 4,000 |
| Synthetic domains               |                            200 |
| Structural families             |                            652 |
| Exact deterministic round trips |                20,000 / 20,000 |
| Invalid targets                 |                              0 |
| Target length                   | 22 characters for every record |
| Mean source prompt              |            4,948.19 characters |
| Mean selection prompt           |            2,065.76 characters |
| Prompt reduction                |                         58.25% |

Dataset SHA-256:
`fbd5d761f84a065e0efbcd737f59ea9ce12ab2acc3ce0284f814ea6d6766f57a`.

The complete tracked dataset card is
[`selection-dataset-card.json`](../benchmarks/synthetic-training/selection-dataset-card.json).
Synthetic data may warm-start the closed grammar, but it cannot establish
live-site accuracy or satisfy any live-corpus gate.

## Live Representation Preflight

The exact production pruning path was applied to all semantically
machine-audited records in the current 22-site, 63-page campaign.

| Measure                         |                         Result |
| ------------------------------- | -----------------------------: |
| Requested records               |                            564 |
| Exact deterministic round trips |                            564 |
| Failures                        |                              0 |
| Comparable selections           |                            157 |
| Abstentions                     |                            407 |
| Mean prompt                     |            2,890.59 characters |
| p95 prompt                      |               4,380 characters |
| Maximum prompt                  |               7,808 characters |
| Target length                   | 22 characters for every record |

The complete tracked audit is
[`g2-selection-representation-p00.json`](../benchmarks/reviews/g2-selection-representation-p00.json).

This result establishes representation coverage only. The source labels are
machine preannotations, so they are ineligible for silver training and
benchmark gold. It does not establish semantic correctness, model accuracy, or
the G1 formulation gate.

## Authorization Gate

Do not spend Modal credit on this formulation until a representative,
domain-disjoint live development cohort has:

1. two immutable, blinded reviews from distinct reviewers;
2. adjudication by a third identity for every disagreement;
3. exact evidence pointers that resolve against the serialized model input;
4. frozen campaign, review, adjudication, training, and evaluation hashes;
5. a documented status and unit-dimension distribution.

After that gate, authorize one budget-capped T5Gemma 2 1B-1B experiment. Compare
it to the frozen G1 baseline using grammar validity, pointer exactness, accepted
normalized-price precision, eligible coverage, abstention recall, site-macro
coverage, latency, and metered cost. A failed run triggers error analysis before
any second hypothesis; it does not authorize a larger model.
