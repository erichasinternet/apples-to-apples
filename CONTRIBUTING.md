# Contributing

This project is private, but changes should still meet the same bar as a public extension repo.

## Local Setup

```bash
bun install
bun run build
```

Load `dist` as an unpacked extension from `chrome://extensions` or `brave://extensions`.

## Development Checks

Run the fast local gate before opening a pull request:

```bash
bun run verify
```

Run the browser fixture suite before merging behavior that touches extraction, rendering, sorting, or extension loading:

```bash
bun run test:e2e
```

Live retailer smoke tests are opt-in because retailer pages vary by account, location, bot defenses, and experiments:

```bash
LIVE_SHOPPING_TESTS=1 bun run test:live
```

## Commit Style

Commits use Conventional Commits:

```text
feat: add target unit-price adapter
fix: keep walmart unit sort on its own row
test: cover nested retailer sort menu
chore: update dependency gates
```

Husky runs `bun run verify` before each commit and Commitlint checks the commit message.

## Pull Request Expectations

- Keep changes scoped to one behavior or maintenance concern.
- Add or update tests for parser, extractor, sorting, or UI behavior changes.
- Include screenshots or DOM evidence for retailer-specific UI fixes.
- Do not commit generated `dist`, Playwright reports, test results, or local profiles.
