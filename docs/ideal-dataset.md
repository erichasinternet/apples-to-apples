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
The following bounded result is recorded in
[`wave-02-p02.json`](../benchmarks/domain-qualification/wave-02-p02.json).
Wasserstrom was discarded because one search redirected to a product detail page,
Shoplet was discarded because both viewports returned verification challenges, and
PureFormulas was discarded after a category landing page failed the listing gate.
[`wave-02-p03.json`](../benchmarks/domain-qualification/wave-02-p03.json) records
the next bounded result: Revival Animal Health was discarded because both search
URLs rendered its general storefront rather than requested-query listings.
[`wave-02-p04.json`](../benchmarks/domain-qualification/wave-02-p04.json) records
Betty Mills passing the frozen count and volume gate across narrow and desktop
viewports; CleanFreak was discarded after both searches redirected to Google.
[`wave-02-p05.json`](../benchmarks/domain-qualification/wave-02-p05.json) records
PetEdge and Hardware World failing the two-page gate because of obstructed evidence
and non-query storefront results, respectively.
[`wave-02-p06.json`](../benchmarks/domain-qualification/wave-02-p06.json) records
LionsDeal returning no-result pages and Lambert Vet Supply passing the mass and
count gate after the generic obstruction detector learned to ignore an inert,
transparent, pointerless notification container.
[`wave-02-p07.json`](../benchmarks/domain-qualification/wave-02-p07.json) records
Natural Healthy Concepts and Supplement Warehouse passing the mass and count gate
after generic refusal-action handling and final pre-screenshot obstruction
measurement removed stale overlay failures.

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

The current domain frame is development evidence. Its previous selection and
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

The initial multi-page G2 review campaign is recorded in
[`g2-pilot-p00.json`](../benchmarks/review-campaigns/g2-pilot-p00.json). It
contains 53 qualification-backed live pages and 460 frozen candidate card
roots across two independent blinded queues. A headed Chromium smoke test loaded
all source screenshots, constructed a card-scoped pointer, rejected a product-grid
ancestor, and rejected incomplete coverage. It still contributes zero gold
products because no independent human review or adjudication has been claimed.

The append-only
[`g2-pilot-p01.json`](../benchmarks/review-campaigns/g2-pilot-p01.json)
campaign extends that evidence to 59 pages and 532 frozen candidate roots after
wave 06. Its report is generated from the paired queue files, source queue
hashes, eligible-capture registry, and a headed Chromium validation that loaded
all 59 screenshots with zero console errors. Both independent reviewer queues
remain empty, so the expanded campaign also contributes zero gold products.

The subsequent
[`g2-pilot-p02.json`](../benchmarks/review-campaigns/g2-pilot-p02.json)
campaign adds the four wave-07 pages for 63 pages and 580 frozen candidate roots.
A headed Chromium sweep loaded every screenshot, exposed only the frozen card
roots, rejected non-candidate navigation and incomplete coverage, produced zero
console errors, and wrote zero review files. Both independent queues remain
empty and therefore still contribute zero gold products.

The final wave-02 qualification pass promoted Blue Sky Vitamin and discarded
Professional Supplement Center, Sleekshop, Bob's Red Mill, and Bulk Foods with
captured evidence. It also narrowed search-query relevance to visible search
context instead of arbitrary product-card text, preventing unfiltered catalogs
from passing because an incidental card contained the query token.

Wave 03 promoted Fabric Wholesale Direct, OnTime Supplies, Vitality Medical, and
Allegro Medical. The new evidence adds fabric sold by length, office-supply
multipacks, and medical-supply count and variant cases. A live Mood Fabrics
capture also proved that a populated search input is not sufficient evidence of
a rendered result page, so query qualification now requires every requested token
in the title, pathname, visible heading, or visible status text.

Wave 04 promoted Wholesale Janitorial Supply and The Cary Company. Their four
pages add detergent mass and volume, paper-product roll and sheet multipacks,
bottle capacities, and quantity-tier price tables. The narrow Cary capture also
exposed a generic consent-action gap; the collector now recognizes and persists
an `Accept All Cookies` choice without any hostname or DOM selector override.

Wave 05 promoted Starwest Botanicals and Coffee Bean Corral. Their four pages add
botanical and green-coffee layouts with price ranges, hidden package variants,
and clean price-only cards that require abstention when quantity evidence is not
present. The screen also visually rejected a false-positive category-link page
that had passed the numeric candidate gate, preserving visual review as a
required qualification step.

Wave 06 promoted Fabricworm, Wholesale Marine, and Fabric Mart Fabrics. Their six
pages add desktop and narrow fabric grids, explicit per-yard sale prices,
per-foot rope listings, and price-only length products that require abstention.
The first screen sampled 17 new domains; exact page-ID follow-ups prevented a
random per-site sampler from accidentally repeating a query during qualification.
Packaging Price failed because its distinct second page timed out, and Stone &
Tile Shoppe failed because an unresolved obstruction covered 23% of its narrow
viewport, above the frozen 20% limit. Neither near-pass was promoted.

Wave 07 screened 21 previously unseen domains across all five dimensions and
nine strata, prioritizing count and area candidates. Greatmats qualified with
desktop and narrow flooring grids that expose carton or tile prices beside
per-square-foot prices. Seattle Fabrics qualified with desktop and narrow
per-yard listings plus fixed-price sample packs and full-roll variants. The
other 19 domains remain discarded after timeouts, invalid routes, cross-site
redirects, missing query evidence, missing screenshots, obstructions, or
insufficient product candidates. The four accepted pages raise the immutable
eligible-capture registry to 63 pages across 22 promoted training domains.

Use `--pages` for reproducible follow-up captures:

```bash
bun scripts/collect-live-corpus.ts \
  --targets benchmarks/live-sites/qualification-wave-06.json \
  --pages fabricworm--cotton-fabric \
  --viewport narrow \
  --headed
```

Exact page targeting cannot be combined with the random `--sites`, `--limit`, or
`--per-site` samplers.

Qualified expansion wave 01 sampled one new query on each of the 17 promoted
training domains. Nine of 17 pages passed bounded headed capture, provenance,
candidate-count, query-evidence, and visual product-grid checks. Six timed out,
one exposed only six candidates, and KaTom's coffee-filter search was visually
rejected because most captured cards were water-filtration equipment. The nine
accepted pages add dog food, puppy pads, fish oil, collagen, hand soap, adult
briefs, rice, copy paper, and wound dressings without claiming any new domain
qualification.

Qualified expansion wave 02 sampled 18 additional queries across nine promoted
domains. Twelve pages completed bounded headed capture and 11 passed provenance,
candidate-count, query-evidence, card-text, price, and visual product-grid checks.
Six pages timed out, and the Supplement Warehouse creatine page was rejected
because an open mobile filter sheet obscured the evidence. The accepted pages add
syringes, underpads, disposable cups, magnesium, collagen, trash bags, floor
cleaners, and fish oil. Related accessories within valid result grids remain
frozen as deliberate abstention examples rather than being silently removed.

A deterministic preannotation audit over all 460 campaign cards is recorded in
[`g2-campaign-preannotation-p00.json`](../benchmarks/reviews/g2-campaign-preannotation-p00.json).
Conditioning derived extraction on the capture's intended comparison dimension
reduced tentative comparables from 143 to 84 and evidence-invalid outputs from
34 to 20. A separate semantic quarantine retained only 54 comparable suggestions
and identified equipment capacity, lost decimal separators, and ungrounded
numbers as concrete failure modes. The entire artifact remains ineligible for
silver training and benchmark gold because deterministic agreement is not an
independent semantic review.

