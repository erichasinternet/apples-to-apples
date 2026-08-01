# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-08-01

### Added

- Chrome Web Store icons, screenshots, listing copy, and reproducible release
  packaging.
- A bundled and publicly hosted privacy policy.
- Sanitized store-listing fixtures and automated visual validation.

### Changed

- Preferences now use local extension storage.
- Manifest permissions were reduced by removing the redundant `activeTab`
  permission.

### Security

- Release packages exclude source maps and include third-party notices.
- Development dependencies were updated and audited.

## [0.3.1] - 2026-08-01

### Fixed

- Rejected physical product dimensions such as laptop screen size and chassis
  measurements as unit-price quantities.
- Improved model-disagreement adjudication and false-positive coverage.

[Unreleased]: https://github.com/erichasinternet/apples-to-apples/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/erichasinternet/apples-to-apples/releases/tag/v0.4.0
[0.3.1]: https://github.com/erichasinternet/apples-to-apples/commit/5e9492b6880c822f766416dccbbf7bc47ca83de7
