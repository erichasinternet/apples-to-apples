# UX Research and Product Design

Status: proposed product direction
Research date: 2026-07-28

## Purpose

Apples to Apples should make an online price comparison possible at a glance,
without asking shoppers to perform arithmetic, learn a new shopping interface,
or trust an unexplained recommendation.

The product is a comparison layer, not a replacement storefront and not a
general-purpose shopping assistant. It should preserve the retailer's page,
add only decision-relevant facts, and remain silent when the evidence is not
good enough.

This document defines the intended experience before further UI implementation.
It is based on:

- The failures and user feedback observed during the Walmart MVP iterations.
- Current retailer and browser-extension interaction patterns.
- Government and academic research on unit-pricing use.
- Accessibility requirements for injected browser UI.

## Product Constraints

The following constraints are settled:

- No persistent sidebar, floating results panel, standalone sort widget, or
  automatic pop-up.
- No confidence labels, confidence scores, ambiguous warning icons, or model
  terminology in the shopping UI.
- Add sorting to the retailer's existing sort control when that can be done
  reliably and accessibly. Treat this as a verified enhancement, not a
  universal assumption about unknown sites.
- Keep normalized prices next to the corresponding selling price.
- Never replace or conceal the retailer's selling price or native unit price.
- Never compare incompatible dimensions.
- Do not call the cheapest item the "best value." Price does not measure
  quality, preference, waste, storage constraints, shipping, or durability.
- Abstention is a valid state. Missing UI is better than a fabricated or
  misleading price.
- Extension behavior must be tested visually and functionally, not inferred
  from DOM assertions alone.

## Jobs To Be Done

Research commissioned by the UK Competition and Markets Authority identified
the situations in which shoppers found unit pricing most helpful: comparing
formats, evaluating expensive purchases, narrowing overwhelming choices,
checking promotions, evaluating unfamiliar products, noticing shrinkflation,
and buying in bulk. The same research observed that online shoppers move
quickly, multitask, and spend less time comparing than in-store shoppers.

That produces four primary jobs for this extension:

1. **Scan:** "Show me the same price basis on every comparable item without
   making me stop and calculate."
2. **Rank:** "Put the lowest unit prices first, while making the comparison
   basis and scope clear."
3. **Verify:** "Tell me whether a bulk pack or promotion is actually cheaper
   per unit."
4. **Understand:** "Let me verify how a number was produced without filling the
   page with technical detail."

The first two jobs are the core product. Verification is conditional on having
reliable promotion and quantity evidence. Explanation is progressive
disclosure, not default page content.

## What The Research Says

### Prominence and proximity matter

The 2025 NIST Unit Pricing Guide recommends placing the unit price near the
retail price so both are visible at a glance. It also recommends high contrast,
clear wording, consistency, and avoiding overloaded labels. A controlled
experiment by Miyazaki, Sprott, and Manning found that making unit prices more
prominent increased awareness and use and shifted purchases toward lower unit
prices.

Implication: a tiny muted footnote or a separate panel does not solve the main
problem. The normalized fact must be visually adjacent to the selling price and
prominent enough to scan, while remaining subordinate to the amount the shopper
will actually pay.

### Consistency is more important than a shopper's favorite unit

NIST recommends one unit of measure within a product category. The CMA study
found that shoppers could compare more quickly when similar products used the
same unit, and that mixed units forced mental arithmetic back into the task.

Implication: a comparison set must have one stable denominator. Per-item
preferences cannot cause different cards in the same result set to use different
bases.

### The useful unit depends on how the product is consumed

CMA participants preferred units such as price per wash for detergent pods and
price per item for tea bags. They found a weight basis less useful when the
product is naturally consumed by count. They generally rejected "per serving"
because serving size can be subjective.

Implication: semantic count units such as load, sheet, roll, diaper, tablet, or
capsule should remain distinct when the page provides that evidence. The
extension must not invent conversions between them. Subjective serving sizes
should not be derived.

### Unit price is especially valuable under time pressure

Yao and Oppewal found that unit pricing helped participants find lower unit
priced items, complete the task more quickly, and reduced perceived information
load. Its effect on choice was stronger under time pressure.