The append-only 580-card rerun is recorded in
[`g2-campaign-preannotation-p01.json`](../benchmarks/reviews/g2-campaign-preannotation-p01.json).
It adds the wave-06 and wave-07 evidence, recognizes yard and common square-foot
spellings, grounds strictly paired price and per-unit sibling nodes, and prefers
semantic product links over image descriptions. The pass produced 173 tentative
comparables and 407 abstentions. Evidence validation rejected four records, and
the semantic audit retained 157 comparable suggestions while quarantining 16.
The raw artifact remains ineligible for both silver training and benchmark gold:
all 580 cards are still unreviewed, and deterministic checks cannot substitute
for two independent reviews and adjudication.

Wave 08 adds PureBulk after two exact, visually inspected captures passed the
frozen qualification gate: a narrow protein-powder grid and a desktop
magnesium-powder grid. Each page contributes ten frozen product roots, including
bulk-size variants, while article results below the product grid remain useful
non-candidate evidence. The eligible live campaign now spans 23 newly qualified
training domains, 65 pages, and 600 frozen roots. All 600 roots remain
ineligible for silver training and benchmark gold until two independent blinded
reviews and adjudication are complete.

The expanded blinded campaign and headed workbench evidence are frozen in
[`g2-pilot-p03.json`](../benchmarks/review-campaigns/g2-pilot-p03.json).
All 65 screenshots loaded, all 600 offered choices matched the captured card
roots, invalid submissions were rejected, no console errors occurred, and no
review files were written by validation. The matching deterministic diagnostic
is recorded in
[`g2-campaign-preannotation-p02.json`](../benchmarks/reviews/g2-campaign-preannotation-p02.json);
it retains 584 of 600 suggestions after semantic quarantine but promotes none.
The compact representation audit in
[`g2-selection-representation-p01.json`](../benchmarks/reviews/g2-selection-representation-p01.json)
round-trips all 584 retained suggestions exactly with zero failures across 65
pages and 23 sites. This establishes serialization compatibility only, not label
correctness.

A second Wave 08 pass qualifies Search for Fabric and Paracord Planet with two
visually inspected pages and both viewport profiles per domain. It adds 43
length-dimension roots, bringing the current campaign to 25 qualified training
domains, 69 pages, and 643 frozen roots. The append-only campaign is recorded in
[`g2-pilot-p04.json`](../benchmarks/review-campaigns/g2-pilot-p04.json), and its
headed sweep loaded all 69 screenshots and all 643 frozen roots with no console
errors or review writes. The deterministic diagnostic in
[`g2-campaign-preannotation-p03.json`](../benchmarks/reviews/g2-campaign-preannotation-p03.json)
abstains on 42 of the 43 new roots and quarantines its only tentative comparable.
This failure on unfamiliar length layouts is retained as evidence for human
annotation rather than hidden through site-specific extraction changes. The
selection representation still round-trips all 626 machine-audit-passing
records exactly in
[`g2-selection-representation-p02.json`](../benchmarks/reviews/g2-selection-representation-p02.json).

The final Wave 08 pass qualifies Atwood Rope, MoreBeer, and Northern Brewer and
records explicit failures for the six remaining candidates. Wave 08 therefore
ends with a complete disposition of all 20 candidate domains: six promoted and
14 rejected. The current blinded campaign in
[`g2-pilot-p05.json`](../benchmarks/review-campaigns/g2-pilot-p05.json)
contains 28 qualified training domains, 75 pages, and 710 frozen roots. Its
headed sweep loaded every screenshot and root with no console errors or review
writes. The new captures deliberately retain non-product and wrong-product
results such as articles, grain mills, and equipment kits. The diagnostic in
[`g2-campaign-preannotation-p04.json`](../benchmarks/reviews/g2-campaign-preannotation-p04.json)
produces 191 tentative comparables and 519 abstentions, with 17 comparables
quarantined. The compact representation audit in
[`g2-selection-representation-p03.json`](../benchmarks/reviews/g2-selection-representation-p03.json)
round-trips all 693 retained suggestions exactly across 75 pages and 28 sites.
All 710 roots remain unreviewed and ineligible for training or benchmark gold.

Wave 09 qualifies Detail King, Kleen-Rite, and ProSource Wholesale and records
explicit failures for the other 17 candidates. The three unfamiliar domains add
two volume storefronts and one area storefront, including hidden-size variants,
price-absent products, and mixed product negatives. The frozen campaign in
[`g2-pilot-p06.json`](../benchmarks/review-campaigns/g2-pilot-p06.json)
contains 31 qualified training domains, 81 pages, and 762 roots. Its headed
workbench sweep loaded all 81 screenshots and all 762 frozen roots, rejected
non-candidate and incomplete submissions, emitted no console errors, and wrote
no review files.

Live qualification exposed two generic page-preparation defects. Offscreen
fixed drawers could be toggled by close-labelled controls, and transparent
pointerless shells could inherit visible paint from small descendants and be
misclassified as full-screen obstructions. The collector now requires
viewport-intersecting dismissal controls inside a qualifying container and
measures an obstruction shell's own paint. Regression tests cover both cases.
The diagnostic in
[`g2-campaign-preannotation-p05.json`](../benchmarks/reviews/g2-campaign-preannotation-p05.json)
abstains on all 52 new roots. The compact representation audit in
[`g2-selection-representation-p04.json`](../benchmarks/reviews/g2-selection-representation-p04.json)
round-trips all 745 retained suggestions exactly with zero failures across 81
pages and 31 sites. These results remain diagnostic only: all 762 roots are
unreviewed and ineligible for training or benchmark gold.

Wave 10 screens 20 further unseen domains across all five dimensions and 12
strata, then qualifies Pool Geek on two visually inspected product grids. The
other 19 candidates receive explicit bounded failure dispositions, including
timeouts, dead search routes, unresolved obstruction, empty results, and
semantically irrelevant recommendation grids. The blinded campaign in
[`g2-pilot-p07.json`](../benchmarks/review-campaigns/g2-pilot-p07.json)
contains 32 qualified training domains, 83 pages, and 778 frozen roots. Its
headed workbench sweep loads every screenshot and root with no console errors
or review writes.

Pool Geek adds eight volume and eight mass roots where titles and prices are
DOM-visible but package sizes are commonly visible only on product imagery. The
diagnostic in
[`g2-campaign-preannotation-p06.json`](../benchmarks/reviews/g2-campaign-preannotation-p06.json)
correctly retains all 16 as abstentions rather than inventing DOM evidence. The
compact audit in
[`g2-selection-representation-p05.json`](../benchmarks/reviews/g2-selection-representation-p05.json)
round-trips all 761 machine-retained suggestions exactly across 83 pages and 32
sites. The image-dependent cases are preserved for independent human review to
measure whether the eventual model needs a multimodal evidence path.

Wave 11 screens 20 additional unseen domains, 40 target routes, all five
comparison dimensions, and 20 source strata. Alan Janitorial is the only
promotion: two visually inspected product grids contribute 16 volume roots with
explicit gallon, quart, and ounce quantities in DOM-visible titles. The other
19 candidates have explicit bounded failure dispositions, including insufficient
candidate counts, severe obstruction, privacy-audit failure, invalid TLS,
timeouts, dead search routes, and pages without query-relevant product evidence.

