# Chrome Web Store Listing

## Product Details

**Name**

Apples to Apples: Unit Price Compare

**Summary**

Compare shopping prices in one consistent unit, including weight, volume,
count, area, and length.

**Category**

Shopping

**Language**

English (United States)

## Detailed Description

Compare package prices without converting ounces, pounds, liters, counts, or
square feet in your head.

Apples to Apples reads visible product prices and package quantities, then adds
a quiet normalized unit price when that calculation provides useful new
information. Products are compared only within compatible measurements, so
weight is never mixed with volume or count.

Features:

- Normalizes weight, volume, count, area, and length prices.
- Uses retailer-provided unit prices when available.
- Skips ambiguous products instead of guessing.
- Marks the lowest price only within a verified group of comparable loaded
  items.
- Adds unit-price sorting to compatible retailer menus.
- Provides safe sort and restore controls for items already loaded on the page.
- Keeps display-unit preferences on your device.

Sorting applies only to comparable products currently loaded in the page. The
extension does not change retailer prices, request unseen search pages, insert
affiliate links, or determine whether coupons and membership rewards apply.

Page contents and calculations are processed locally. The extension contains
no advertising, telemetry, account system, or remote AI service.

Apples to Apples is independent and is not affiliated with or endorsed by any
retailer.

## Privacy Practices

**Privacy policy URL**

https://gist.github.com/erichasinternet/a4a9b597e89fee8b7b814b3b9baff72b

**Single purpose**

Read visible shopping-product evidence and present normalized unit prices and
loaded-item sorting so users can compare package value consistently.

**Permission justification: storage**

Stores the user's enabled state, lowest-price display choice, and preferred
measurement units locally on the device.

**Permission justification: scripting**

Injects the packaged content script when the user explicitly requests a rescan
from the popup on an already-open page where the script is not active. No code
is downloaded or executed remotely.

**Permission justification: host access**

Runs the product-evidence scanner on HTTP and HTTPS pages so unit-price
comparison can work on unfamiliar shopping sites rather than a fixed retailer
allowlist. Page content is processed locally and is not transmitted or retained.

**Data-use disclosures**

- Website content: yes; visible shopping evidence is processed temporarily on
  the device and is not transmitted or retained.
- Web browsing activity: yes; the current page hostname is used temporarily to
  select compatible extraction behavior and is not transmitted or retained.
- Personally identifiable information: no.
- Health information: no.
- Financial and payment information: no.
- Authentication information: no.
- Personal communications: no.
- Location: no.
- User activity analytics: no.

Certify every Chrome Web Store Limited Use statement. The hosted policy and
these dashboard disclosures must remain identical in substance.

## Distribution

- Initial visibility: Private, trusted testers.
- Initial regions: United States.
- Public rollout: only after the trusted-tester and accessibility gates in the
  release runbook are complete.

## Assets

- Store icon: `store-assets/listing/icon-128.png`
- Screenshot: `store-assets/listing/screenshot-normalized-1280x800.png`
- Screenshot: `store-assets/listing/screenshot-sorted-1280x800.png`
- Small promotional image: `store-assets/listing/promo-small-440x280.png`