Implication: the default presentation should answer the comparison question
without interaction. Dense analysis, charts, education, and explanatory copy
should not occupy result cards.

### Promotions are a high-value, high-risk case

The CMA found that promotions strongly influence shopping, but promoted items
are not always cheapest per unit. Participants were confused when it was unclear
whether a unit price reflected a loyalty or promotional price.

Implication: a conditional unit price must identify its condition in plain
language, such as `with membership` or `with coupon`. If the condition cannot be
bound to the displayed price, do not compute or rank it.

### Lowest price is not the same as best choice

CMA participants used unit pricing less when quality mattered and sometimes
avoided bulk purchases because of waste. Longitudinal research by Mortimer and
Weeks found that unit-pricing education did not simply move shoppers to the
cheapest item; shoppers often selected mid-range products.

Implication: use factual language such as `Lowest per lb`, never `Best value`,
`Best deal`, or `Recommended`.

## Prior Art

| Pattern | Examples | What works | What does not transfer |
| --- | --- | --- | --- |
| Native unit-price line | Walmart, Amazon, Target | Adjacent to price; available during scanning; no new workflow | Units vary; values are missing or wrong; retailer sort usually ignores unit price |
| Dense inline analysis | Keepa | Zero-click integration; strong price-history evidence on a product page | A chart is too dense for every search card and solves a different decision |
| Browser side panel | Chrome Shopping Insights | Good for an explicitly inspected product, history, and tracking | Pulls attention away from the result grid and requires interaction |
| Automatic overlay or alert | Honey, Capital One Shopping, Rakuten | Makes a potentially valuable event difficult to miss | Interruptive, often action- or affiliate-oriented, and poorly suited to repeated unit facts |
| Replacement results/sidebar | Unit Price Shopper and similar tools | Can filter, aggregate pages, and show a comparison-specific list | Duplicates the storefront, creates a second information architecture, and was rejected in our own iterations |
| Small injected badge | UnitNormalize and Amazon unit-price tools | Low friction and close to the price | Often site-specific, title-regex based, visually repetitive, and disconnected from native sorting |
| Manual calculator | Unit-price calculator sites | Transparent formula and explicit comparison | Requires transcription and context switching, defeating the extension's main value |

The transferable combination is:

- Retailer-style adjacency for the primary fact.
- Keepa-style automatic availability, without its analytical density.
- A native sort command rather than a replacement results list.
- User-invoked status and settings in the extension toolbar, not an automatic
  overlay.

### What extension prior art validates

Established browser extensions use different surfaces for different
interaction frequencies:

- **Repeated facts belong inline.** Keepa injects price history into Amazon's
  product UI and explicitly describes its experience as zero-click. Dedicated
  unit-price extensions such as Unit Price Helper and UnitNormalize also attach
  values directly to product listings.
- **Occasional commands belong in the action popup.** Chrome defines action
  popups as user-invoked surfaces for multiple extension features and action
  badges as indicators of extension state.
- **Dense, persistent analysis belongs in a side panel.** Chrome describes the
  side panel as a persistent companion surface. Unit Price Shopper uses this
  pattern for multi-page results, filters, and a replacement comparison list.
- **Interruptions belong to exceptional events.** Honey, Rakuten, and Capital
  One Shopping use prompts for coupons, cash back, price drops, or an identified
  alternative offer. A unit price appears on many cards and is not exceptional,
  so repeating that pattern would create alert fatigue.

This validates the inline comparison line as the primary interface. It does not
validate universal modification of retailer controls. Retailer sort menus are
implemented as native selects, listboxes, menus, portals, and custom radio
groups with different focus and rendering behavior. Injecting into them can be
excellent on a verified site and unsafe on an unknown one.

## Recommended Interaction Architecture

### 1. Result-card comparison line

The primary UI is one line immediately adjacent to the selling price:

```text
$14.86
33.0¢/lb
```

Behavior:

- Inherit the retailer's local font family, text color, and spacing where
  possible.
- Use a stable extension format for the number and denominator.
- Keep the line at least as legible as the retailer's native secondary price
  text.
- Do not put the number in a decorative pill by default. A boxed shelf-tag
  treatment consumes space and can look like a promotion or button.
