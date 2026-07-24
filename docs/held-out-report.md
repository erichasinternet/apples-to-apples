# Frozen Held-Out Evaluation

## Decision

`synthetic-pilot-100-real-discovery-balanced` is rejected for production use.
It remains the best available discovery preannotation checkpoint, but its unseen
domain performance is too weak to drive the extension without human review. The
extraction checkpoint is also rejected because no live extraction passed evidence
validation.

No model, prompt, pruning rule, generation parameter, or site-specific selector was
changed after the held-out split was opened.

## Training Evidence

The base corpus contains 120 synthetic pages, 1,680 products, and 2,040 records
across 40 generated domains. Real-DOM adaptation added 30 weak-label discovery
records from seven development domains. The selected branch ran 20 LoRA steps with
50% repeated real-DOM discovery presentations and 50% synthetic discovery replay.

The selection rule favored the branch because it improved both predeclared live
cohorts:

| Cohort | Precision | Recall | F1 | JSON |
| --- | ---: | ---: | ---: | ---: |
| Development validation | 70.0% | 87.5% | 77.8% | 100% |
| Selection, FreshDirect | 100% | 41.7% | 58.8% | 100% |

These values use generic collector candidates as weak references. They are not
human-adjudicated accuracy.

## Held-Out Acquisition

The sealed run attempted one page on each of 20 unseen domains using a clean,
headed Playwright browser. It did not use the user's Brave profile.

| Outcome | Domains | Rate |
| --- | ---: | ---: |
| Captured | 7 | 35% |
| Blocked or challenged | 6 | 30% |
| Navigation or capture failure | 7 | 35% |

Captured domains were BJ's, BoxNCase, Giant Eagle, Gopuff, iHerb, Macy's, and
Menards. The run contains 6,471 observed nodes and 26 generic candidate roots.
Every target was bounded to 180 seconds and the manifest was persisted after each
attempt.

Acquisition coverage is a separate failure from extraction quality. A browser
extension running in the shopper's active page should avoid many anonymous
automation blocks, but that claim still requires extension-context tests.

## Held-Out Discovery

The seven captured pages produced 13 prompts after deterministic 96-node pruning.
Inference used the frozen balanced adapter, greedy generation, and a 192-token
limit.

| Metric | Result |
| --- | ---: |
| Complete JSON | 13 / 13 |
| Unique predicted roots | 72 |
| Duplicate root IDs | 4 |
| IDs absent from page observation | 2 |
| Chunks with weak references | 2 / 13 |
| Weak true positives | 2 / 6 |
| Weak precision | 16.7% |
| Weak recall | 33.3% |
| Weak F1 | 22.2% |

The low number of scorable chunks prevents a statistically strong accuracy claim.
Visual inspection also shows that the generic collector missed some genuine card
roots while the model proposed both real cards and non-card subnodes. The weak F1
is therefore a diagnostic, not an estimate of true accuracy. It does not rescue the
model: nonexistent IDs, duplicate IDs, mixed root quality, and the large drop from
selection to held-out are sufficient to reject production promotion.

The generated review queue contains 68 unique proposals. Two nonexistent nodes are
automatically rejected and 66 grounded proposals require review. Each queue entry
includes the saved screenshot path, node bounds, node text, descendant evidence,
source chunks, and weak-reference status.

A complete first visual/DOM review identified 51 product-card roots. Scoring after
the existing duplicate/unknown-ID runtime gate produced:

| Metric | Single-review result |
| --- | ---: |
| Precision | 47.0% |
| Recall | 60.8% |
| F1 | 53.0% |
| True positives | 31 |
| False positives | 35 |
| False negatives | 20 |

BoxNCase reached 80% precision and 75% recall, while Giant Eagle and both
non-product captures produced no true positives. The review is checked into
`benchmarks/reviews/heldout-2026-07-24-reviewer-a.json`, is explicitly marked
ineligible for training, and must not be called gold until a second independent
review is adjudicated.

## Held-Out Extraction

Extraction was not rerun on held-out pages. The prior replay checkpoint produced 37
live proposals: nine were unparseable, and all 28 parseable outputs failed the
deterministic evidence validator. Spending more compute on the same checkpoint
would not answer a new question.

The extension must continue to prefer a retailer's native unit price when present.
Model output may only supplement missing values after card-local evidence
validation. No confidence label belongs in the shopper-facing UI.

## Cost

The last observed Modal meter was `$1.5247`. Later training and inference runs are
estimated from published per-second resource rates at about `$1.06`, including
`150.5` T4 GPU-seconds for this held-out pass. Estimated total compute is `$2.58`,
well below the `$30` cap. The estimate excludes negligible image-build overhead.

## Next Experiment

The bottleneck is label quality and real-domain breadth, not parameter count.

1. Build adjudicated product-root and field-evidence labels for at least 30
   development domains and 10 selection domains.
2. Require two independent reviews and adjudicate disagreements.
3. Keep deterministic post-generation rejection of duplicate and unknown node IDs
   as a mandatory runtime gate and report its rejection counts.
4. Train the 270M model first with synthetic replay and measured real-data sampling.
5. Compare FLAN-T5 Base and MarkupLM on the same immutable evaluation bundle.
6. Open a new held-out domain split only after model selection is frozen.
7. Approve T5Gemma 2 1B-1B only if learning curves show 270M underfitting.

The current held-out domains are now opened and must not be used for further model
selection.
