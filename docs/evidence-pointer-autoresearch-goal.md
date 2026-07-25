# Evidence-Pointer Autoresearch Goal

## Objective

Build and ship a site-agnostic unit-price extraction system that can inspect an
unfamiliar rendered shopping page, identify comparable products, and display a
correct normalized unit price without retailer-specific selectors or prior
knowledge of the site's DOM.

The learned component selects evidence. It does not invent prices or perform
arithmetic. A deterministic runtime parses the selected text, converts compatible
units, validates the result, and abstains when the evidence is insufficient.

T5Gemma 2 1B-1B is the development teacher. T5Gemma 2 270M-270M is the intended
browser student. T5Gemma 2 4B-4B is a bounded diagnostic oracle, not the default
training target.

## Why Evidence Pointers

The current free-form JSON formulation reached 43.8% live evidence acceptance and
0% live normalized-pricing coverage. It frequently generated malformed structures,
unsupported values, or values that could not be traced to the observed card.

The replacement target is a compact pointer language:

```text
CARD n42
TITLE n47
CURRENT_PRICE n53
NATIVE_UNIT_PRICE n56
PACKAGE_QUANTITY n61
PACK_COUNT n63
STATUS comparable
```

Every non-status value must be an existing node ID in the exact serialized input.
Missing fields use `NONE`. `STATUS` is one of:

```text
comparable
insufficient-evidence
conditional-price
price-range
unselected-variant
ambiguous-quantity
unsupported-unit
not-a-product
```

The deterministic runtime owns text parsing, currency parsing, pack multiplication,
unit conversion, dimension compatibility, rounding, evidence display, and final
abstention. A model output alone is never displayable.

## Fixed Research Contract

The following are immutable during an experiment series:

- Input serialization and evidence-pointer grammar.
- Dataset and evaluation hashes.
- Domain and capture-date splits.
- Deterministic parser, converter, and evidence validator.
- Metric definitions and promotion thresholds.
- Per-run wall-clock and cost limits.
- Final sealed cohort.

Changing any of these starts a new named series with a new baseline. It cannot be
reported as an improvement within the old series.

Only one independent variable changes per experiment. Examples are the data mix,
loss weighting, learning rate, sequence length, model size, or decoding constraint.
A run changing more than one is invalid.

## Metrics

`accepted` means the model output passed pointer validation, deterministic parsing,
dimension checks, and unit-price recomputation.

The primary metric is accepted comparable coverage:

```text
accepted correct normalized outputs / eligible comparable products
```

It is optimized only inside this safety envelope:

- Accepted incorrect normalized outputs: exactly zero.
- Accepted-output observed precision: 100%.
- Abstention recall: at or above the phase gate.
- Output grammar validity: 100%.

Other required metrics are evidence-pointer exact match, field-level pointer
accuracy, site-macro coverage, native-unit-price coverage, derived-unit-price
coverage, p50/p95 latency, peak memory, artifact size, GPU seconds, and metered
cost.

Training loss and synthetic exactness are diagnostics. They cannot promote a run.

## Gates

### G0: Contract And Data Integrity

Pass when:

- 100% of targets validate against the exact serialized model input.
- 100% of target pointers resolve to input nodes or `NONE`.
- No domain, page, product, capture, or near-duplicate crosses a split boundary.
- Train, development, selection, and final manifests have immutable SHA-256 hashes.
- The final cohort remains sealed until a checkpoint and threshold are frozen.

Any failure invalidates the affected run and all descendants.

### G1: Formulation Proof

Use the currently adjudicated development data. Compare the 1B pointer model to the
recorded free-form JSON baseline.

Pass when:

- Grammar validity is 100%.
- Live evidence acceptance improves by at least 20 percentage points over 43.8%.
- Accepted normalized-price precision is 100%.
- Eligible comparable coverage is at least 50%.
- Abstention recall is at least 90%.

Limit: two hypotheses, at most $3 total. If this gate fails, do not scale the
dataset or model. Audit the pointer/input contract once, then terminate the series.

### G2: Corpus Readiness

Pass when the development corpus has:

- At least 100 registrable domains.
- At least 5,000 adjudicated product cards.
- At least 2,000 eligible comparable products.
- Explicit negatives for redirects, skeleton states, ads, recommendations,
  conditional prices, ranges, and unselected variants.
- Dual independent review for all final labels and at least a stratified 10% of
  development labels.
- A final cohort of at least 30 unseen domains with enough eligible examples to
  produce at least 3,000 accepted outputs at the target coverage.

Synthetic examples may balance rare structures but never satisfy live-domain or
final-sample requirements.

