# Public Repository Security Audit

**Audit date:** August 1, 2026
**Scope:** Extension 0.4.0, repository history, Bun and Python dependency locks,
GitHub Actions, release packaging, tracked research artifacts, and public
repository controls.

## Decision

The source tree is suitable for public release. The audited changes are merged
and GitHub's public-repository security controls are enabled. No known
credential leak, vulnerable locked dependency, critical code finding, or
personal live-capture artifact remains in the repository.

This decision covers source publication. It does not replace the Chrome Web
Store trusted-tester, accessibility, or live-site accuracy gates.

## Results

| Area | Method | Result |
| --- | --- | --- |
| Git history | Gitleaks 8.30.1 over all 153 commits | 0 leaks |
| Bun and Python locks | OSV-Scanner 2.4.0 | 0 known vulnerabilities across 331 packages |
| Bun dependency audit | `bun audit` | 0 vulnerabilities |
| Workflow syntax | Actionlint 1.7.12 and ShellCheck 0.11.0 | 0 findings |
| Workflow security | Zizmor 1.29.0, pedantic online audit | 0 findings |
| GitHub CodeQL | TypeScript and Python default security suites | 1 test-harness finding remediated; 1 reviewed false positive dismissed |
| Runtime dependencies | Manifest and bundle review | No runtime packages or remote code |
| Network behavior | Source search and bundle review | No extension telemetry or page-data transmission |
| DOM injection | Manual sink review | One bounded `innerHTML` sink removed; runtime uses DOM APIs and `textContent` |
| Permissions | Manifest and call-site review | `storage` and `scripting` justified; broad HTTP(S) host access remains intentional |
| Release artifact | Reproducible ZIP validation | Root manifest, no source maps, icons/privacy/notices present |
| Research data | Tracked-file and sensitive-pattern review | No raw live HTML/screenshots, addresses, account data, cookies, or query strings found |
| Third-party rights | Notice and data-license review | Lucide ISC notice packaged; synthetic export remains CDLA-Permissive-2.0 |

## Resolved Findings

### Stale security policy

The previous policy described an obsolete `activeTab` permission and fixed-host
allowlist. It now documents the actual broad-host, local-only unknown-site model
and private vulnerability reporting.

### Mutable GitHub Action references

CI previously referenced version tags. All workflow actions are now pinned to
verified full commit SHAs, checkout credentials are not persisted, and job
permissions are explicit.

### HTML injection sink

The renderer assembled a small escaped badge fragment with `innerHTML`. Although
the displayed value was escaped and the remaining content was numeric, it now
constructs nodes with `createElement` and `textContent`, removing the sink.

### Missing public security automation

The repository now defines read-only pull-request CI, dependency review,
JavaScript/TypeScript and Python CodeQL analysis, weekly Dependabot updates, and
a tag-only release workflow. The release job receives `contents: write` only for
publishing its already validated ZIP and checksum.

### Dynamic test-harness code construction

CodeQL identified a unit test that interpolated a temporary marker path into a
Node `-e` program. The value was locally generated and shell-escaped, but the
test now passes it as a normal process argument to a fixed fixture script. No
dynamic code construction remains in that process-tree test.

### Pseudonymous prediction identifier finding

CodeQL classified the MarkupLM prediction record's `id` field as private data
written in clear text. The field is a required pseudonymous join key from the
privacy-validated research bundle, not a user identifier or credential. The
output is a caller-requested local JSONL artifact under ignored research paths.
The alert was reviewed and dismissed as a false positive; changing or
encrypting the field would break deterministic prediction scoring without
improving confidentiality.

## Residual Risks

### Broad host access

Automatic support for unfamiliar stores requires content-script access to HTTP
and HTTPS pages. This is the largest privilege boundary. Mitigations are local
processing, no network transmission, no persistent product history, isolated
world execution, conservative extraction, and explicit store disclosures.

### Untrusted and changing retailer DOM

Retailer markup can cause incorrect comparisons, performance regressions, or
layout interference without constituting code execution. Deterministic fixtures,
false-positive tests, unobstructed-control tests, live smoke tests, and a
trusted-tester period reduce but cannot eliminate this risk.

### Live-site validation availability

Bot defenses prevented nine sites in the latest headless live matrix from
rendering. These were recorded as unavailable rather than counted as passes.
Public claims must remain limited to loaded-page, evidence-backed behavior.

### Development credentials

Model-training credentials are loaded from environment variables or Modal
secrets and were not found in Git. Credentials shared out of band during
development should still be rotated before a public launch and must never be
added to repository or Actions secrets unless a workflow requires them.

## GitHub Controls

The public repository has:

- Dependabot alerts, security updates, and weekly dependency update pull
  requests.
- Secret scanning and push protection. Generic non-provider patterns and
  validity checks are not available for this personal public repository.
- Private vulnerability reporting.
- CodeQL on `main`, pull requests, and the weekly schedule.
- `main` protection with pull-request review, required CI, linear history,
  conversation resolution, and blocked force pushes and deletions.
- Read-only Actions permissions by default and immutable action SHAs.

## Reproduction

```bash
bun install --frozen-lockfile
bun audit
bun run verify
bun run test:e2e
bun run release
gitleaks git . --redact
osv-scanner scan source -r .
actionlint .github/workflows/*.yml
```

The external scanners are audit tools, not project runtime dependencies.
