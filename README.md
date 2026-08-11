# Apples to Apples Unit Price Compare

[![CI](https://github.com/erichasinternet/apples-to-apples/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/erichasinternet/apples-to-apples/actions/workflows/ci.yml)
[![CodeQL](https://github.com/erichasinternet/apples-to-apples/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/erichasinternet/apples-to-apples/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-236652.svg)](LICENSE)

![Apples to Apples logo](public/icons/icon-128.png)

Chrome extension and extraction research project for comparing shopping-unit prices across major retailers and unfamiliar shopping pages.

The extension is preparing for a private trusted-tester Chrome Web Store
release. It is not yet presented as a universally accurate public release.

## Quick Start

```bash
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
```

Load the generated `dist` directory from `chrome://extensions` or
`brave://extensions` with developer mode enabled.

## What It Does

- Detects product cards on supported shopping sites and generic shopping grids.
- Extracts visible price, native unit price, package size, and multipack evidence.
- Normalizes within compatible dimensions only: weight, volume, count, area, and length.
- Leaves a matching retailer unit price untouched and adds a plain inline value only when normalization adds information.
- Marks `Lowest of N` only when at least three items in the same loaded product collection establish that fact.
- Adds basis-specific options such as `Unit price per lb: low to high` to verified retailer sort menus.
- Provides loaded-page status, safe sort/restore controls, rescan, and preferences in the extension popup.
- Auto-runs the conservative generic extractor on HTTP(S) pages without requiring a retailer-specific hostname.

The extension fails conservatively. If it cannot prove the unit relationship, it skips the comparison instead of guessing.
The page sort is similarly conservative: it only reorders comparable cards that are already visible in the current DOM and keeps unrelated unit groups in their existing slots.

## Site Coverage

The extension auto-runs on HTTP(S) pages and emits nothing unless it finds
product-card evidence that passes the conservative extraction rules. Walmart,
Amazon, Target, Costco, and Chewy retain optional compatibility adapters, but
normalization does not require a known hostname. The extension requests broad
site access because an unfamiliar shopping site cannot be scanned automatically
with a fixed hostname allowlist.

## Project Layout

- `src/core`: pure parser, unit conversion, and normalization logic.
- `src/content`: DOM extraction, site adapters, structured data fallback, and page renderer.
- `src/learning`: site-independent page observations, model contracts, and deterministic evidence validation.
- `src/extension`: MV3 service worker and shared preference storage.
- `src/popup`: active-page status and safe loaded-item sort controls.
- `src/options`: preferences UI.
- `tests/unit`: parser and fixture tests.
- `tests/e2e`: Playwright extension tests and optional live-site smoke tests.
- `benchmarks/live-sites`: live-corpus sampling frame and annotation contract.
- `training`: pinned Python environment and T5Gemma 2 LoRA configuration.

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
bun run benchmark:coverage
bun run benchmark:validate -- benchmark-data/live/<run-id>
bun run benchmark:evaluate -- benchmark-data/live/<run-id>
bun run benchmark:model:validate -- <observation.json> <model-extraction.json>
bun run benchmark:model:evaluate -- benchmark-data/live/<run-id>
bun run benchmark:training:export -- benchmark-data/live/<run-id> --output benchmark-data/training/development.jsonl
bun run training:readiness -- benchmark-data/live/<run-id>
bun run training:prepare -- benchmark-data/live/<run-id> --output benchmark-data/training/t5gemma2
bun run training:validate
bun run training:synthetic:generate
bun run training:synthetic:audit
bun run training:synthetic:validate
bun run dataset:huggingface:prepare
bun run dataset:huggingface:validate
bun run training:inference:prepare
bun run training:inference:discover
bun run training:inference:analyze-discovery
bun run training:silver:prepare
bun run training:silver:validate
```

See [docs/benchmark-protocol.md](docs/benchmark-protocol.md) for sampling, domain-held-out splits, annotation, privacy, and statistical analysis. The [learned extraction experiment](docs/learned-extraction.md) defines the evidence contract and model promotion gates.
The [training runbook](docs/training.md) covers dataset readiness, strict export, the
T5Gemma 2 LoRA configuration, and GPU execution.
The public [Unit Price Evidence: Synthetic dataset](https://huggingface.co/datasets/hotdogsalesman/unit-price-evidence-synthetic)
and its [release runbook](docs/huggingface-dataset-release.md) define the
synthetic-only public boundary, release quality gates, licensing, validation,
and private-first upload process.
The [autoresearch protocol](docs/autoresearch.md) records the experiment loop,
checkpoint results, cost controls, and promotion gates.
The [MVP validation record](docs/mvp-validation.md) defines the accepted
deterministic scope, exact test results, live-site availability, and remaining
learned-model gates.
The [UX research and product design](docs/ux-research-and-product-design.md)
defines the evidence-backed interaction model, information hierarchy,
accessibility requirements, and usability gates for the next UI iteration.

## Repository Gates

- `bun run verify` runs the fast local gate: TypeScript plus unit tests.
- `bun run test:e2e` builds the MV3 extension and runs Playwright fixture tests.
- `bun run ci` runs the full default CI gate.
- Husky runs `bun run verify` before commits.
- Commitlint enforces Conventional Commits for commit messages.

## Contributing And Support

- Read the [contribution guidelines](.github/CONTRIBUTING.md) before opening a pull request.
- Use [GitHub Discussions](https://github.com/erichasinternet/apples-to-apples/discussions)
  for usage questions and early ideas.
- Use the issue forms for reproducible bugs and feature proposals.
- Report vulnerabilities privately according to the [security policy](.github/SECURITY.md).
- Project decisions and maintainer roles are documented in
  [governance policy](.github/GOVERNANCE.md).

## Loading In Brave

1. Run `bun run build`.
2. Open `brave://extensions`.
3. Enable developer mode.
4. Choose **Load unpacked** and select the repository's `dist` directory.
5. Reload any shopping tabs that were already open.

Brave shows a broad site-access warning because automatic unknown-site support
requires the content script to inspect public HTTP(S) shopping pages. Product
evidence is processed locally by the extension; the MVP does not send page
content to a model or remote service.

The same unpacked build can be loaded from `chrome://extensions` in Chrome.

## Chrome Web Store Release

Version `0.4.0` includes store icons, local privacy disclosures, sanitized
listing artwork, permission justifications, and reproducible packaging. Build
and validate the submission artifact with Bun:

```bash
bun run release
```

The ZIP and SHA-256 file are written under `artifacts/releases/`. Store copy and
image paths are recorded in
[store-assets/STORE_LISTING.md](store-assets/STORE_LISTING.md). The complete
submission and trusted-tester checklist is in
[docs/chrome-web-store-release.md](docs/chrome-web-store-release.md). The
[public privacy policy](https://gist.github.com/erichasinternet/a4a9b597e89fee8b7b814b3b9baff72b)
matches the policy bundled with the extension.

## Validation Strategy

The quality bar is layered:

- Unit tests cover parsing examples such as `$1.76/lb`, `9.2 ¢/oz`, `12 x 16.9 fl oz`, `4 Pack of 25 count`, and `612 sq ft`.
- Fixture tests cover stable Walmart-style and generic product grids.
- Playwright tests load the built MV3 extension into Chromium and verify duplicate suppression, inline geometry, native/custom sort integration, popup messaging, action-badge status, keyboard use, and unobstructed add-to-cart controls.
- Sort tests verify basis-specific ordering, mixed-unit isolation, structural safety, and restoration of the retailer's original order.
- Live smoke tests check a small rotating retailer matrix when explicitly enabled.
- Unknown-site experiments measure card discovery and evidence-grounded fact extraction separately on domains held out from training.
- Training export accepts only development domains with complete bounded-region coverage, field-level evidence, adjudication, and two reviewers.
- T5Gemma 2 training uses domain-disjoint train and validation subsets and leaves the benchmark selection and held-out domains sealed.

## Design Principles

The UI is intentionally quiet:

- Normalized values inherit the retailer's typography and have no box, pill, warning icon, or confidence label.
- Matching native values are not duplicated.
- `Lowest of N` states its loaded-page scope.
- The extension uses a verified retailer sort menu when available and the user-invoked popup otherwise.
- The popup reports status and controls only; it does not repeat the product list.

## License

Application source and documentation are available under the [MIT License](LICENSE).
Third-party components retain their original terms in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The separately generated [**Unit Price Evidence: Synthetic** dataset](https://huggingface.co/datasets/hotdogsalesman/unit-price-evidence-synthetic)
is released under CDLA-Permissive-2.0 as documented in
[docs/huggingface-dataset-release.md](docs/huggingface-dataset-release.md). Raw
live retailer captures are not licensed for redistribution and are not committed.