### G3: Teacher

Fine-tune T5Gemma 2 1B-1B on the frozen pointer corpus.

Pass selection when:

- Grammar validity is 100%.
- Evidence-pointer exact match is at least 98%.
- Accepted normalized-price precision is 100%.
- Eligible comparable coverage is at least 80%.
- Native-unit-price coverage is at least 95%.
- Derived-unit-price coverage is at least 75%.
- Abstention recall is at least 99%.
- Site-macro eligible coverage is at least 70%.

Limit: three controlled runs, at most $5 total.

### G4: Capacity Diagnosis

Run T5Gemma 2 4B-4B on no more than 500 adjudicated error cases only when the 1B
teacher has failed G3 and error analysis identifies a plausible capacity limit.

Approve 4B fine-tuning only if it improves evidence-pointer exact match by at least
five percentage points without a precision regression.

Limit: one diagnostic and one bounded fine-tune, at most $2 total. If 4B fails too,
classify the problem as data, representation, or objective failure rather than
continuing to increase model size.

### G5: Browser Student

Distill the frozen teacher into T5Gemma 2 270M-270M.

Pass when:

- Accepted normalized-price precision remains 100%.
- Eligible comparable coverage is within five percentage points of the teacher.
- Evidence-pointer exact match is within three percentage points of the teacher.
- Abstention recall remains at least 99%.

Limit: two distillation variants, at most $5 total. Failure ends the local-model
path; it does not authorize an open-ended architecture search.

### G6: Browser Runtime

Pass on Brave with WebGPU when:

- Quantized text-only artifact size is at most 300 MB.
- Visible-page inference p50 is at most 2 seconds.
- Visible-page inference p95 is at most 6 seconds.
- Peak incremental browser memory is at most 1.5 GB.
- The extension remains responsive and has a deterministic unavailable-model
  fallback.
- Playwright verifies correct rendering, sorting, SPA navigation, virtualized
  lists, and no page-owned control breakage on desktop and mobile fixtures.

One quantization/runtime optimization cycle is allowed after the first failure.

### G7: Final Evidence

Open the sealed final cohort once, after the student artifact and all thresholds
are frozen.

Success requires:

- At least 30 previously unseen registrable domains.
- At least 3,000 accepted comparable outputs.
- Zero incorrect displayed normalized prices.
- A one-sided 95% lower confidence bound of at least 99.9% for accepted-output
  precision.
- Eligible comparable coverage of at least 80%.
- Native-unit-price coverage of at least 95%.
- Derived-unit-price coverage of at least 75%.
- Abstention recall of at least 99%.
- Every displayed value reproducible from stored evidence and deterministic code.

This establishes 100% observed precision on the test cohort, not a universal claim
of 100% accuracy on every future page.

## Budget

Total Modal budget is $30. The working estimate is $8 already spent and must be
reconciled against the Modal meter before the next paid run. Reserve $5 for the
sealed final evaluation.

| Phase | Additional cap |
| --- | ---: |
| Formulation proof | $3 |
| 1B teacher | $5 |
| 4B capacity diagnosis | $2 |
| 270M distillation | $5 |
| Browser conversion and benchmark | $2 |
| Final evaluation reserve | $5 |

No experiment may start if its conservative projected cost would exceed either its
phase cap or the total budget.

## Stop And Retirement Rules

- A hypothesis gets at most two attempts, excluding one trivial implementation fix.
- A pilot runs for at most 15 training minutes and costs at most $0.75.
- Promote only when coverage improves by at least two percentage points with no
  safety regression, or when the result removes meaningful complexity at equal
  quality.
- Record crashes, invalid runs, and negative results. Do not silently rerun them.
- Rejected branches remain rejected unless new evidence directly addresses the
  recorded failure mechanism.
- Any cohort used to choose data, prompts, decoding, thresholds, or code is retired
  from final evaluation.
- If a gate exhausts its hypothesis, run, or budget limit, publish the failure
  analysis and stop that path.

## Quantifiable End State

The goal is complete only when G0 through G7 pass and the repository contains:

- Frozen dataset, split, and evaluation manifests with hashes.
- Reproducible Modal training and evaluation commands.
- A versioned 1B teacher and 270M browser artifact.
- Model and dataset cards documenting limitations and provenance.
- An append-only experiment ledger with metered costs.
- Unit, integration, Playwright, live-domain, latency, memory, and artifact-size
  reports.
- A Brave extension that displays only evidence-valid normalized prices and can
  sort comparable products without breaking retailer controls.

A bounded no-go report is an acceptable research outcome but is not a successful
completion of this product goal.
