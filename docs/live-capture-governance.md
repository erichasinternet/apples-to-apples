# Live Capture Governance

Live captures are private research source material. They are collected only from
public shopping pages in a fresh browser context with no imported cookies, local
storage, account session, or browser profile.

Before artifacts are admitted:

- The rendered main region is redacted for email, phone, location, account, and
  credential patterns.
- Scripts, frames, hidden content, form state, remote media URLs, event handlers,
  session-like attributes, and URL query strings are removed.
- Requested, final, observation, and product URLs are reduced to origin plus path.
- HTML, observation, and candidate metadata pass the privacy audit.
- Screenshots are taken only after in-page redaction.

Each accepted page has `provenance.json`, which records the source-manifest hash,
collector-code hash, privacy-policy version, and a sorted SHA-256 manifest of every
immutable source artifact. Annotation and review files are excluded because they
are separately versioned append-only labels.

Capture validation recomputes every asset and aggregate hash. Any source mutation,
missing asset, privacy finding, or provenance mismatch quarantines the page.

Raw HTML and screenshots are not committed or redistributed. A public release
requires a separate rights and privacy review and should prefer derived
observations, pointer labels, aggregate metrics, and generated fixtures.

## Viewport Sampling

Corpus runs default to a deterministic mixed viewport plan. After target
selection, exactly `ceil(pages * 0.25)` pages receive a 390 by 844 narrow
viewport and the remainder receive a 1440 by 1000 desktop viewport. The run
manifest records the policy and every page assignment.

Use `--viewport desktop` or `--viewport narrow` for controlled slices. Use
`--narrow-share <0..1>` to change the mixed-run share. The seed controls both
target selection and viewport assignment, so rerunning the same command produces
the same plan.

## Capture Budgets

The bounded observation, sanitized HTML, annotation screenshot, and candidate
records are written before optional per-card screenshots. Page metadata and
provenance are finalized after those optional attempts. Per-card screenshots
share a 15-second aggregate budget and use short individual timeouts; missing
card thumbnails do not invalidate otherwise complete source evidence. The
default page deadline is 120 seconds. Both limits and the captured thumbnail
count are recorded in the run and page metadata.

Use `--page-timeout-ms` and `--card-screenshot-budget-ms` only for controlled
qualification experiments. The screenshot budget cannot exceed half the page
deadline.
