import type {
  ObservationAttributes,
  ObservedNode,
  PageObservation
} from "./contracts";

export interface ObservationCaptureOptions {
  pageId: string;
  maxNodes?: number;
}

export function capturePageObservation(options: ObservationCaptureOptions): PageObservation {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const redact = (value: string): string =>
    value
      .replace(
        /\b(at|near|store)\s+\d{2,6}\s+[A-Z][A-Za-z0-9 .'-]{2,50}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
        "$1 [REDACTED LOCATION]"
      )
      .replace(
        /\b(only\s+\d+\s+left\s+at|pickup\s+(?:available\s+)?at|out of stock at|in stock at|available at)\s+[A-Z][A-Za-z .'-]{2,60}(?=(?:\.{3}|Pickup|Same-Day|Delivery|Shipping|$))/gi,
        "$1 [REDACTED LOCATION]"
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
      .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[REDACTED PHONE]")
      .replace(
        /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z0-9][A-Za-z0-9.' -]{1,60}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl)\b/gi,
        "[REDACTED ADDRESS]"
      )
      .replace(/\b(?:hi|hello|welcome back),?\s+[A-Z][a-z]{1,30}\b/gi, "[REDACTED ACCOUNT]")
      .replace(
        /\b(?:bearer\s+[A-Za-z0-9._~+/=-]{16,}|(?:api[-_]?key|access[-_]?token|session[-_]?id)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,})\b/gi,
        "[REDACTED CREDENTIAL]"
      );
  const canonicalUrl = (value: string): string => {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  };
  const nearestIncludedParentId = (
    start: Element | null,
    rootElement: HTMLElement,
    includedIds: ReadonlySet<string>
  ): string | undefined => {
    let current = start;
    while (current && rootElement.contains(current)) {
      const nodeId = current.getAttribute("data-ata-benchmark-node") ?? undefined;
      if (nodeId && includedIds.has(nodeId)) {
        return nodeId;
      }
      current = current.parentElement;
    }
    return undefined;
  };
  const collectAttributes = (element: HTMLElement): ObservationAttributes => {
    const attributes: ObservationAttributes = {};
    const ariaLabel = element.getAttribute("aria-label");
    const alt = element.getAttribute("alt");
    const title = element.getAttribute("title");
    const placeholder = element.getAttribute("placeholder");
    const itemProp = element.getAttribute("itemprop");
    const itemType = element.getAttribute("itemtype");
    const href = element.getAttribute("href");

    if (ariaLabel) attributes.ariaLabel = redact(ariaLabel);
    if (alt) attributes.alt = redact(alt);
    if (title) attributes.title = redact(title);
    if (placeholder) attributes.placeholder = redact(placeholder);
    if (itemProp) attributes.itemProp = redact(itemProp);
    if (itemType) attributes.itemType = redact(itemType);
    if (href) {
      try {
        attributes.href = redact(
          canonicalUrl(new URL(href, location.href).href)
        );
      } catch {
        // Invalid links are omitted from the observation.
      }
    }

    return attributes;
  };
  const root =
    [...document.querySelectorAll("main, [role='main'], #main, #content")].find(
      (candidate): candidate is HTMLElement => {
        if (!(candidate instanceof HTMLElement)) return false;
        const style = getComputedStyle(candidate);
        const box = candidate.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.display !== "contents" &&
          style.visibility !== "hidden" &&
          box.width >= 80 &&
          box.height >= 30
        );
      }
    ) ?? document.body;
  const maxNodes = Math.max(1, options.maxNodes ?? 20_000);
  const allElements = [root, ...root.querySelectorAll("*")].filter(
    (element): element is HTMLElement => element instanceof HTMLElement
  );

  for (const [index, element] of allElements.entries()) {
    if (!element.hasAttribute("data-ata-benchmark-node")) {
      element.setAttribute("data-ata-benchmark-node", `n${index}`);
    }
  }

  const renderedSet = new Set<HTMLElement>();
  for (const element of allElements) {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const hasRenderedBox =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0 &&
      box.width > 0 &&
      box.height > 0;
    if (!hasRenderedBox) continue;

    let current: Element | null = element;
    while (current && root.contains(current)) {
      const currentStyle = getComputedStyle(current);
      if (currentStyle.display === "none" || currentStyle.visibility === "hidden") break;
      if (current instanceof HTMLElement) {
        renderedSet.add(current);
      }
      if (current === root) break;
      current = current.parentElement;
    }
  }
  const rendered = allElements.filter((element) => renderedSet.has(element));
  const included = rendered.slice(0, maxNodes);
  const includedIds = new Set(
    included.map((element) => element.getAttribute("data-ata-benchmark-node") ?? "")
  );
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const nodes: ObservedNode[] = included.map((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const text = redact(
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.nodeValue ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
    const accessibleName = redact(
      element.getAttribute("aria-label") ??
        (element instanceof HTMLImageElement ? element.alt : "") ??
        ""
    ).trim();
    const parentId = nearestIncludedParentId(element.parentElement, root, includedIds);
    const attributes = collectAttributes(element);
    const role = element.getAttribute("role")?.trim();

    return {
      id: element.getAttribute("data-ata-benchmark-node") ?? "",
      ...(parentId ? { parentId } : {}),
      tag: element.tagName.toLowerCase(),
      ...(role ? { role } : {}),
      ...(text ? { text } : {}),
      ...(accessibleName ? { accessibleName } : {}),
      ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
      bounds: {
        x: round(box.x + window.scrollX),
        y: round(box.y + window.scrollY),
        width: round(box.width),
        height: round(box.height)
      },
      intersectsViewport:
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < viewportWidth &&
        box.top < viewportHeight,
      interactive:
        element.matches("a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [tabindex]"),
      style: {
        display: style.display,
        position: style.position,
        fontSize: round(Number.parseFloat(style.fontSize) || 0),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400
      }
    };
  });

  return {
    version: 1,
    pageId: options.pageId,
    url: canonicalUrl(location.href),
    title: redact(document.title),
    viewport: {
      width: viewportWidth,
      height: viewportHeight,
      scrollX: round(window.scrollX),
      scrollY: round(window.scrollY)
    },
    rootNodeId: root.getAttribute("data-ata-benchmark-node") ?? "n0",
    nodes,
    truncated: rendered.length > included.length
  };
}
