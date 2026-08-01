# MVP Validation

Validation date: 2026-07-29

## Accepted Scope

Version 0.3.0 is an unpacked Manifest V3 extension MVP for public,
English-language HTTP(S) shopping pages that show USD prices.

The MVP:

- Runs the conservative generic extractor on unfamiliar hosts, with optional
  compatibility adapters for known retailers.
- Uses a retailer's visible native unit price when present.
- Otherwise computes a unit price only when visible price and package quantity
  evidence form an unambiguous relationship.
- Normalizes compatible mass, volume, count, area, and length units.
- Suppresses an added line when the retailer already shows the same normalized
  basis and value.
- Adds a plain, unboxed inline value when normalization changes the basis or
  computes a missing unit price.
- Marks `Lowest of N` only for an exact minimum among at least three compatible
  items in the same loaded product collection.
- Adds basis-specific sort options only inside an identifiable retailer sort
  control.
- Offers the same safe loaded-item sort and restore operation from the popup
  when no retailer control can be enhanced.
- Preserves the positions of incompatible unit groups.
- Reports page count and state through the popup and action badge.
- Removes UI from older builds, including the floating panel, confidence labels,
  warning icon, and standalone sort control.
- Keeps page data local. No page content is sent to a model or remote service.

The extension abstains when the quantity relationship, currency, unit, or
product-card boundary is unsupported or ambiguous.

## Automated Evidence

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| Unit tests | 242 passed |
| Default Playwright | 15 passed, 13 live-only skipped |
| Unknown-host fixture | 3 comparable items; matching native values suppressed; quantity-free product abstained |
| Native select sorting | Basis labels, mixed groups, sort, and restore passed |
| Generic custom menu | Delayed insertion, sorting, and unrelated-dropdown isolation passed |
| Walmart-style menu | Full-row geometry, order, label, and functional sorting passed |
| Dynamic first card | Price/unit hydration detected; matching native values stayed single |
| Popup contract | Auto status, basis selection, sort, restore, rescan, and action count passed |
| Accessibility | Expanded price labels and keyboard menu activation passed |
| Page safety | No panel, confidence UI, or standalone sort UI; add-to-cart remained clickable |

The Walmart-style visual check used the built extension in headless Chromium at
1440 x 900. The inserted row:

- Followed `New Arrivals`.
- Displayed the full `Unit price per lb: low to high` label.
- Used block layout.
- Aligned within 1 px of the menu's left edge.
- Matched the menu width within 2 px.
- Reordered 22.9 cents/lb before 70 cents/lb.
- Left the fl oz product outside the mass comparison order.

## Live Retailer Check

The opt-in headless live suite tests 13 cases. On the final 2026-07-29
validation run, four listings rendered completely enough to validate:

| Listing | Comparable items |
| --- | ---: |
| Walmart cat litter | 4 |
| Amazon laundry detergent | 71 |
| Target coffee pods | 18 |
| Walgreens vitamins | 41 |

Nine checks were unavailable and were skipped rather than counted as product
failures:

- Chewy returned HTTP 429.
- Petco, CVS, Home Depot, and Lowe's returned HTTP 403.
- Costco returned an access-denied page.
- Staples rendered a different category from the requested printer-paper page.
- Sam's Club rendered a retailer error page.
- Walmart's dedicated sort URL returned `Robot or human?`.

The live run therefore proves current rendering on four accessible retailers.
It does not establish live sort behavior on Walmart in this automated
environment. Walmart sort behavior remains covered by the built-extension
fixture and the isolated visual geometry check above. The harness also detects
late-arriving block overlays so a briefly rendered sponsored card is not
misreported as a valid listing.

## Dataset Evidence

The frozen final structural cohort contains:

- 300 pages across 42 domains.
- 153 narrow-viewport pages.
- 14 shopping strata and 124 categories.
- 11,902 independent frozen candidate roots.

This is structural evidence, not semantic gold. Independent reviewer labels and
adjudication remain at zero, so the corpus cannot yet support a learned-model
accuracy claim or the larger universal-extraction goal.

## Known Limits

- Sorting is local to product cards already loaded in the DOM. It does not
  reorder unseen pages or ask the retailer backend for a server-side sort.
- Custom sort integration requires an identifiable visible sort trigger and menu.
  Other pages use the extension popup for an explicit loaded-item sort; no panel
  or standalone page widget is added.
- Retailer DOM changes can break extraction or sort integration.
- Bot defenses prevented complete live coverage in the automated environment.
- The current parser scope is English, USD, and the declared units. Other
  currencies and locales abstain.
- The T5Gemma 2 evidence-pointer model is research work, not an MVP runtime
  dependency. It remains blocked on independent semantic annotation and
  adjudication.

## Release Decision

Version 0.4.0 passes the deterministic unpacked-extension UX gate. It does not
complete the independently labeled dataset or learned unknown-site model gates.