- Give the rendered text an expanded accessible name, for example
  `33 cents per pound`.
- Keep calculation evidence in a nonvisual accessible description and a native
  tooltip initially. Test whether shoppers need an explicit explanation
  affordance before adding one.

Rendering rules:

| Page evidence | Result-card behavior |
| --- | --- |
| Retailer unit price already matches the comparison basis and value | Do not add a duplicate line; use the native value for sorting |
| Retailer unit price is valid but uses another compatible basis | Add one normalized line; leave the retailer line unchanged |
| Price and package quantity are unambiguous | Add one normalized line |
| Promotion or membership condition is reliably bound | Show the condition next to the normalized line and rank only with like conditions |
| Quantity, variant, currency, or price condition is ambiguous | Show nothing |
| Incompatible dimensions are present | Keep separate comparison groups |

### 2. Factual best-price signal

Only one item in a sufficiently large, homogeneous comparison group may receive
a secondary factual signal:

```text
33.0¢/lb · Lowest of 18
```

Rules:

- Require at least three comparable loaded items.
- State the loaded comparison count.
- Use `Lowest`, not `Best`.
- Do not award the signal when multiple items tie after display rounding; mark
  all exact ties or mark none.
- Do not compare ordinary, member, subscription, and coupon prices as though
  their purchase conditions were identical.
- Do not use a trophy, medal, star, or recommendation treatment.

Relative-savings messages such as `22% below average` are not part of the
initial design. They add a reference-price question, can feel promotional, and
need user testing before they earn page space.

### 3. Native sort integration

The sort command must name its denominator:

```text
Unit price per lb: low to high
```

For mixed pages, inject one command per useful comparison group rather than an
ambiguous `Unit price` command:

```text
Unit price per lb: low to high
Unit price per item: low to high
```

Rules:

- Clone the retailer's complete option-row structure and accessible semantics.
- Keep the full label on one row or wrap it intentionally; never allow visual
  truncation into another option.
- Preserve the retailer's original selected value and provide a reliable route
  back to it.
- After selection, the retailer trigger should communicate the active basis,
  such as `Unit price per lb`.
- Sort comparable loaded cards to the top in ascending order. Preserve the
  relative order of noncomparable cards after that group.
- Count sponsored placements as a separate policy decision. Do not silently
  move or relabel sponsored content until legal and usability review is
  complete.
- If the menu cannot be enhanced with correct geometry, keyboard behavior, and
  selected state, do not add the command.

The command operates on loaded results. The toolbar status should disclose that
scope. Future server-backed or multi-page comparison should be a distinct
feature, not implied by local DOM sorting.

Native sort integration is a progressive enhancement:

1. Enhance a real native `select` when selection and restoration are verified.
2. Enhance a known custom menu only through a tested compatibility adapter.
3. On an unfamiliar site, require a structural safety gate before reordering:
   one stable results container, bounded product-card children, no detected
   virtualization, and a tested restoration path.
4. If the menu or result structure fails these gates, do not modify it.

For an unfamiliar site that has safe card reordering but an unsafe menu, the
toolbar popup may expose `Sort loaded items per lb`. This is a browser-native,
user-invoked fallback, not a page-level sort widget. If card reordering is also
unsafe, normalized prices and factual lowest-of-N signals remain available
without sorting.

### 4. Toolbar popup

The popup is a user-invoked status and control surface, not a second product
list:

```text
Apples to Apples

18 comparable items on this page
Weight basis: lb
Sorted by unit price

[Sort loaded items]  [Rescan page]
[Preferences]
```

When no comparisons are available:

```text
No comparable prices found
Prices were left unchanged.
```

The popup may disclose factual reasons in aggregate, such as `4 items had no
visible quantity`, but it must not show model confidence or rank individual
failures. Scanning should normally be automatic; `Rescan page` is a recovery
command, not the primary workflow.

### 5. Preferences

Preferences should use plain shopping language and remain small:

- Automatic comparison on/off.
- Preferred measurement system: `US customary`, `Metric`, or `Choose by
  category`.
- Optional explicit overrides for weight, volume, area, and length.
- Show the lowest-of-loaded-items signal on/off.
- Include conditional prices on/off, with conditions always disclosed.

