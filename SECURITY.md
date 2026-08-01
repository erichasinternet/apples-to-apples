# Security Policy

## Supported Versions

Security fixes are applied to the latest release and the current `main` branch.
Older unpacked builds and research checkpoints are not supported.

| Version | Supported |
| --- | --- |
| 0.4.x | Yes |
| < 0.4 | No |

## Reporting A Vulnerability

Do not open a public issue or discussion for a suspected vulnerability.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Select **Advisories** and **Report a vulnerability**.
3. Include affected versions, browser and OS, reproduction steps, impact, and
   any proposed mitigation.

Remove unrelated personal data from screenshots and logs. Do not include active
tokens, cookies, account credentials, addresses, order history, or private
browsing information.

The maintainer will acknowledge a report within seven days, provide an initial
assessment within fourteen days, and coordinate disclosure after a fix is
available. Timelines may change based on severity and complexity.

## Security Model

- The extension has no backend, analytics, advertising, affiliate-link
  replacement, account system, or remote model call.
- Product evidence is read from the current page and processed locally.
- Preferences are stored in local extension storage.
- The extension contains no runtime package dependencies or remotely hosted
  code.
- Manifest V3 isolates extension code from page JavaScript.
- Release ZIPs exclude source maps and include third-party notices.

The extension requests access to HTTP and HTTPS pages because unknown-site
support is part of its single purpose. The content script scans visible DOM
evidence and emits no UI when a page does not establish a safe comparison. The
`scripting` permission is used only for a user-requested rescan from the popup.

## Security Boundaries

The following are treated as untrusted input:

- Retailer DOM, structured data, product titles, prices, and package labels.
- Messages received by extension contexts.
- Public contribution content and test fixtures.
- Live-site capture output before privacy validation.

Changes that add network transmission, remote code, new permissions, telemetry,
or persistent product-history storage require a separate privacy and security
review.

## Disclosure And Safe Harbor

Good-faith research that avoids privacy violations, service disruption, data
destruction, and access beyond the reporter's own accounts is welcome. Allow a
reasonable remediation period before public disclosure.

The current audit record and residual risks are documented in
`docs/security-audit.md`.
