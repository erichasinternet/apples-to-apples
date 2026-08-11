# Contributing

Thanks for helping make unit-price comparison more reliable. Contributions to
code, tests, documentation, accessibility, and research methodology are
welcome.

By contributing, you agree that your contribution is licensed under the MIT
License. Public dataset exports retain the dataset-specific license documented
in `docs/huggingface-dataset-release.md`.

## Before You Start

- Search existing issues and discussions before opening a duplicate.
- Use an issue for substantial behavior, permission, privacy, or data-contract
  changes before investing in an implementation.
- Report security vulnerabilities privately as described in `SECURITY.md`.
- Never post account details, addresses, cookies, tokens, private browsing data,
  or unredacted live-site captures.

## Local Setup

Required:

- Bun 1.3.14 or later.
- Chromium 120 or later, Chrome, or Brave.

```bash
git clone https://github.com/erichasinternet/apples-to-apples.git
cd apples-to-apples
bun install --frozen-lockfile
bunx playwright install chromium
bun run build
```

Load `dist` as an unpacked extension from `chrome://extensions` or
`brave://extensions`.

The optional model-training environment requires Python 3.11 or 3.12 and
[`uv`](https://docs.astral.sh/uv/):

```bash
uv sync --project training --locked
```

## Development Workflow

1. Fork the repository and create a focused branch from `main`.
2. Make the smallest coherent change that solves the issue.
3. Add tests proportional to the behavior and regression risk.
4. Run the required local checks.
5. Open a pull request using the repository template.

Use `apply_patch`-style focused edits or equivalent tooling that preserves
unrelated work. Do not commit generated `dist`, Playwright reports, test
results, browser profiles, secrets, or raw live captures.

## Required Checks

Fast validation:

```bash
bun run verify
```

Browser behavior and extension loading:

```bash
bun run test:e2e
```

Submission packaging changes:

```bash
bun run release
```

Live retailer smoke tests are opt-in because pages vary by location,
personalization, experiments, and bot defenses:

```bash
bun run test:live
```

Only collect live research data under `docs/live-capture-governance.md`. Raw
HTML and screenshots must not be committed or redistributed.

## Code And Test Expectations

- Prefer existing project patterns and deterministic parsers.
- Fail conservatively when product evidence is incomplete or ambiguous.
- Keep measurement dimensions isolated; never compare mass with volume, count,
  area, or length.
- Treat retailer DOM as untrusted input. Use `textContent` and structured DOM
  APIs instead of HTML string injection.
- Keep runtime processing local unless a separately reviewed design explicitly
  changes the privacy model.
- Add unit tests for extraction and normalization changes.
- Add Playwright coverage for rendering, sorting, permissions, or user-flow
  changes.
- Include sanitized screenshots for visible UI changes.

## Commit Style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(extension): support a new package pattern
fix(extraction): reject display dimensions
test(sort): cover a nested retailer menu
docs(security): clarify vulnerability reporting
```

Husky runs `bun run verify` before commits, and Commitlint validates commit
messages. Contributors remain responsible for understanding and validating all
submitted code, including AI-assisted changes.

## Pull Request Review

Pull requests should explain the user-facing problem, implementation boundary,
privacy or permission impact, and validation performed. A maintainer may ask for
additional fixtures, accessibility evidence, or live-site proof before merging.

All CI, CodeQL, and dependency-review checks must pass. Approval does not imply
that a change will ship immediately; Chrome Web Store releases use the separate
gates in `docs/chrome-web-store-release.md`.