The resulting paired blinded campaign in
[`g2-pilot-p08.json`](../benchmarks/review-campaigns/g2-pilot-p08.json)
contains 33 qualified training domains, 85 pages, and 794 frozen roots. Its
headed workbench sweep loaded every screenshot and root, enforced only frozen
evidence choices, rejected invalid and incomplete submissions, emitted no
console errors, and wrote no review files. The diagnostic in
[`g2-campaign-preannotation-p07.json`](../benchmarks/reviews/g2-campaign-preannotation-p07.json)
finds 12 tentative comparables and four abstentions among the new Alan roots.
The compact representation audit in
[`g2-selection-representation-p06.json`](../benchmarks/reviews/g2-selection-representation-p06.json)
round-trips all 777 machine-retained suggestions exactly with zero failures
across the full campaign. All 794 roots and machine suggestions remain
unreviewed and ineligible for silver training or benchmark gold.

Wave 12 screens 20 further unfamiliar domains across 20 new strata, balanced
equally across area, count, length, mass, and volume. Paracord Galaxy and Utility
Direct qualify on two visually inspected pages and distinct viewport profiles
each. The other 18 domains receive explicit bounded failure dispositions;
notably, Car Supplies Warehouse is rejected even though one page passed because
its required second page timed out. The four accepted length pages add explicit
fixed-foot cord, per-foot rope, fixed slings, price ranges, and incomplete
comparison evidence.

The paired blinded campaign in
[`g2-pilot-p09.json`](../benchmarks/review-campaigns/g2-pilot-p09.json)
contains 35 qualified training domains, 89 pages, and 826 frozen roots. Its
headed workbench sweep loaded every screenshot and root, offered only frozen
card choices, rejected invalid and incomplete submissions, emitted no console
errors, and wrote no review files. The diagnostic in
[`g2-campaign-preannotation-p08.json`](../benchmarks/reviews/g2-campaign-preannotation-p08.json)
finds eight tentative comparables and eight abstentions for Paracord Galaxy, plus
two tentative comparables and 14 abstentions for Utility Direct. The semantic
audit quarantines both Utility Direct comparables as physical-dimension risks.
The compact audit in
[`g2-selection-representation-p07.json`](../benchmarks/reviews/g2-selection-representation-p07.json)
round-trips all 807 retained suggestions exactly. These artifacts remain
unreviewed and ineligible for silver training or benchmark gold.

Qualified expansion wave 3 revisits 20 already-promoted domains to strengthen
the underrepresented volume slice without changing domain splits. Eleven
visually inspected pages pass: ten volume-oriented pages contribute 116 roots
across supplements, medical cleansers, commercial chemicals, case-pack food,
pool treatment, and a deliberate container-capacity hard negative; one flooring
page contributes 12 area roots. Eight targets are rejected for bounded capture
failures or obstruction, and one three-product page is rejected for insufficient
candidate coverage.

The expanded paired campaign in
[`g2-pilot-p10.json`](../benchmarks/review-campaigns/g2-pilot-p10.json)
contains 35 qualified training domains, 100 pages, and 954 frozen roots. Its
headed workbench sweep loaded every screenshot and root, offered only frozen
card choices, rejected invalid and incomplete submissions, emitted no console
errors, and wrote no review files. The diagnostic in
[`g2-campaign-preannotation-p09.json`](../benchmarks/reviews/g2-campaign-preannotation-p09.json)
finds 17 tentative comparables and 111 abstentions among the 128 new roots. The
container-capacity hard negatives remain abstained and the expansion introduces
no new semantic quarantines. The compact audit in
[`g2-selection-representation-p08.json`](../benchmarks/reviews/g2-selection-representation-p08.json)
round-trips all 935 machine-retained suggestions exactly with zero failures.
All 954 roots and machine suggestions remain unreviewed and ineligible for
silver training or benchmark gold.

The paired campaign is deterministically partitioned into ten matching
ten-page reviewer assignments in
[`g2-pilot-p10-review-batches.json`](../benchmarks/reviews/g2-pilot-p10-review-batches.json).
Review identities, review IDs, frozen card roots, source hashes, and blinding
remain unchanged, so batch submissions can be audited against the full
campaign. A headed sweep of every batch is recorded in
[`g2-pilot-p10-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p10-review-batch-validation.json):
all 100 screenshots and 954 roots load from the rebased paths with zero console
errors or writes, and invalid or incomplete submissions remain rejected.

Wave 13 screens 15 genuinely new domains after excluding five repeated domains
from the canonical registry while preserving the exact original screening
manifest for provenance. Discount School Supply, MySpicer, and Rockywoods
qualify on two visually inspected pages and distinct viewport profiles each.
The other 12 candidates receive explicit bounded failure dispositions for
blocked routes, invalid TLS, unresolved DNS, incomplete query evidence, or
timeouts. The six accepted pages add 67 roots: 24 count-oriented education
supply cards, 23 wholesale-spice variant hard negatives, and 20 explicit
sold-per-yard fabric and webbing cards.

The paired blinded campaign in
[`g2-pilot-p11.json`](../benchmarks/review-campaigns/g2-pilot-p11.json)
contains 38 qualified training domains, 106 pages, and 1,021 frozen roots. A
headed workbench sweep loaded every screenshot and root, enforced only frozen
evidence choices, rejected invalid and incomplete submissions, emitted no
console errors, and wrote no review files. The diagnostic in
[`g2-campaign-preannotation-p10.json`](../benchmarks/reviews/g2-campaign-preannotation-p10.json)
finds 20 tentative comparables on Rockywoods and conservatively abstains on all
47 Discount School Supply and MySpicer hard negatives. The semantic audit adds
no new quarantines. The compact audit in
[`g2-selection-representation-p09.json`](../benchmarks/reviews/g2-selection-representation-p09.json)
round-trips all 1,002 machine-retained suggestions exactly with zero failures.

The p11 campaign is deterministically partitioned into eleven matching reviewer
assignments in
[`g2-pilot-p11-review-batches.json`](../benchmarks/reviews/g2-pilot-p11-review-batches.json).
The headed validation recorded in
[`g2-pilot-p11-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p11-review-batch-validation.json)
loads all 106 screenshots and 1,021 roots from rebased paths with zero console
errors or writes. All pages and machine suggestions remain unreviewed and
ineligible for silver training or benchmark gold.

Wave 14 screens 20 genuinely new domains balanced across all five unit
dimensions. A capture-contract regression was found and fixed: explicit
`querySlug` routes are now preserved verbatim and constrained to HTTPS on the
declared hostname instead of being silently regenerated from query text.
CarPro US, Superior Products, Georgia Carpet, and Autogeek qualify on two
visually inspected pages and distinct viewport profiles each. Delayed modal
overlays on World Spice and Cali Fabrics are rejected by visual review even
where the machine obstruction estimate was permissive; the remaining failures
receive bounded dispositions for obstruction, insufficient candidates,
irrelevant results, or timeouts.

The paired blinded campaign in
[`g2-pilot-p12.json`](../benchmarks/review-campaigns/g2-pilot-p12.json)
contains 42 qualified training domains, 114 pages, and 1,109 frozen roots. The
88-root expansion adds 70 volume-conditioned automotive and professional
cleaning cards plus 18 deliberately noisy area-conditioned flooring cards. The
diagnostic in
[`g2-campaign-preannotation-p11.json`](../benchmarks/reviews/g2-campaign-preannotation-p11.json)
finds 18 tentative comparables and 70 abstentions in the expansion, with no new
semantic quarantines. The compact audit in
[`g2-selection-representation-p10.json`](../benchmarks/reviews/g2-selection-representation-p10.json)
round-trips all 1,090 machine-retained suggestions exactly with zero failures.

