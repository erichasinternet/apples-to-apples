# Expanded Adjudicated Discovery Cycle

## Hypothesis

Adding exact product-root supervision from ten additional development domains
should improve site transfer and reduce nested-node errors relative to the
three-domain checkpoint. The model, prompt, generation limit, learning rate, and
50/50 real-to-synthetic replay mixture remained fixed.

## Data

The expansion contains 13 pages from ten additional domains, 38 discovery chunks,
124 exact roots, and one explicit challenge-page negative. Together with the first
three-domain cycle, the strict dataset contains:

| Measure | Value |
| --- | ---: |
| Adjudicated development domains | 13 |
| Adjudicated pages | 16 |
| Real discovery chunks | 47 |
| Exact product roots | 160 |
| Training records | 335 |
| Synthetic validation records | 72 |
| Dataset SHA-256 | `22ea3792a05883c35d51923e5843ac3bb38807e017ec7e013bdcb2bb2211acc0` |

All real pages are training-only and permanently retired from validation. The
independent Qwen3-VL 2B review had only 25.0% exact-root precision, 12.1% recall,
and 16.3% F1 against the manual visual/DOM review. It frequently selected nested
descendants or failed to map approximate boxes. It served as disagreement evidence,
not a source of gold labels.

The dataset builder found three reviewed roots that the inference prompt had pruned.
Required card roots are now a hard pruning invariant, even when their ancestor
paths exceed the nominal node budget. The builder regenerates adjudicated prompts
from exact labels and rejects any target ID absent from its input.

## Extraction Queue

A separate pending annotation queue covers all 160 cards:

| Evidence candidate | Cards |
| --- | ---: |
| Title | 148 |
| Current price | 127 |
| Native unit price | 41 |
| Package quantity | 107 |

These regex-classified candidates are review aids, not labels. No extraction record
from this queue is eligible for training until fields, evidence node IDs, and
abstentions receive independent adjudication.

## Training

`synthetic-pilot-140-expanded-adjudicated-discovery` continued from
`synthetic-pilot-120-adjudicated-discovery` for 20 A10 steps. Training took 976.84
seconds. Internal synthetic JSON validity was 96.9%, recoverable JSON was 100%,
and discovery exactness was 93.8%. These are sanity checks rather than promotion
metrics.

## Results

On the newly consumed development expansion:

| Metric | Parent | Expanded |
| --- | ---: | ---: |
| Exact-root precision | 53.6% | 64.7% |
| Exact-root recall | 79.0% | 90.3% |
| Exact-root F1 | 63.8% | 75.4% |
| False positives | 85 | 61 |
| False negatives | 26 | 12 |

A new anonymous collection attempted the eight previously unavailable selection
domains. Instacart produced one usable capture; five sites returned explicit
HTTP/interstitial negatives and two failed navigation. The sealed Instacart page
contains 28 fully visible roots across four store carousels.

| Metric | Parent | Expanded | Delta |
| --- | ---: | ---: | ---: |
| Exact-root precision | 85.7% | 78.3% | -7.5 pp |
| Exact-root recall | 64.3% | 64.3% | 0.0 pp |
| Exact-root F1 | 73.5% | 70.6% | -2.9 pp |
| True positives | 18 | 18 | 0 |
| False positives | 3 | 5 | +2 |
| False negatives | 10 | 10 | 0 |

The independent visual review of Instacart was invalid: two dense-grid generations
truncated even after a larger output budget, and the third mapped none of its ten
boxes to a card root. Instacart results therefore remain a single-review research
diagnostic, not benchmark gold.

## Decision

Reject `synthetic-pilot-140-expanded-adjudicated-discovery`. It fit consumed
development data better but added false roots without finding another sealed card.
Retain `synthetic-pilot-120-adjudicated-discovery` as the best research checkpoint;
it remains rejected for production.

The next discovery experiment should emphasize hard outer-root versus nested-node
negatives and compare the frozen corpus against Pix2Struct Base and MarkupLM Base.
The next extraction work is human field annotation, not further model-generated
labels. No larger T5Gemma run is justified yet.

## Cost

This cycle used 1,487.63 T4 GPU-seconds and 976.84 A10 GPU-seconds. At the current
published Modal GPU, CPU, and memory rates, the cycle is estimated at $0.76 and
total project compute at $4.16. This remains below the $30 cap.