`Include rewards` should not reduce the actual item price. Rewards are delayed
or restricted value and should be shown separately from cash price if this
feature is retained.

## Insight Ladder

An insight earns UI space only when it answers a recurring shopping question,
has a plain-language comparator, and can be reproduced from grounded evidence.

### Level 1: Comparison facts

These are the initial product:

- Normalized unit price.
- Lowest unit price among a stated number of comparable loaded items.
- Unit-price sorting for a named denominator.
- A clear condition when the price requires membership, subscription, coupon,
  minimum quantity, or another visible action.

### Level 2: Pack and promotion decisions

These are useful after reliable product-family and promotion binding exists:

- `45 lb is 16% less per lb; costs $7.00 more today`.
- `2-pack costs 4% more per item than single`.
- `Sale price is still 12% more per lb than the lowest loaded option`.
- `Coupon price is the lowest of 14 comparable items`.

Every message must show both unit economics and the immediate cash tradeoff when
buying more. This prevents a bulk package from being framed as an unconditional
recommendation.

### Level 3: Historical and cross-retailer context

These require data beyond the current rendered page:

- Unit-price history that distinguishes a real price change from a package-size
  change.
- Cross-retailer unit price using an identical product or a clearly defined
  substitute group.
- Delivered unit cost that includes shipping, mandatory fees, and location
  conditions.
- Price-drop alerts based on normalized unit price rather than package price.

This is where Keepa and Chrome Shopping Insights provide strong interaction
prior art: historical analysis belongs on an explicitly inspected item or in a
user-invoked browser surface, not on every result card.

### Excluded until proven useful

- Percent below an undefined "average."
- Estimated quality or durability.
- Waste, storage, or consumption-rate recommendations without user input.
- A universal shopping score that combines price, reviews, shipping, rewards,
  and promotions.
- Savings based on a list price the item was not recently sold at.

Every future insight needs four grounded fields:

1. Comparison basis.
2. Comparator set.
3. Price condition.
4. Scope and observation time.

If any field is unavailable, show the underlying price fact without the
insight.

## Comparison-Basis Policy

The basis is selected for a comparison set, not independently per card:

1. Determine the semantic dimension and product-use unit from grounded page
   evidence.
2. Split incompatible dimensions and semantic count units.
3. Apply an explicit user override if present.
4. Otherwise use the locale-appropriate basis that keeps displayed values easy
   to scan for that result set.
5. Keep the selected basis stable until navigation or an explicit preference
   change.

Examples:

- Cat litter in pounds and ounces becomes one mass group, normally per pound in
  the US.
- Laundry pods compare per pod or load when that count is explicit; their net
  mass does not replace the usage count.
- Paper towels may compare per sheet only when sheet counts are explicit.
  Rolls are not interchangeable with sheets.
- Liquid detergent may compare by fluid volume, but must not be mixed with a
  per-load group without an explicit manufacturer dosage relationship.
- Loose produce priced by weight cannot be converted to per-item pricing
  without item-weight evidence.

## Information Hierarchy

From most to least prominent:

1. Retailer's current selling price.
2. Normalized unit price.
3. Factual comparison signal such as `Lowest of 18`.
4. Product title and retailer metadata in their existing hierarchy.
5. Calculation explanation, evidence source, and unsupported-item counts on
   demand.

This order protects affordability. A shopper must continue to see that a
50-pound package costs more cash even when it has the lowest unit price.

## Language

Use:

- `33.0¢/lb`
- `Unit price per lb: low to high`
- `Lowest of 18`
- `with membership`
- `18 comparable items on this page`
- `No comparable prices found`

Avoid:

- `Best value`
- `Smart choice`
- `High confidence`, `Medium`, or `Low`
- `AI calculated`
- `Warning` or a bare `!`
- `We think`
- `Savings` without a defined comparison

The extension should explain facts, not narrate its implementation.

## Accessibility Requirements

The target is WCAG 2.2 AA for extension-owned UI:

- Text contrast of at least 4.5:1 and visible focus indicators.
- No loss of content or function at 200% text zoom or a 320 CSS-pixel reflow
  width.