The p12 campaign is deterministically partitioned into 12 matching reviewer
assignments in
[`g2-pilot-p12-review-batches.json`](../benchmarks/reviews/g2-pilot-p12-review-batches.json).
The headed validation recorded in
[`g2-pilot-p12-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p12-review-batch-validation.json)
loads all 114 screenshots and 1,109 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 15 screens 20 more unfamiliar domains across all five unit dimensions.
American Spice, Blowout Medical, Ethos Car Care, Grayline Medical, Medicaleshop,
The Flooring Store, and Zelouf Fabrics qualify on two visually inspected pages
in distinct viewport profiles. The accepted evidence deliberately combines
explicit gallon and square-foot pricing with difficult price-only, range-price,
option-dependent, and missing-sell-unit cards. The Rag Company is rejected
after visual inspection found a cart drawer obscuring product evidence despite
a permissive machine obstruction estimate; every other rejected domain has a
bounded disposition for timeout, redirect, obstruction, missing screenshot,
irrelevant results, or insufficient candidates.

The paired blinded campaign in
[`g2-pilot-p13.json`](../benchmarks/review-campaigns/g2-pilot-p13.json)
contains 49 qualified training domains, 128 pages, and 1,277 frozen roots. The
168-root expansion contributes four tentative comparables and 164 abstentions.
The diagnostic in
[`g2-campaign-preannotation-p12.json`](../benchmarks/reviews/g2-campaign-preannotation-p12.json)
retains 1,258 machine suggestions and quarantines 19 known semantic traps. The
compact audit in
[`g2-selection-representation-p11.json`](../benchmarks/reviews/g2-selection-representation-p11.json)
round-trips all 1,258 retained suggestions exactly with zero failures.

The p13 campaign is deterministically partitioned into 13 matching reviewer
assignments in
[`g2-pilot-p13-review-batches.json`](../benchmarks/reviews/g2-pilot-p13-review-batches.json).
The headed validation recorded in
[`g2-pilot-p13-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p13-review-batch-validation.json)
loads all 128 screenshots and 1,277 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 16 screens 20 additional unfamiliar domains across all five unit
dimensions. Rehabmart, P&S Detail Products, Blackbird Fabrics, Flooret, and
Core Fabrics qualify on two visually inspected pages in distinct viewport
profiles. The accepted evidence adds explicit count and per-length listings,
option-dependent automotive products, and flooring sample cards whose physical
dimensions must not be mistaken for a sell-unit area price. The initial
`--limit 20` run was found to sample targets rather than guarantee one target
per domain; that run is retained only as bounded screening evidence, all
follow-ups use explicit page IDs, and no unobserved target is inferred as
passing.

The paired blinded campaign in
[`g2-pilot-p14.json`](../benchmarks/review-campaigns/g2-pilot-p14.json)
contains 54 qualified training domains, 138 pages, and 1,389 frozen roots. The
112-root expansion contributes one tentative comparable and 111 abstentions.
The diagnostic in
[`g2-campaign-preannotation-p13.json`](../benchmarks/reviews/g2-campaign-preannotation-p13.json)
retains 1,370 machine suggestions and quarantines the same 19 known semantic
traps. The compact audit in
[`g2-selection-representation-p12.json`](../benchmarks/reviews/g2-selection-representation-p12.json)
round-trips all 1,370 retained suggestions exactly with zero failures.

The p14 campaign is deterministically partitioned into 14 matching reviewer
assignments in
[`g2-pilot-p14-review-batches.json`](../benchmarks/reviews/g2-pilot-p14-review-batches.json).
The headed validation recorded in
[`g2-pilot-p14-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p14-review-batch-validation.json)
loads all 138 screenshots and 1,389 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 17 screens 20 additional unfamiliar domains across all five unit
dimensions. Obsessed Garage, MedSurg Express, Mountainside Medical, Jax Wax,
and TileOn qualify on two visually inspected listing pages in opposite viewport
profiles. All ten accepted pages were recaptured against the same final
qualification-manifest hash after exploratory Fabrics-Store routes were rejected,
so no provisional provenance enters the eligible registry. The accepted
evidence adds case and box counts, physical-dimension hard negatives,
option-dependent automotive products, explicit square-foot prices, and
abstention-heavy listings. Two Obsessed Garage narrow roots are partly covered
by floating widgets and remain review-time abstention candidates rather than
silently trusted labels.

The paired blinded campaign in
[`g2-pilot-p15.json`](../benchmarks/review-campaigns/g2-pilot-p15.json)
contains 59 qualified training domains, 148 pages, and 1,509 frozen roots. Its
deterministic preannotation contains 298 tentative comparables, 1,211 explicit
abstentions, and four invalid suggestions. The semantic diagnostic in
[`g2-campaign-preannotation-p14.json`](../benchmarks/reviews/g2-campaign-preannotation-p14.json)
retains 1,490 suggestions, quarantines the same 19 known semantic traps, and
marks no suggestion as silver or gold. The compact audit in
[`g2-selection-representation-p13.json`](../benchmarks/reviews/g2-selection-representation-p13.json)
round-trips all 1,490 retained suggestions exactly with zero failures.

The p15 campaign is deterministically partitioned into 15 matching reviewer
assignments in
[`g2-pilot-p15-review-batches.json`](../benchmarks/reviews/g2-pilot-p15-review-batches.json).
The headed validation recorded in
[`g2-pilot-p15-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p15-review-batch-validation.json)
loads all 148 screenshots and 1,509 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 18 screens 20 more unfamiliar candidates across all five unit dimensions.
Armour Detail Supply, Food to Live, Medex Supply, and Spandex House qualify on
two visually inspected listing pages in opposite viewport profiles. Duplicate
IDs and hostnames discovered during registry validation were replaced before
promotion, and all eight accepted pages were recaptured against the same final
manifest hash. The accepted evidence adds starting-price variants, specialty
food layouts, medical case and dimension hard negatives, fabric-width traps,
and 96 frozen roots. Floating widgets affect isolated narrow cards only; those
roots remain review-time abstention candidates.

The paired blinded campaign in
[`g2-pilot-p16.json`](../benchmarks/review-campaigns/g2-pilot-p16.json)
contains 63 qualified training domains, 156 pages, and 1,605 frozen roots. Its
deterministic preannotation contains 300 tentative comparables, 1,305 explicit
abstentions, and four invalid suggestions. The semantic diagnostic in
[`g2-campaign-preannotation-p15.json`](../benchmarks/reviews/g2-campaign-preannotation-p15.json)
retains 1,586 suggestions, quarantines the same 19 known semantic traps, and
marks no suggestion as silver or gold. The compact audit in
[`g2-selection-representation-p14.json`](../benchmarks/reviews/g2-selection-representation-p14.json)
round-trips all 1,586 retained suggestions exactly with zero failures.

