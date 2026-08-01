# Chrome Web Store Release

## Release Command

```bash
bun install --frozen-lockfile
bun run release
```

The command runs verification and extension E2E tests, rebuilds the store
artwork from a sanitized shopping fixture, validates manifest and image
requirements, and writes a source-map-free ZIP plus SHA-256 file under
`artifacts/releases/`.

## Package Checks

- `manifest.json` is at the ZIP root.
- Manifest and package versions match.
- Only `scripting` and `storage` API permissions are requested.
- Host access is limited to HTTP and HTTPS pages.
- All extension and listing PNGs have exact required dimensions.
- The package contains the local privacy policy and no source maps.
- The package contains the third-party attribution notice.
- The extension contains no runtime dependencies or remotely hosted code.

## Developer Dashboard

1. Register and verify the publisher account.
2. Create a new item and upload `artifacts/releases/apples-to-apples-<version>.zip`.
3. Enter the copy from `store-assets/STORE_LISTING.md`.
4. Upload the icon, screenshots, and small promotional image from
   `store-assets/listing/`.
5. Enter the public privacy-policy URL:
   `https://gist.github.com/erichasinternet/a4a9b597e89fee8b7b814b3b9baff72b`.
6. Complete the permission justifications and data-use declarations exactly as
   documented in the listing file.
7. Choose private visibility and add trusted testers for the first review.
8. Use deferred publishing so approval does not immediately create a public
   rollout.

## Trusted-Tester Gate

- Verify install, update, disable, and uninstall behavior in Chrome and Brave.
- Run the opt-in live-site matrix and record blocked or changed sites.
- Complete keyboard testing at 100% and 200% zoom.
- Complete VoiceOver testing on macOS and one Chromium screen reader on Windows.
- Confirm no retailer controls, cart actions, pagination, or account UI are
  obstructed.
- Review every reported incorrect unit price before public rollout.

## Public Rollout Gate

- At least 25 trusted testers over two weeks.
- No unresolved critical layout or calculation errors.
- Store listing claims remain limited to loaded-page, evidence-backed behavior.
- Privacy policy, support destination, screenshots, and version metadata remain
  current.
