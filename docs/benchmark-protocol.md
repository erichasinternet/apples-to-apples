# Live-Site Benchmark Protocol

## Objective

Measure whether the extension extracts and normalizes unit prices accurately on shopping domains that were not used to build or tune the extractor. The primary endpoint is exact normalized unit-price accuracy for products that a human reviewer determines are comparable from visible page evidence.

The corpus is not a one-time scrape. Each run is an immutable, timestamped observation because retailer markup, prices, experiments, and product ordering change continuously.

## Sampling Plan

The full benchmark target is:

- 60 independently operated shopping domains.
- Four search or category captures per domain.
- Twelve audited product cards per capture.
- 2,880 audited products in total.

At the worst-case proportion of 0.5, 2,880 observations provide a 95% interval narrower than plus or minus 1.9 percentage points if products were independent. Applying a conservative design effect of 2 for products clustered within pages and sites gives an effective target interval of approximately plus or minus 2.6 percentage points.

Domains are stratified across general marketplaces, grocery, pharmacy, warehouse clubs, pet specialists, home improvement, office supply, beauty/wellness, and independent storefront platforms. The sampling frame must include large and mid-sized retailers; popularity alone is not a valid proxy for DOM diversity.

The checked-in target manifest is wave one. Additional waves expand it to 60 domains without changing previously captured observations.

`benchmarks/live-sites/pilot-summary.json` records the first end-to-end collection and deterministic baseline. It is explicitly a single-pass pilot, not part of the gold test set.

## Split Policy

Split by domain, never by product or page:

- 30 domains for development and optional model training.
- 10 domains for model and rule selection.
- 20 domains held out as the final unknown-site test set.

No selector, prompt example, fixture, or model fine-tuning example derived from a held-out domain may be used before the final evaluation. Report both macro accuracy, where each domain receives equal weight, and micro accuracy across products.

## Capture Policy

The collector:

- Uses a fresh anonymous browser context with no saved account, cookies, address, or purchase history.
- Visits only public shopping pages and does not bypass authentication, CAPTCHAs, rate limits, or access controls.
- Captures one page at a time with a delay between requests.
- Stores a site-independent rendered-node observation, sanitized markup from the main content area, a main-content screenshot, compact candidate fragments, candidate screenshots, URLs without query strings, timestamps, and content hashes.
- Assigns stable node identifiers before serialization so every annotation can cite its exact DOM evidence.

Raw captures live under `benchmark-data/`, which is intentionally ignored by Git. Only reviewed, minimized fixtures should be promoted into the repository. Do not publish or redistribute raw retailer captures without a separate legal and privacy review.

The candidate-card sampler is retained as an annotation convenience and deterministic baseline artifact. It must not define the ground-truth denominator for learned card discovery. Gold card precision and recall are measured against every product card in the adjudicated main-content region.

Repeated candidate cards with the same canonical product path are deduplicated within a capture before convenience sampling.

## Annotation

Reviewers label every sampled product as comparable or not comparable and record:

- Product title and current price.
- Whether the card belongs to the primary result set, a secondary recommendation surface, or an unknown page region.
- Retailer-provided native unit price, when present.
- Total package quantity and dimension.
- Expected normalized price and target unit.
- Exact supporting DOM node identifiers.
- A reason whenever the product is excluded.

The final 20-domain test set is independently annotated twice and adjudicated. At least 20% of development and selection pages are also double-annotated. Report agreement for comparability and dimension labels, plus exact agreement for price, quantity, and normalized result.

An item is not comparable when the visible evidence is insufficient, the price is conditional or ranged without a selected variant, or the meaningful unit cannot be inferred without unsupported assumptions. Ambiguous items are valid negative cases and must not be silently removed.

Annotations for learned extraction also identify every product-card root in the adjudicated region. Training examples contain card roots, extracted fields, abstention reasons, and the smallest supporting evidence-node set. No model-generated label enters the gold set without human review.

## Metrics

Primary metrics:

- Product-card precision and recall.
- Exact title, current-price, native-unit-price, quantity, and dimension extraction.
- Exact normalized unit-price accuracy with a numeric tolerance of 0.5%.
- Correct abstention on unsupported products.
- Correct ascending order within each comparable dimension.

Operational metrics:

- Runtime per page and per card.
- Model invocation rate, if a model fallback is enabled.
- Download size, memory use, and inference latency.
- Blocked-page and capture-failure rates by domain.

HTTP errors, bot challenges, and empty result shells are recorded as blocked observations, not successful zero-product pages. They remain part of the operational failure-rate report but are excluded from extraction-accuracy denominators.

Use a domain-clustered bootstrap for 95% intervals. Compare deterministic and hybrid extractors on the same observations with a paired test and publish failures, not only aggregate scores.

## Model Selection And Fine-Tuning

Model work follows this order:

1. Freeze the observation and output contracts.
2. Measure a deterministic baseline.
3. Establish an achievable ceiling with a capable prompted model.
4. Compare text-only, layout-aware, and multimodal approaches on development domains.
5. Fine-tune a smaller model only after the task representation is proven.
6. Select thresholds and architecture on selection domains.
7. Run the final evaluation once on held-out domains.

An encoder-decoder fine-tune is promoted only if it improves held-out-domain exact accuracy and abstention without violating latency, memory, or privacy budgets. The model never owns arithmetic, conversion, or evidence acceptance.

## Commands

Capture a small headed pilot in a separate Chromium process:

```bash
bun run benchmark:collect -- --headed --per-site 1 --sites walmart,amazon,target,chewy
```

Capture selected sites:

```bash
bun run benchmark:collect -- --sites walmart,amazon,target
```

Validate a completed run:

```bash
bun run benchmark:validate -- benchmark-data/live/<run-id>
```

Evaluate adjudicated annotations against the deterministic extractor:

```bash
bun run benchmark:evaluate -- benchmark-data/live/<run-id>
```

During pilot development only, explicitly include single-pass annotations:

```bash
bun run benchmark:evaluate -- benchmark-data/live/<run-id> --allow-in-review
```

Validate a model output against its captured evidence:

```bash
bun run benchmark:model:validate -- \
  benchmark-data/live/<run-id>/<page-id>/observation.json \
  benchmark-data/live/<run-id>/<page-id>/model-extraction.json
```

Evaluate a complete set of page-local model outputs:

```bash
bun run benchmark:model:evaluate -- benchmark-data/live/<run-id>
```

Alternatively, keep predictions in a separate directory as `<page-id>.json`:

```bash
bun run benchmark:model:evaluate -- benchmark-data/live/<run-id> \
  --predictions benchmark-data/predictions/<model-id>
```