The p16 campaign is deterministically partitioned into 16 matching reviewer
assignments in
[`g2-pilot-p16-review-batches.json`](../benchmarks/reviews/g2-pilot-p16-review-batches.json).
The headed validation recorded in
[`g2-pilot-p16-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p16-review-batch-validation.json)
loads all 156 screenshots and 1,605 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 19 screens 20 additional unfamiliar candidates across all five unit
dimensions. Whole Spice, Yeager's Detailing Supplies, Turtle Wax, Medical
Supply Group, The Fabric Co, LA Silk Fabric, Rope and Cord, The Fabric Market,
Tile and Mosaic Depot, and Tilezz qualify on two visually inspected listing
pages in opposite viewport profiles. Rejected, empty, blocked, low-root, and
provenance-colliding routes were replaced before promotion, and every accepted
page was captured against the same final manifest hash. The 20 accepted pages
add 240 frozen roots spanning sampler and starting-price variants, equipment
capacity, physical dimensions, sheets, boxes, pieces, kits, irrelevant
query-adjacent products, and floating-widget hard negatives.

The paired blinded campaign in
[`g2-pilot-p17.json`](../benchmarks/review-campaigns/g2-pilot-p17.json)
contains 73 qualified training domains, 176 pages, and 1,845 frozen roots. Its
deterministic preannotation contains 339 tentative comparables, 1,506 explicit
abstentions, and four invalid suggestions. The semantic diagnostic in
[`g2-campaign-preannotation-p16.json`](../benchmarks/reviews/g2-campaign-preannotation-p16.json)
retains 1,821 suggestions and quarantines 24 semantic traps, including five new
equipment-capacity cases. The compact audit in
[`g2-selection-representation-p15.json`](../benchmarks/reviews/g2-selection-representation-p15.json)
round-trips all 1,821 retained suggestions exactly with zero failures. None of
these machine suggestions is silver or gold.

The p17 campaign is deterministically partitioned into 18 matching reviewer
assignments in
[`g2-pilot-p17-review-batches.json`](../benchmarks/reviews/g2-pilot-p17-review-batches.json).
The headed validation recorded in
[`g2-pilot-p17-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p17-review-batch-validation.json)
loads all 176 screenshots and 1,845 roots with zero console errors or writes.
All roots and machine suggestions remain unreviewed and ineligible for silver
training or benchmark gold.

Wave 20 screens 20 additional unfamiliar candidates across all five unit
dimensions. Bulk Priced Food Shoppe, MD Supplies, Tile Generation, MexGrocer,
Tiles Direct, Foods of Nations, and Artwalk Tile qualify on two visually
inspected listing pages in opposite viewport profiles. Every accepted page has
full query-token coverage, at least eight frozen roots, complete screenshots,
an untruncated observation, and the same final qualification-manifest and
collector hashes. The 14 accepted pages add 159 roots spanning package mass,
medical counts, square-foot and each pricing, starting prices, physical
dimensions, samples, mixed result types, and query-adjacent hard negatives.

The generic collector was hardened during live screening without introducing
site-specific selectors. Page-evaluated scans no longer rely on mutable
`Array.prototype.entries`, result-summary text can supply explicit query
evidence, scored linked result candidates are considered when semantic
containers are absent, SVG text access is guarded, and small accessible chat
embeds remain subject to the existing obstruction limit. Regression tests
cover the iterator mutation, result-summary evidence, and chat-widget cases.

The paired blinded campaign in
[`g2-pilot-p18.json`](../benchmarks/review-campaigns/g2-pilot-p18.json)
contains 80 qualified training domains, 190 pages, and 2,004 frozen roots,
reaching the planned training-domain coverage gate. Its deterministic
preannotation contains 392 tentative comparables, 1,612 explicit abstentions,
and four invalid suggestions. The semantic diagnostic in
[`g2-campaign-preannotation-p17.json`](../benchmarks/reviews/g2-campaign-preannotation-p17.json)
retains 1,980 suggestions, quarantines 24 semantic traps, and marks no
suggestion as silver or gold. The compact audit in
[`g2-selection-representation-p16.json`](../benchmarks/reviews/g2-selection-representation-p16.json)
round-trips all 1,980 retained suggestions exactly with zero failures.

The p18 campaign is deterministically partitioned into 19 matching reviewer
assignments in
[`g2-pilot-p18-review-batches.json`](../benchmarks/reviews/g2-pilot-p18-review-batches.json).
The full campaign and every reviewer-A batch were validated in headed
Playwright Chromium. The aggregate evidence in
[`g2-pilot-p18-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p18-review-batch-validation.json)
loads all 190 screenshots and 2,004 roots with zero console errors or writes.
The domain gate is complete, but all roots and machine suggestions remain
unreviewed and ineligible for silver training or benchmark gold.

Training depth wave 01 tests whether qualified domains can supply additional
unseen listing evidence without adding site-specific selectors. Sixteen of 20
attempted query pages across ten existing training domains pass the frozen
machine gates and full-page visual inspection, an 80% page yield. The four
rejections are one blocked annotation and three navigation timeouts. The
accepted set adds 189 roots across all five dimensions, including explicit
per-yard and per-square-foot pricing, count-versus-physical-dimension ambiguity,
package kits, lazy-image abstentions, and adjacent-result hard negatives. The
immutable evidence and decision are recorded in
[`g2-training-depth-wave-01-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-01-p00.json).
The reusable `dataset:depth:promote` command validates provenance, frozen gates,
domain promotion, and corpus-wide observation uniqueness before updating this
registry.

The paired blinded campaign in
[`g2-pilot-p19.json`](../benchmarks/review-campaigns/g2-pilot-p19.json)
contains the same 80 qualified training domains, 206 pages, and 2,193 frozen
roots. Its deterministic preannotation contains 446 tentative comparables,
1,747 explicit abstentions, and four invalid suggestions. The semantic
diagnostic in
[`g2-campaign-preannotation-p18.json`](../benchmarks/reviews/g2-campaign-preannotation-p18.json)
retains 2,162 suggestions and quarantines 31 traps. The compact representation
audit in
[`g2-selection-representation-p17.json`](../benchmarks/reviews/g2-selection-representation-p17.json)
round-trips all 2,162 retained suggestions exactly with zero failures.

The p19 campaign is deterministically partitioned into 21 matching reviewer
assignments in
[`g2-pilot-p19-review-batches.json`](../benchmarks/reviews/g2-pilot-p19-review-batches.json).
The full campaign and every reviewer-A batch were validated in headed
Playwright Chromium. The aggregate evidence in
[`g2-pilot-p19-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p19-review-batch-validation.json)
loads all 206 screenshots and 2,193 roots with zero console errors or writes.
Readiness now counts 206 of 480 required training pages, including 102 narrow
pages, 113 categories, and 67 strata. All roots and machine suggestions remain
unreviewed and ineligible for silver training or benchmark gold.

Training depth wave 02 adds 29 of 40 attempted unseen query pages across 20
qualified training domains, a 72.5% page yield. Thirty attempts captured
successfully; one was rejected for exposing only seven candidate roots, while
two were blocked and eight timed out. All 29 accepted annotation views passed
manual visual inspection and add 341 frozen roots across mass, volume, count,
length, and area. The evidence includes explicit per-yard and per-square-foot
prices, package-count versus physical-dimension traps, starting prices, ranges,
sales, kits, samples, semantic hard negatives, and listings that require
abstention. The immutable evidence and decision are recorded in
[`g2-training-depth-wave-02-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-02-p00.json).

The paired blinded
[`g2-pilot-p20.json`](../benchmarks/review-campaigns/g2-pilot-p20.json)
campaign now contains 235 pages and 2,534 frozen roots from the same 80
qualified training domains. Deterministic preannotation proposes 531
comparables and 2,003 abstentions, including four invalid suggestions. The
semantic diagnostic in
[`g2-campaign-preannotation-p19.json`](../benchmarks/reviews/g2-campaign-preannotation-p19.json)
retains 2,501 suggestions and quarantines 33 traps. The representation audit in
[`g2-selection-representation-p18.json`](../benchmarks/reviews/g2-selection-representation-p18.json)
round-trips all 2,501 retained suggestions exactly with zero failures.