- Full keyboard operation for popup, preferences, and injected sort options.
- Native semantics should be preserved when enhancing a sort menu. A custom
  menu must follow the WAI-ARIA menu or listbox interaction model, including
  focus movement, selection state, and Escape behavior.
- An injected value must have a readable accessible name. Do not rely on a
  currency symbol, slash, color, or tooltip alone.
- Dynamic status changes in the toolbar popup should use a polite live region.
  Repeated card insertions should not create dozens of screen-reader
  announcements.
- Extension content must not obscure retailer content or keyboard focus.
- Test VoiceOver on macOS and at least one Chromium screen reader on Windows
  before release.

## Trust and Privacy

Shopping extensions operate in a low-trust category because broad page access
and affiliate behavior are difficult for users to inspect. Chrome recommends
requesting only permissions that are necessary and explaining them.

Product requirements:

- Process shopping-page evidence locally by default.
- Do not collect browsing history, cart contents, account information, or form
  values.
- Do not insert affiliate links or replace retailer attribution.
- If a future remote model is used, require explicit opt-in and show exactly
  what page evidence leaves the device.
- Display calculation conditions and loaded-result scope in user language.
- Keep extraction confidence internal. The external trust mechanism is
  evidence, conservative abstention, and reproducible arithmetic.

## Validation Plan

### Phase 1: Concept testing

Run two formative rounds with 6 to 8 participants each. Include frequent online
grocery shoppers, budget-constrained shoppers, people who do not currently use
unit pricing, an older-adult cohort, and participants with low vision or
numeracy challenges.

Compare three result-card concepts:

- Normalized price only.
- Normalized price plus `Lowest of N`.
- Normalized price with an explicit calculation affordance.

Do not test a sidebar concept again unless new evidence overturns the settled
constraint.

Tasks:

- Find the cheapest cat litter per pound when cards mix pounds and ounces.
- Decide whether a larger package is cheaper per unit.
- Check whether a loyalty or coupon offer changes the comparison.
- Sort by unit price and restore the retailer order.
- Explain what the normalized number means and what products it was compared
  against.

### Phase 2: Quantitative benchmark

Use a counterbalanced within-subject study against the unmodified retailer UI.
Start with a pilot, then perform a power analysis for the observed effect and
discordant-pair rate. A provisional sample of 48 participants is appropriate
for planning, but it is not a substitute for that power analysis.

Release gates:

| Measure | Gate |
| --- | ---: |
| Correct lowest-unit-price selection, common cases | at least 95% |
| Correct selection, promotions and mixed-pack cases | at least 90% |
| Correct explanation of denominator | at least 90% |
| Correct understanding of loaded-results scope | at least 90% |
| Median comparison time versus retailer baseline | at least 30% faster |
| Accidental interaction or retailer control breakage | 0 critical events |
| Preference and sort completion by keyboard | 100% |

Track confidence in the participant's answer as a research measure only. It
must not become an extraction label in the product UI.

### Phase 3: Technical and visual validation

For every supported release candidate:

- Playwright tests at desktop, narrow desktop, 200% zoom, and 320 CSS-pixel
  reflow.
- Screenshot comparison with the sort menu closed, open, selected, and restored.
- Pixel and geometry assertions for clipping, overlap, card reflow, and menu-row
  alignment.
- Keyboard tests for opening the retailer sort, reaching the injected option,
  selecting it, closing it, and restoring the original order.
- Screen-reader checks of at least one normalized line, the lowest signal, the
  sort command, and popup status.
- Functional assertions that add-to-cart, variant controls, retailer sorting,
  pagination, and infinite-scroll hydration still work.
- Gold-data assertions that every displayed number and condition is
  reproducible from captured evidence.
- Live checks on at least Walmart, Amazon, Target, a grocery chain, a pharmacy,
  a pet retailer, an office-supply retailer, and two previously unseen domains.

### Phase 4: Opt-in field beta

Run a two-week beta with 25 to 50 users. Prefer local event summaries; any
telemetry must be opt-in and documented.

Measure:

- Pages with at least one valid comparison.
- Comparisons shown and deliberately abstained.
- Use and restoration of unit-price sorting.
- Duplicate native values prevented.
- User-reported wrong numbers, missing numbers, layout damage, and confusing
  conditions.
- Retention after one and two weeks.

