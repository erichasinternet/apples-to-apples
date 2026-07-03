# System Design

## Goal

Build a privacy-conscious Manifest V3 Chrome extension that normalizes unit pricing on shopping pages. The extension should work best on hardened supported retailers while still providing best-effort comparisons on arbitrary pages with enough visible evidence.

## Pipeline

```text
Retail page DOM
  -> page/site classifier
  -> product-card detector
  -> evidence extractor
  -> unit and price parser
  -> normalization engine
  -> badge renderer and sort-control integration
```

## Extraction Layers

1. Site adapter selectors for high-traffic retailers.
2. Generic repeated-card detection using product-like DOM, links, images, price text, and add/cart text.
3. Structured data fallback through JSON-LD `Product` and `Offer`.
4. Visible text parsing for prices, native unit prices, package sizes, and multipacks.

## Unit Rules

The engine converts only within the same dimension:

- Weight: `oz`, `lb`, `g`, `kg`
- Volume: `fl oz`, `mL`, `L`, `gal`, `qt`, `pt`, `cup`
- Count: `count`, `roll`, `sheet`, `load`, `pod`, `tablet`, `capsule`, `diaper`, `bag`
- Area: `sq ft`, `sq in`
- Length: `ft`, `in`

Count units are intentionally conservative. A roll is not automatically equivalent to a sheet, even though both are count-like.

## Sorting

The extension adds `Unit price: low to high` to retailer sort controls when the page exposes either a visible normal HTML `<select>` or a visible custom sort trigger with an open listbox/menu. Many large retailers use custom dropdown components, hide legacy controls, or load controls asynchronously; for those, the extension watches the visible sort trigger and inserts one menu option when the retailer menu opens. A delayed inline fallback is used only when no usable retailer sort control appears after the page settles.

The sorter:

- Reorders only product cards already visible in the current DOM.
- Sorts only groups with comparable normalized units.
- Keeps unrelated groups in their existing page slots.
- Stores a DOM snapshot so the user can restore the retailer's original order.

## Privacy

- No backend is required.
- No product browsing data is transmitted.
- Content scripts auto-run only on declared shopping hosts.
- Manual scanning on arbitrary pages uses `activeTab`.