The p20 campaign is partitioned into 24 paired assignments in
[`g2-pilot-p20-review-batches.json`](../benchmarks/reviews/g2-pilot-p20-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p20-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p20-review-batch-validation.json)
loads all 235 screenshots and 2,534 roots with zero console errors or review
writes. Readiness now counts 235 of 480 required training pages, including 117
narrow pages, 123 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 03 adds 27 of 40 attempted unseen query pages across 20
qualified training domains, a 67.5% page yield. Twenty-eight attempts captured
successfully; one was rejected for exposing only six candidate roots, while one
was blocked and eleven ended in navigation or capture errors. All 27 accepted
annotation views passed manual visual inspection and add 313 frozen roots across
mass, volume, count, length, and area. The evidence includes per-half-meter and
per-meter pricing, per-box and per-sheet offers without coverage, hidden package
options, package-count versus physical-dimension and capacity traps, starting
prices, ranges, sales, kits, accessories, semantic hard negatives, and listings
that require abstention. The immutable evidence and decision are recorded in
[`g2-training-depth-wave-03-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-03-p00.json).

The paired blinded
[`g2-pilot-p21.json`](../benchmarks/review-campaigns/g2-pilot-p21.json)
campaign now contains 262 pages and 2,847 frozen roots from the same 80
qualified training domains. Deterministic preannotation proposes 545
comparables and 2,302 abstentions, including four invalid suggestions. The
semantic diagnostic in
[`g2-campaign-preannotation-p20.json`](../benchmarks/reviews/g2-campaign-preannotation-p20.json)
retains 2,814 suggestions and quarantines 33 traps. The representation audit in
[`g2-selection-representation-p19.json`](../benchmarks/reviews/g2-selection-representation-p19.json)
round-trips all 2,814 retained suggestions exactly with zero failures.

The p21 campaign is partitioned into 27 paired assignments in
[`g2-pilot-p21-review-batches.json`](../benchmarks/reviews/g2-pilot-p21-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p21-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p21-review-batch-validation.json)
loads all 262 screenshots and 2,847 roots with zero console errors or review
writes. Readiness now counts 262 of 480 required training pages, including 132
narrow pages, 134 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 04 adds 27 of 40 attempted unseen query pages across 20
qualified training domains, again a 67.5% page yield. All 27 successful captures
were accepted after manual inspection; four attempts were blocked and nine ended
in navigation or capture errors. The 317 new frozen roots span mass, volume,
count, length, and area. They include native square-foot prices, explicit
case-count plus volume offers, count packs, meter and yard quantities, ranges,
starting prices, accessories, and hard negatives where product dimensions,
diameters, or batch capacities must not be interpreted as sale quantity. The
immutable evidence and decision are recorded in
[`g2-training-depth-wave-04-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-04-p00.json).

The paired blinded
[`g2-pilot-p22.json`](../benchmarks/review-campaigns/g2-pilot-p22.json)
campaign now contains 289 pages and 3,164 frozen roots from the same 80
qualified training domains. Deterministic preannotation proposes 576
comparables and 2,588 abstentions, including four invalid suggestions. The
semantic diagnostic in
[`g2-campaign-preannotation-p21.json`](../benchmarks/reviews/g2-campaign-preannotation-p21.json)
retains 3,128 suggestions and quarantines 36 traps. The representation audit in
[`g2-selection-representation-p20.json`](../benchmarks/reviews/g2-selection-representation-p20.json)
round-trips all 3,128 retained suggestions exactly with zero failures.

The p22 campaign is partitioned into 29 paired assignments in
[`g2-pilot-p22-review-batches.json`](../benchmarks/reviews/g2-pilot-p22-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p22-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p22-review-batch-validation.json)
loads all 289 screenshots and 3,164 roots with zero console errors or review
writes. Readiness now counts 289 of 480 required training pages, including 149
narrow pages, 144 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 05 attempted 40 unseen query pages across 20 qualified
training domains. Twenty-seven pages passed the machine capture gates; manual
inspection rejected one three-root page whose products were irrelevant to the
query. Four attempts were blocked and nine ended in navigation or capture
errors. The accepted 26 pages are a 65% yield and add 295 frozen roots across
mass, volume, count, length, and area. Evidence includes native square-foot and
box-coverage prices; per-yard, pack, case, carton, box, and dozen offers;
package counts beside capacities and physical dimensions; price ranges without
visible sale quantities; accessories and query-adjacent products; and listings
where correct behavior is abstention. The immutable evidence and decision are
recorded in
[`g2-training-depth-wave-05-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-05-p00.json).

The paired blinded
[`g2-pilot-p23.json`](../benchmarks/review-campaigns/g2-pilot-p23.json)
campaign contains 315 pages and 3,459 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 615 comparables and
2,844 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p22.json`](../benchmarks/reviews/g2-campaign-preannotation-p22.json)
retains 3,423 suggestions and quarantines 36 traps. The representation audit in
[`g2-selection-representation-p21.json`](../benchmarks/reviews/g2-selection-representation-p21.json)
round-trips all 3,423 retained suggestions exactly with zero failures.

The p23 campaign is partitioned into 32 paired assignments in
[`g2-pilot-p23-review-batches.json`](../benchmarks/reviews/g2-pilot-p23-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p23-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p23-review-batch-validation.json)
loads all 315 screenshots and 3,459 roots with zero console errors or review
writes. Readiness now counts 315 of 480 required training pages, including 162
narrow pages, 158 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 06 attempted 40 unseen query pages across 20 qualified
training domains. Thirty pages passed the machine capture gates; manual
inspection rejected three pages with four, five, or seven frozen roots because
they were below the frozen eight-root minimum. One attempt was blocked and nine
ended in navigation or capture errors. The accepted 27 pages are a 67.5% yield
and add 314 frozen roots across mass, volume, count, length, and area. Evidence
includes per-square-foot, per-box, per-sheet, per-yard, per-roll, and
per-carton prices; combined package-count and physical-quantity offers; price
ranges without visible sale quantities; rope diameter and capacity without
sale length; tile dimensions without coverage; syringe capacity and
needle-size traps; paper ply, product dimensions, age, rider count, and review
count traps; samples, kits, accessories, and query-adjacent products; and
listings where correct behavior is abstention. The immutable evidence and
decision are recorded in
[`g2-training-depth-wave-06-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-06-p00.json).

The paired blinded
[`g2-pilot-p24.json`](../benchmarks/review-campaigns/g2-pilot-p24.json)
campaign contains 342 pages and 3,773 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 693 comparables and
3,080 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p23.json`](../benchmarks/reviews/g2-campaign-preannotation-p23.json)
retains 3,736 suggestions and quarantines 37 traps. The representation audit in
[`g2-selection-representation-p22.json`](../benchmarks/reviews/g2-selection-representation-p22.json)
round-trips all 3,736 retained suggestions exactly with zero failures.

The p24 campaign is partitioned into 35 paired assignments in
[`g2-pilot-p24-review-batches.json`](../benchmarks/reviews/g2-pilot-p24-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p24-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p24-review-batch-validation.json)
loads all 342 screenshots and 3,773 roots with zero console errors or review
writes. Readiness now counts 342 of 480 required training pages, including 176
narrow pages, 170 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 07 attempted 40 unseen query pages across 20 qualified
training domains. Twenty-five pages passed the machine capture gates; manual
inspection rejected seven successful captures. One page had only four frozen
roots, two returned false-match or no-result content, and four had fixed
promotions covering selected product evidence. One additional attempt was
blocked and 14 ended in navigation, launch, or capture errors. The accepted 18
pages are a 45% strict yield and add 212 frozen roots across mass, volume,
count, length, and area. Evidence includes per-each, per-carton, per-pack,
per-sheet, and per-square-foot prices; combined package-count and
physical-quantity offers; cup capacity, bandage dimensions, fabric width and
stretch, and rug and flooring dimensions that must not be treated as sale
quantity; query-adjacent products and accessories; and listings where price,
quantity, or sale-basis evidence is absent and the correct output is abstention.
The immutable evidence and decision are recorded in
[`g2-training-depth-wave-07-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-07-p00.json).

The paired blinded
[`g2-pilot-p25.json`](../benchmarks/review-campaigns/g2-pilot-p25.json)
campaign contains 360 pages and 3,985 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 716 comparables and
3,269 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p24.json`](../benchmarks/reviews/g2-campaign-preannotation-p24.json)
retains 3,948 suggestions and quarantines 37 traps. The representation audit in
[`g2-selection-representation-p23.json`](../benchmarks/reviews/g2-selection-representation-p23.json)
round-trips all 3,948 retained suggestions exactly with zero failures.

