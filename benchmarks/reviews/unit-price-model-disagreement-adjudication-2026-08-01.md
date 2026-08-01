# Unit-price model disagreement adjudication: 2026-08-01

## Method

- Replayed all 2,715 saved captures; 2,133 pages were usable, 561 were blocked, and 21 capture directories were incomplete.
- Reviewed all 14,311 emitted unit prices through 9,162 deduplicated evidence signatures with `Qwen/Qwen3-4B-Instruct-2507`.
- Inspected every model-invalid signature by title, selected evidence, normalized result, retailer context, and recurring evidence pattern.
- Added a regression test for each confirmed defect class and reran both the full deterministic replay and the complete model review after remediation.

## Final review

| Decision | Output assignments | Unique signatures |
| --- | ---: | ---: |
| Model valid | 13,973 | 8,949 |
| Model invalid | 338 | 213 |
| Uncertain, missing, or malformed | 0 | 0 |

The 213 remaining model-invalid signatures were adjudicated as reviewer errors, not extension defects. This is agent evidence adjudication, not independent human benchmark gold.

## Confirmed defects

The disagreement review exposed real failures in these recurring classes:

- total counts and tile coverage multiplied by a second inferred pack count;
- dimensions, material weights, equipment capacities, cup capacities, and bag capacities treated as sale quantities;
- uppercase SKU suffixes and model codes parsed as grams or liters;
- liquid retailer `/oz` rates normalized as mass despite fluid-ounce package evidence;
- one-digit `/Pack` quantities missed, allowing unrelated card quantities to win;
- product-title extraction selecting vendor, rating, promotion, or stock-status labels;
- product-title quantities losing to unrelated quantities elsewhere in a card;
- `yds` and `linear yard` evidence not recognized;
- fabric weights and widths selected instead of explicit per-yard prices;
- pre-cut paper dimensions selected instead of explicit case counts;
- parser artifacts such as `2 in 1` interpreted as physical length.

## Reviewer errors

The largest residual unique-signature clusters were:

| Site | Signatures | Evidence pattern |
| --- | ---: | --- |
| Dobra Tea | 73 | Explicit loose-leaf tea package weights |
| Girl Charlee | 36 | Explicit yard-piece and bolt lengths |
| Style Maker Fabrics | 12 | Visible per-yard prices |
| Save Mart | 10 | Grocery package weights |
| Fabrics Store | 9 | Visible per-yard prices |
| Britex Fabrics | 8 | Visible per-yard prices |
| Z Fabric | 7 | Visible per-yard prices |
| FreshDirect | 6 | Grocery package weights |
| Walgreens | 5 | Shampoo fluid-ounce contents and corroborating rates |

Other inspected reviewer errors include paper-towel square-foot and sheet rates, flooring square-foot rates, cleaning-product volumes, explicit medical-supply lengths, tea weights, paint multipacks, trash-bag counts, battery carton arithmetic, and the Mosaic Trader card that explicitly states `Unit: 10 g`.

## Limitations

- The model reviewer is useful for systematic triage but demonstrably overcalls common retail evidence.
- The 21 incomplete capture directories were not replayable.
- Saved pages cannot prove behavior on future DOM variants or sites outside the corpus.
- No 100% accuracy or population precision claim is supported without independent human labels and continued live validation.
