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
The append-only active, final, and retired domain registry is in
[`ideal-domain-splits.json`](../benchmarks/ideal-domain-splits.json).
Unassigned acquisition candidates are added in qualification waves, beginning
with
[`qualification-wave-01.json`](../benchmarks/live-sites/qualification-wave-01.json).
Candidate sites do not enter a cohort merely because their URLs are listed.
Each domain must pass two distinct public listing pages across desktop and narrow
viewports, with at least eight candidates per page, complete observations,
privacy and provenance validation, no bot challenge, no unresolved obstruction
over 20% of the viewport, and visual review. The first sampled result is recorded
in
[`wave-01-p00.json`](../benchmarks/domain-qualification/wave-01-p00.json);
the second sample is in
[`wave-01-p01.json`](../benchmarks/domain-qualification/wave-01-p01.json).
The bounded follow-up is in
[`wave-01-p02.json`](../benchmarks/domain-qualification/wave-01-p02.json).
RestaurantSupply passed two distinct desktop and narrow pages and was promoted
to training. The next bounded slice is in
[`wave-01-p03.json`](../benchmarks/domain-qualification/wave-01-p03.json);
KaTom passed the same frozen gate and was promoted to training. All other
sampled domains remain unassigned. The final broad slice is recorded in
[`wave-01-p04.json`](../benchmarks/domain-qualification/wave-01-p04.json);
it promoted no domains. Visual review of that slice added a retroactive
requested-query evidence requirement before any affected domain was promoted.
The second 20-domain acquisition wave is in
[`qualification-wave-02.json`](../benchmarks/live-sites/qualification-wave-02.json).
Its first bounded result is recorded in
[`wave-02-p00.json`](../benchmarks/domain-qualification/wave-02-p00.json).
Jeffers Pet passed the frozen gate on mass and count searches across narrow and
desktop viewports; Global Industrial was discarded after failing rendered-query
and candidate evidence.
The next bounded result is recorded in
[`wave-02-p01.json`](../benchmarks/domain-qualification/wave-02-p01.json).
FoodServiceDirect passed the same gate on mass and volume searches after a
site-agnostic accessibility rule dismissed its help message and suppressed only
small fixed non-product chat and reCAPTCHA embeds during corpus capture.

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
- Exact node pointers for card and title, plus exact deterministic candidate
  pointers for current price (`@pN`), native unit price (`@uN`), package quantity
  (`@qN`), and pack count (`@kN`), using `NONE` where appropriate.
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

- 100% of node pointers and deterministic candidate pointers resolve in the exact
  serialized input.
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

The version 2 pointer corpus is recorded in
[`pointer-dataset-card.json`](../benchmarks/synthetic-training/pointer-dataset-card.json).
It contains 20,000 products across 652 generated structural families. All 20,000
targets were independently reparsed and resolved against their exact prompts with
zero invalid pointers. This satisfies the synthetic scale and grammar gates only;
it does not advance any live-data or model-quality gate.

The first G2 capture-pipeline pilot is recorded in
[`g2-petsmart-narrow-p00.json`](../benchmarks/capture-pilots/g2-petsmart-narrow-p00.json).
It verifies anonymous narrow-viewport capture, rendered location redaction,
machine and visual capture validation, immutable provenance, and two blinded
review queues. It contributes zero gold products until both independent human
reviews and adjudication are complete.

The first multi-page G2 review campaign is recorded in
[`g2-pilot-p00.json`](../benchmarks/review-campaigns/g2-pilot-p00.json). It
contains seven qualification-backed live pages and 92 frozen candidate card
roots across two independent blinded queues. A headed Chromium smoke test loaded
all source screenshots, constructed a card-scoped pointer, rejected a product-grid
ancestor, and rejected incomplete coverage. It still contributes zero gold
products because no independent human review or adjudication has been claimed.

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
as pointer-ready examples. It also fails on domain or page concentration,
sub-threshold independent-review agreement, exact cross-cohort observation
duplicates, and normalized-title product overlap across cohorts. DOM-template and
screenshot-perceptual duplicate checks remain required before a release export.

The domain split registry is an assignment and leakage-control frame, not evidence
that a domain is usable. Readiness counts a page only when its domain has an
explicit promotion in `benchmarks/domain-qualification/promotions.json` and its
exact capture timestamp, observation hash, and annotation-screenshot hash appear in
`benchmarks/capture-pilots/eligible-captures.json`. Legacy opened pages, captures
from unqualified domains, blocked pages, and recaptures with different hashes are
reported separately and do not advance any cohort.