The p25 campaign is partitioned into 36 paired assignments in
[`g2-pilot-p25-review-batches.json`](../benchmarks/reviews/g2-pilot-p25-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p25-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p25-review-batch-validation.json)
loads all 360 screenshots and 3,985 roots with zero console errors or review
writes. Readiness now counts 360 of 480 required training pages, including 186
narrow pages, 178 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 08 attempted 40 unseen query pages across 20 qualified
training domains, with exactly eight targets for each supported dimension.
Nineteen pages passed the machine capture gates; ten attempts were blocked and
11 ended in bounded navigation or capture errors. Original-resolution visual
inspection rejected one successful Food to Live capture because an undismissed
privacy banner covered a selected product title. The accepted 18 pages are a
45% strict yield and add 212 frozen roots across all five dimensions. Evidence
includes per-ounce, per-each, per-square-foot, per-yard, per-half-metre, and
per-metre prices; gallon, quart, ounce, milliliter, kilogram, box-count,
roll-length, tile-dimension, fabric-width, and medical-dimension expressions;
starting and sale prices; query-adjacent products and non-product cards; and
cases where quantity or sale-basis evidence is absent and the correct output is
abstention. The immutable evidence and decision are recorded in
[`g2-training-depth-wave-08-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-08-p00.json).

The paired blinded
[`g2-pilot-p26.json`](../benchmarks/review-campaigns/g2-pilot-p26.json)
campaign contains 378 pages and 4,197 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 792 comparables and
3,405 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p25.json`](../benchmarks/reviews/g2-campaign-preannotation-p25.json)
retains 4,160 suggestions and quarantines 37 traps. The representation audit in
[`g2-selection-representation-p24.json`](../benchmarks/reviews/g2-selection-representation-p24.json)
round-trips all 4,160 retained suggestions exactly with zero failures.

