# MVP Validation

Validation date: 2026-07-28

## Accepted Scope

Version 0.2.0 is an unpacked Manifest V3 extension MVP for public,
English-language HTTP(S) shopping pages that show USD prices.

The MVP:

- Runs the conservative generic extractor on unfamiliar hosts, with optional
  compatibility adapters for known retailers.
- Uses a retailer's visible native unit price when present.
- Otherwise computes a unit price only when visible price and package quantity
  evidence form an unambiguous relationship.
- Normalizes compatible mass, volume, count, area, and length units.
- Adds a compact badge to the corresponding product card.
- Adds `Unit price: low to high` only inside an identifiable retailer sort
  control.
- Sorts comparable, currently loaded cards locally and preserves the positions
  of incompatible unit groups.
- Removes UI from older builds, including the floating panel, confidence labels,
  warning icon, and standalone sort control.
- Keeps page data local. No page content is sent to a model or remote service.

The extension abstains when the quantity relationship, currency, unit, or
product-card boundary is unsupported or ambiguous.

## Automated Evidence

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| Unit tests | 235 passed |
| Default Playwright | 11 passed, 13 live-only skipped |
| Unknown-host fixture | 3 valid badges; quantity-free product abstained |
| Native select sorting | Sort and restore passed |
| Generic custom menu | Delayed insertion, sorting, and unrelated-dropdown isolation passed |
| Walmart-style menu | Full-row geometry, order, label, and functional sorting passed |
| Page safety | No panel or standalone sort UI; add-to-cart remained clickable |

The Walmart-style visual check used the built extension in headless Chromium at
1440 x 900. The inserted row:

- Followed `New Arrivals`.
- Displayed the full `Unit price: low to high` label.
- Used block layout.
- Aligned within 1 px of the menu's left edge.
- Matched the menu width within 2 px.
- Reordered 22.9 cents/lb before 70 cents/lb.
- Left the fl oz product outside the mass comparison order.

## Live Retailer Check

The opt-in headless live suite tested 13 cases. Four available listings passed:

| Listing | Badges |
| --- | ---: |
| Walmart cat litter | 4 |
| Amazon laundry detergent | 70 |
| Target coffee pods | 29 |
| Walgreens vitamins | 41 |

Nine checks were unavailable and were skipped rather than counted as product
failures:

- Chewy returned HTTP 429.
- Petco, CVS, Home Depot, and Lowe's returned HTTP 403.
- Costco returned an access-denied page.
- Staples rendered a different category from the requested printer-paper page.
- Sam's Club rendered a retailer error page.
- Walmart's dedicated sort run returned `Robot or human?`, including an isolated
  one-worker retry.

The live run therefore proves rendering on four currently accessible retailers.
It does not prove live sort behavior on Walmart in this environment. That behavior
is covered by the built-extension Walmart fixture and the visual geometry check
above.

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
  The extension deliberately adds no fallback panel or standalone sort widget.
- Retailer DOM changes can break extraction or sort integration.
- Bot defenses prevented complete live coverage in the automated environment.
- The current parser scope is English, USD, and the declared units. Other
  currencies and locales abstain.
- The T5Gemma 2 evidence-pointer model is research work, not an MVP runtime
  dependency. It remains blocked on independent semantic annotation and
  adjudication.

## Release Decision

Version 0.2.0 passes the deterministic unpacked-extension MVP gate. It does not
complete the independently labeled dataset or learned unknown-site model gates.
