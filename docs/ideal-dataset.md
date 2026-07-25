# Ideal Evidence-Pointer Dataset

## Purpose

The dataset must teach a model to select price and quantity evidence on unfamiliar
shopping pages without teaching retailer selectors. It must also support a
credible claim that the extension abstains rather than displaying an unsupported
unit price.

The first release scope is public, English-language shopping pages using USD and
the units supported by the deterministic runtime. "Any site" means an unfamiliar
site within that declared scope. Other currencies and locales are challenge
examples that must abstain until the parser and product contract explicitly
support them.

The machine-readable targets are in
[`ideal-dataset-targets.json`](../benchmarks/ideal-dataset-targets.json).

## Cohorts

Split by registrable domain. Related storefronts, country variants, white-label
stores, duplicate templates, and captures of the same product family cannot cross
cohorts.

| Cohort | Domains | Pages | Products | Comparable | Abstentions | Use |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Training | 80 | 480 | 8,000 | 5,200 | 2,400 | Optimization |
| Internal validation | 20 | 120 | 2,000 | 1,300 | 600 | Learning curves and early stopping |
| Selection | 20 | 120 | 2,000 | 1,300 | 600 | One architecture and threshold decision |
| Final | 30 | 300 | 5,500 | 4,000 | 1,200 | Once-only release evidence |

These are minimums, not quotas to fill with duplicates. The final cohort has at
least 4,000 eligible comparable products so 80% coverage can produce the required
3,000 accepted outputs with margin.

The current 60-domain frame is development evidence. Its previous selection and
held-out domains have been opened during research and are permanently ineligible
for the new final cohort.

## Sampling

Training pages use a controlled mixture:

- 50% probability or stratified sampling from the declared shopping population.
- 30% underrepresented structure, category, unit, and evidence slices.
- 20% model-disagreement and known-failure sampling.

Internal validation, selection, and final pages are selected before their labels
are opened. They cannot be chosen because a candidate succeeds or fails on them.
Final sampling is stratified but not active-learning driven.

No domain contributes more than 5% of products in a cohort. No page contributes
more than 2% of products. Report site-macro metrics so a large marketplace cannot
dominate the result.

## Required Diversity

Comparable products must include:

- At least 20% each for mass, volume, and count.
- At least 5% each for area and length.
- Native-only, quantity-derived, and native-plus-derived evidence modes.
- Metric, US customary, and mixed-unit presentations.
- Grid, list, table, carousel, responsive, virtualized, lazy-loaded, and
  server-rendered product collections.
- Split prices, sale/list prices, multipacks, bundles, pack-of-pack quantities,
  decimal quantities, retailer-native unit prices, and conflicting visible facts.

Shopping strata include general marketplaces, grocery, pharmacy, pet, warehouse,
home improvement, office, beauty, household, independent storefronts, and
delivery marketplaces. Category diversity is measured separately from domain
diversity.

Negative coverage must include every abstention status plus non-product roots,
redirects, empty results, loading shells, sponsored modules, recommendations,
conditional prices, ranges, subscriptions, coupons, rewards, unavailable
variants, and unsupported units or currencies.

At least 20 domains are recaptured at three separated dates. At least 25% of pages
use a narrow viewport. Temporal and viewport variants stay in the same
domain-level cohort.

## Annotation Contract

Each captured page receives:

- Complete bounded-region product-root coverage.
- Product scope: primary, recommendation, sponsored, or non-product.
- Exact pointer for card, title, current price, native unit price, package
  quantity, and pack count, using `NONE` where appropriate.
- Comparability status and one normalized abstention reason.
- Deterministically recomputed normalized value for comparable products.
- Capture timestamp, locale, currency, viewport, page type, category, stratum,
  and content hashes.

All exported labels are independently reviewed twice. Annotators do not see each
other's answers. Every disagreement is adjudicated. Model preannotations may
accelerate review but are never gold without human confirmation.

Before adjudication, require:

- Comparable-status Cohen's kappa of at least 0.90.
- At least 98% exact agreement for price, quantity, and dimension.
- At least 95% exact node-pointer agreement.

After adjudication:

- 100% of pointers resolve in the exact serialized input.
- 100% of comparable records pass deterministic evidence and arithmetic checks.
- 100% of pages have complete-region coverage.
- 0% cross-cohort duplicates or near-duplicates.

Failed records are quarantined rather than coerced into valid labels.

## Synthetic Data

Synthetic data teaches the grammar and balances rare structures. Build it in
versioned batches up to 20,000 products across at least 200 generated structural
families. Each rare required pattern has at least 500 examples.

Synthetic records:

- Never count toward live domain, selection, or final targets.
- Never exceed 50% of post-warm-start training presentations.
- Must pass the same pointer and deterministic validators as live records.
- Must use generated names and structures rather than copies of held-out sites.

Compare live-only, synthetic-only, and hybrid checkpoints. Keep synthetic replay
only when it improves domain-held-out live performance without a precision
regression.

## Dataset Growth

Train learning-curve checkpoints at approximately 500, 1,500, 3,000, 5,000,
8,000, and 10,000 live development products.

Stop adding broadly sampled training data only when both conditions hold:

1. Two consecutive increments improve domain-macro accepted coverage by less than
   one percentage point and their clustered 95% intervals include zero gain.
2. Every required slice has reached its minimum and no slice is more than five
   percentage points below the aggregate accepted coverage.

Continue targeted collection for a deficient slice even if aggregate performance
has plateaued.

## Contamination And Versioning

Every release has immutable source, annotation, split, and export manifests with
SHA-256 hashes. Record all source captures, annotation revisions, preannotation
models, reviewers, adjudicators, and transformation code.

Run exact hashes plus normalized-text, canonical-product-path, DOM-template, and
screenshot-perceptual near-duplicate checks before export. Any evaluation example
used to change code, prompts, data, thresholds, or decoding is retired.

Raw retailer captures remain private and are not redistributed without separate
privacy and legal review. Account details, delivery addresses, query parameters,
cookies, and user-specific recommendations are removed during capture.

## Readiness

Audit the local capture store with:

```bash
bun run dataset:readiness
```

The command reports current eligible counts and gaps. It does not treat empty
annotation shells, discovery-only labels, single reviews, or opened held-out data
as pointer-ready examples.