The p26 campaign is partitioned into 38 paired assignments in
[`g2-pilot-p26-review-batches.json`](../benchmarks/reviews/g2-pilot-p26-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The reusable batch validator starts and cleans up an isolated local
server for each assignment, rejects any manifest mismatch, and records
provenance hashes for every validation report. The aggregate evidence in
[`g2-pilot-p26-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p26-review-batch-validation.json)
loads all 378 screenshots and 4,197 roots with zero console errors or review
writes. Readiness now counts 378 of 480 required training pages, including 195
narrow pages, 185 categories, and 67 strata. Human-reviewed products remain
zero, so all roots and machine suggestions remain ineligible for silver
training or benchmark gold.

Training depth wave 09 attempted 40 unseen query pages across 20 qualified
training domains, with exactly eight targets for each supported dimension.
Twenty-seven machine captures completed and 13 ended in bounded navigation or
capture errors. Original-resolution visual inspection and promotion checks
accepted 19 pages and rejected eight completed captures: two returned mostly
unrelated products, two had fixed controls covering selected evidence, two had
fewer than eight roots, one returned the wrong product category, and one lacked
the required per-root screenshots. The accepted pages are a 47.5% strict yield
and add 223 frozen roots. The immutable evidence and decisions are recorded in
[`g2-training-depth-wave-09-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-09-p00.json).

The paired blinded
[`g2-pilot-p27.json`](../benchmarks/review-campaigns/g2-pilot-p27.json)
campaign contains 397 pages and 4,420 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 846 comparables and
3,574 abstentions, including four invalid suggestions. A root containing
groundable price text but no product title exposed a preannotation failure; the
generator now represents that case as a grounded `not-a-product` abstention
instead of terminating the campaign. The semantic diagnostic in
[`g2-campaign-preannotation-p26.json`](../benchmarks/reviews/g2-campaign-preannotation-p26.json)
retains 4,381 suggestions and quarantines 39 traps. The representation audit in
[`g2-selection-representation-p25.json`](../benchmarks/reviews/g2-selection-representation-p25.json)
round-trips all 4,381 retained suggestions exactly with zero failures.

The p27 campaign is partitioned into 40 paired assignments in
[`g2-pilot-p27-review-batches.json`](../benchmarks/reviews/g2-pilot-p27-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p27-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p27-review-batch-validation.json)
loads all 397 screenshots and 4,420 roots with zero console errors or review
writes. Readiness now counts 397 of 480 required training pages, including 204
narrow pages, 203 categories, and 67 strata; 83 training pages remain. Human
reviewed products remain zero, so all roots and machine suggestions remain
ineligible for silver training or benchmark gold.

Training depth wave 10 attempted 40 unseen query pages across 20 qualified
training domains, with exactly eight targets for each supported dimension.
Twenty-eight machine captures completed, ten ended in bounded navigation or
capture errors, and two were blocked by missing annotation evidence or a
full-viewport obstruction. Original-resolution visual inspection and promotion
checks accepted 22 pages and rejected six completed captures: four had fewer
than eight roots, one had a chat control covering product-title evidence, and
one had a discount control covering price evidence. The accepted pages are a
55% strict yield and add 262 frozen roots. Two narrow pages captured only a
subset of per-card closeups but retained complete annotation screenshots and
multiple valid closeups, satisfying the frozen policy without claiming that all
262 closeups exist. The immutable evidence and decisions are recorded in
[`g2-training-depth-wave-10-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-10-p00.json).

The paired blinded
[`g2-pilot-p28.json`](../benchmarks/review-campaigns/g2-pilot-p28.json)
campaign contains 419 pages and 4,682 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 906 comparables and
3,776 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p27.json`](../benchmarks/reviews/g2-campaign-preannotation-p27.json)
retains 4,643 suggestions and quarantines 39 traps. The representation audit in
[`g2-selection-representation-p26.json`](../benchmarks/reviews/g2-selection-representation-p26.json)
round-trips all 4,643 retained suggestions exactly with zero failures.

The p28 campaign is partitioned into 42 paired assignments in
[`g2-pilot-p28-review-batches.json`](../benchmarks/reviews/g2-pilot-p28-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p28-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p28-review-batch-validation.json)
loads all 419 screenshots and 4,682 roots with zero console errors or review
writes. Readiness now counts 419 of 480 required training pages, including 215
narrow pages, 212 categories, and 67 strata; 61 training pages remain. Human
reviewed products remain zero, so all roots and machine suggestions remain
ineligible for silver training or benchmark gold.

Training depth wave 11 attempted 40 unseen query pages across 20 qualified
training domains, with exactly eight targets for each supported dimension.
Twenty-seven machine captures completed, 12 ended in bounded navigation or
capture errors, and one was blocked because annotation evidence was
unavailable. Original-resolution visual inspection and promotion checks
accepted 23 pages and rejected four completed captures: one had only three
roots, and three had fixed controls covering selected product-title or price
evidence. The accepted pages are a 57.5% strict yield and add 268 frozen roots.
The immutable evidence and decisions are recorded in
[`g2-training-depth-wave-11-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-11-p00.json).

The paired blinded
[`g2-pilot-p29.json`](../benchmarks/review-campaigns/g2-pilot-p29.json)
campaign contains 442 pages and 4,950 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 973 comparables and
3,977 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p28.json`](../benchmarks/reviews/g2-campaign-preannotation-p28.json)
retains 4,902 suggestions and quarantines 48 traps. The representation audit in
[`g2-selection-representation-p27.json`](../benchmarks/reviews/g2-selection-representation-p27.json)
round-trips all 4,902 retained suggestions exactly with zero failures.

The p29 campaign is partitioned into 45 paired assignments in
[`g2-pilot-p29-review-batches.json`](../benchmarks/reviews/g2-pilot-p29-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p29-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p29-review-batch-validation.json)
loads all 442 screenshots and 4,950 roots with zero console errors or review
writes. Readiness now counts 442 of 480 required training pages, including 226
narrow pages, 222 categories, and 67 strata; 38 training pages remain. Human
reviewed products remain zero, so all roots and machine suggestions remain
ineligible for silver training or benchmark gold.

Training depth wave 12 attempted 40 unseen query pages across 20 qualified
training domains, with exactly eight targets for each supported dimension.
Twenty-eight capture bundles completed and 12 attempts ended in bounded
navigation or capture timeouts. Original-resolution visual inspection and
promotion checks accepted 19 pages and rejected nine completed bundles: two had
fewer than eight roots, three lacked required annotation or per-root screenshot
evidence, three returned mostly unrelated products, and one had a fixed
accessibility control covering selected price evidence. The accepted pages are
a 47.5% strict yield and add 221 frozen roots. The immutable evidence and
decisions are recorded in
[`g2-training-depth-wave-12-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-12-p00.json).

The paired blinded
[`g2-pilot-p30.json`](../benchmarks/review-campaigns/g2-pilot-p30.json)
campaign contains 461 pages and 5,171 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 1,022 comparables and
4,149 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p29.json`](../benchmarks/reviews/g2-campaign-preannotation-p29.json)
retains 5,121 suggestions and quarantines 50 traps. The representation audit in
[`g2-selection-representation-p28.json`](../benchmarks/reviews/g2-selection-representation-p28.json)
round-trips all 5,121 retained suggestions exactly with zero failures.

The p30 campaign is partitioned into 47 paired assignments in
[`g2-pilot-p30-review-batches.json`](../benchmarks/reviews/g2-pilot-p30-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p30-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p30-review-batch-validation.json)
loads all 461 screenshots and 5,171 roots with zero console errors or review
writes. Readiness now counts 461 of 480 required training pages, including 236
narrow pages, 235 categories, and 70 strata; 19 training pages remain. Human
reviewed products remain zero, so all roots and machine suggestions remain
ineligible for silver training or benchmark gold.

Training depth wave 13 attempted 40 unseen query pages across 20 qualified
training domains, again with exactly eight targets for each supported
dimension. Twenty-nine capture bundles completed, one additional attempt
produced a blocked shell without annotation evidence, and ten attempts ended in
bounded navigation or capture timeouts. Original-resolution visual inspection
and promotion checks accepted 19 pages and rejected ten completed bundles:
one had fewer than eight roots, eight returned mostly unrelated products, and
one had a fixed accessibility control covering selected price evidence. The
accepted pages are a 47.5% strict yield and add 222 frozen roots. The immutable
evidence and decisions are recorded in
[`g2-training-depth-wave-13-p00.json`](../benchmarks/capture-pilots/g2-training-depth-wave-13-p00.json).

The paired blinded
[`g2-pilot-p31.json`](../benchmarks/review-campaigns/g2-pilot-p31.json)
campaign contains 480 pages and 5,393 frozen roots from the same 80 qualified
training domains. Deterministic preannotation proposes 1,092 comparables and
4,301 abstentions, including four invalid suggestions. The semantic diagnostic
in
[`g2-campaign-preannotation-p30.json`](../benchmarks/reviews/g2-campaign-preannotation-p30.json)
retains 5,343 suggestions and quarantines 50 traps. The representation audit in
[`g2-selection-representation-p29.json`](../benchmarks/reviews/g2-selection-representation-p29.json)
round-trips all 5,343 retained suggestions exactly with zero failures.

The p31 campaign is partitioned into 48 paired assignments in
[`g2-pilot-p31-review-batches.json`](../benchmarks/reviews/g2-pilot-p31-review-batches.json).
The full campaign and every reviewer-A batch passed headed Playwright Chromium
validation. The aggregate evidence in
[`g2-pilot-p31-review-batch-validation.json`](../benchmarks/reviews/g2-pilot-p31-review-batch-validation.json)
loads all 480 screenshots and 5,393 roots with zero console errors or review
writes. Readiness now meets the structural training target at 480 pages,
including 244 narrow pages, 250 categories, and 70 strata. Human-reviewed
products remain zero, so all roots and machine suggestions remain ineligible
for silver training or benchmark gold.

The first frozen held-out audit attempted all 16 initially assigned validation
and selection domains with isolated headed Chromium processes and a parent
hard timeout. Fourteen domains failed acquisition, and FreshDirect failed
visual review because its annotation region clipped the product evidence.
PetSmart alone passed the two-page qualification gate. Its desktop cat-litter
and narrow aquarium-conditioner pages add 24 frozen roots across mass and
volume, giving validation 1 qualified domain and 2 eligible pages. The exact
decision and provenance are recorded in
[`heldout-existing-p00.json`](../benchmarks/domain-qualification/heldout-existing-p00.json)
and
[`g2-validation-petsmart-p00.json`](../benchmarks/capture-pilots/g2-validation-petsmart-p00.json).

The paired blinded
[`g2-validation-p00.json`](../benchmarks/review-campaigns/g2-validation-p00.json)
campaign covers both validation pages and all 24 roots. The full campaign and
its paired assignment passed headed Playwright Chromium with zero console
errors or review writes; the aggregate batch evidence is in
[`g2-validation-p00-review-batch-validation.json`](../benchmarks/reviews/g2-validation-p00-review-batch-validation.json).
No semantic reviews have been completed, so these roots remain ineligible for
benchmark gold.

A bounded retry then revisited 10 still-unassigned qualification candidates
with prior partial evidence. All 18 isolated headed Chromium children
completed without a hard timeout. Eight desktop pages passed visual review and
received a distinct narrow capture; Parentgiving, Super Detail, and
Detailing.com were the only domains to pass both viewport gates. The exact
accept/reject evidence is recorded in
[`heldout-retry-p00.json`](../benchmarks/domain-qualification/heldout-retry-p00.json).
Parentgiving adds 2 validation pages and 22 roots, while the two detailing
retailers add 4 selection pages and 48 roots. Held-out structure is now 2
qualified validation domains with 4 pages and 2 qualified selection domains
with 4 pages, each at 50% narrow-viewport coverage.

The paired blinded
[`g2-validation-p01.json`](../benchmarks/review-campaigns/g2-validation-p01.json)
and
[`g2-selection-p00.json`](../benchmarks/review-campaigns/g2-selection-p00.json)
campaigns cover all 6 new pages and 70 roots. Both complete campaigns and both
paired assignments passed headed Playwright Chromium with zero console errors
or review writes. Human semantic reviews and adjudication remain pending.

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

The registry's `observationSha256` is the immutable `observation.json` asset hash
from `provenance.json`, not the collector's internal observation-content hash in
`page.json`. Review queues and training-depth pilot reports bind to that same
asset hash. The depth report preserves the internal value separately as
`canonicalObservationSha256`; legacy qualification pilot reports predate that
separation and must not be used as byte-identity evidence.