No accuracy claim is made from engagement telemetry. Display accuracy remains a
gold-labeled evidence test.

## Implementation Gates

The next UI implementation should proceed in this order:

1. **Duplicate suppression:** do not render a second value when the retailer
   already shows the same normalized basis and value.
2. **Comparison-set basis:** select and hold one denominator per comparable
   result group.
3. **Plain inline treatment:** replace the boxed badge with a retailer-adjacent
   text line and accessible expanded label.
4. **Basis-specific sorting:** name the denominator, communicate selection, and
   define the placement of noncomparable cards.
5. **Toolbar status:** make automatic scanning and loaded-result scope clear.
6. **Lowest-of-N experiment:** implement behind a preference or experiment flag
   and promote only after usability evidence.
7. **Conditional prices:** add only after promotion-to-price binding has its own
   accuracy gate.
8. **Pack insights:** add only after exact product-family and variant matching
   has its own precision gate.
9. **Historical and cross-retailer insights:** treat as a separate data product
   with delivered-price, identity, privacy, and retention requirements.

Each gate requires fixture, visual, keyboard, and live validation before moving
to the next. This prevents extraction, calculation, and presentation failures
from being debugged as one undifferentiated problem.

## Sources

- [NIST SP 1181, Unit Pricing Guide (2025)](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=960284)
- [NIST, Uniform Unit Pricing: Tools for Consumers to Fight Shrinkflation](https://www.nist.gov/programs-projects/uniform-unit-pricing-tools-consumers-fight-shrinkflation)
- [CMA, Unit pricing analysis and consumer research](https://www.gov.uk/government/publications/unit-pricing-analysis-and-consumer-research)
- [CMA qualitative consumer research](https://assets.publishing.service.gov.uk/media/65b7a5e9c5aacc000da68468/__Unit_pricing_qualitative_research_report_-_Basis_Social.pdf)
- [CMA grocery unit-pricing analysis](https://assets.publishing.service.gov.uk/media/65b8c153b5cb6e000d8bb747/___Groceries_unit_pricing_pricing_analysis_2__.pdf)
- [ACCC, Unit prices for groceries](https://www.accc.gov.au/consumers/pricing/unit-prices-for-groceries)
- [Miyazaki, Sprott, and Manning, Unit prices on retail shelf labels](https://discovery.fiu.edu/display/pub109095)
- [Yao and Oppewal, Unit pricing matters more when consumers are under time pressure](https://research.monash.edu/en/publications/unit-pricing-matters-more-when-consumers-are-under-time-pressure/)
- [Mortimer and Weeks, How unit price awareness and usage encourages grocery brand switching and expenditure](https://ideas.repec.org/a/eee/joreco/v49y2019icp346-356.html)
- [Amazon, price per unit in search results](https://www.aboutamazon.com/news/retail/best-amazon-shopping-tips)
- [Target grocery result listings](https://www.target.com/c/grocery/-/N-5xt1a%3FNao%3D360)
- [Keepa Chrome Web Store listing](https://chromewebstore.google.com/detail/keepa-amazon-price-tracke/neebplgakaahbhdphmkckjjcegoiijjo)
- [Google Chrome Shopping Insights](https://support.google.com/chrome/answer/11625545)
- [Honey on Amazon](https://help.joinhoney.com/article/46-can-i-use-honeyon-amazon)
- [Capital One Shopping](https://www.capitalone.com/learn-grow/money-management/capital-one-shopping/)
- [Rakuten browser extension](https://www.rakuten.com/blog/rakuten-cash-back-button-how-it-works/)
- [Unit Price Shopper Chrome Web Store listing](https://chromewebstore.google.com/detail/unit-price-shopper/gakicmkmdmcgdilpegbfnffnihcpgdbf)
- [Unit Price Helper Chrome Web Store listing](https://chromewebstore.google.com/detail/unit-price-helper/edclfclmeehfhbdkoliopgbjgfifnoln)
- [UnitNormalize Firefox listing](https://addons.mozilla.org/en-GB/firefox/addon/unitnormalize/)
- [Chrome extension UI components](https://developer.chrome.com/docs/extensions/develop/ui)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Menu Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/)
- [Chrome extension permission guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
