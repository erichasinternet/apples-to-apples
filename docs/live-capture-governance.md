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
