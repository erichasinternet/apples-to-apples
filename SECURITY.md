# Security Policy

## Supported Versions

The current `main` branch is the only supported version.

## Reporting a Vulnerability

Because this repository is private, report vulnerabilities directly to the repository owner or open a private GitHub issue.

Include:

- Affected browser and extension version.
- The retailer or page where the issue occurs.
- Reproduction steps.
- Whether browsing data, page contents, or extension permissions are involved.

## Security Model

- No backend service is required.
- Product browsing data is not transmitted by the extension.
- Content scripts auto-run only on declared shopping hosts.
- Manual scanning on arbitrary pages uses `activeTab`.
- The extension should avoid broad host permissions beyond supported retailers and local fixtures.
