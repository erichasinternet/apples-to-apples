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
`page.json`. Review queues and pilot reports bind to that same asset hash.
