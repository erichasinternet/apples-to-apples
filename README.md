# Apples to Apples Unit Price Compare

Chrome extension for comparing shopping-unit prices across major retailers and arbitrary shopping pages.

## What It Does

- Detects product cards on supported shopping sites and generic shopping grids.
- Extracts visible price, native unit price, package size, and multipack evidence.
- Normalizes within compatible dimensions only: weight, volume, count, area, and length.
- Renders compact unit-price badges on the page.
- Adds `Unit price: low to high` to native and custom sort dropdowns when available, with a delayed inline fallback only when the retailer has no usable sort control.

The extension fails conservatively. If it cannot prove the unit relationship, it skips the comparison instead of guessing.
The page sort is similarly conservative: it only reorders comparable cards that are already visible in the current DOM and keeps unrelated unit groups in their existing slots.

## Supported Auto-Run Sites

- Walmart
- Amazon
- Target
- Costco
- Sam's Club
- Chewy
- Petco
- Kroger
- Instacart
- Walgreens
- CVS
- Home Depot
- Lowe's
- Staples
- Office Depot

Any other page can be scanned manually from the extension popup via `activeTab`.

## Project Layout

- `src/core`: pure parser, unit conversion, and normalization logic.
- `src/content`: DOM extraction, site adapters, structured data fallback, and page renderer.
- `src/extension`: MV3 service worker and shared preference storage.
- `src/popup`: popup UI for scanning the active tab.
- `src/options`: preferences UI.
- `tests/unit`: parser and fixture tests.
- `tests/e2e`: Playwright extension tests and optional live-site smoke tests.
- `benchmarks/live-sites`: live-corpus sampling frame and annotation contract.

## Commands

```bash
bun install
bun run build
bun run verify
bun run test
bun run typecheck
bun run test:e2e
```

Optional live retailer smoke tests:

```bash
LIVE_SHOPPING_TESTS=1 bun run test:live
```

Live tests are intentionally not part of the default gate because retailer pages vary by location, personalization, bot defenses, and page experiments.

The statistically designed live-site corpus is separate from smoke testing:

```bash
bun run benchmark:collect -- --headed --per-site 1 --sites walmart,amazon,target,chewy
bun run benchmark:validate -- benchmark-data/live/<run-id>
bun run benchmark:evaluate -- benchmark-data/live/<run-id>
```

See [docs/benchmark-protocol.md](docs/benchmark-protocol.md) for sampling, domain-held-out splits, annotation, privacy, and statistical analysis.

## Repository Gates

- `bun run verify` runs the fast local gate: TypeScript plus unit tests.
- `bun run test:e2e` builds the MV3 extension and runs Playwright fixture tests.
- `bun run ci` runs the full default CI gate.
- Husky runs `bun run verify` before commits.
- Commitlint enforces Conventional Commits for commit messages.

See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request expectations.

## Loading Locally

1. Run `bun run build`.
2. Open `chrome://extensions`.
3. Enable developer mode.
4. Load the `dist` directory as an unpacked extension.

## Validation Strategy

The quality bar is layered:

- Unit tests cover parsing examples such as `$1.76/lb`, `9.2 ¢/oz`, `12 x 16.9 fl oz`, `4 Pack of 25 count`, and `612 sq ft`.
- Fixture tests cover stable Walmart-style and generic product grids.
- Playwright tests load the built MV3 extension into Chromium and verify badge rendering, native/custom sort integration, inline fallback sorting, and that add-to-cart controls remain clickable.
- Sort tests verify that comparable cards can be reordered by unit price and restored to the retailer's original order.
- Live smoke tests check a small rotating retailer matrix when explicitly enabled.

## Design Principles

The UI is intentionally compact:

- Badges behave like shelf tags.
- The extension uses the retailer's sort dropdown when it can identify a visible native or custom sort control.
- A small inline fallback appears near the product grid only when no usable retailer sort control appears after the page settles.
- No quality labels are shown in the shopping UI.

## License

Private and unlicensed. All rights reserved.
