export function dismissVisibleObstruction(): boolean {
  const normalize = (value: string): string =>
    value
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/g, "");
  const allowedLabels = new Set([
    "close",
    "dismiss",
    "no thanks",
    "no, thanks",
    "no thank you",
    "no, thank you",
    "not now",
    "maybe later",
    "continue without",
    "reject all",
    "decline",
    "got it",
    "accept",
    "accept all",
    "agree",
    "i agree",
    "allow all",
    "ok",
    "okay",
    "×"
  ]);
  const optOutLabels = new Set([
    "no thanks",
    "no, thanks",
    "no thank you",
    "no, thank you",
    "not now",
    "maybe later",
    "continue without",
    "reject all",
    "decline"
  ]);
  const isVisible = (element: HTMLElement): boolean => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number.parseFloat(style.opacity || "1") > 0 &&
      box.width > 0 &&
      box.height > 0
    );
  };
  const obstructionScore = (element: HTMLElement): number => {
    if (window !== window.top) {
      return 1;
    }
    let score = 0;
    let current: HTMLElement | null = element;
    while (current) {
      if (
        current.matches(
          "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']"
        )
      ) {
        score = Math.max(score, 3);
      }
      const style = getComputedStyle(current);
      const box = current.getBoundingClientRect();
      if (style.position === "fixed" && box.width > 0 && box.height > 0) {
        score = Math.max(score, 1);
      }
      const isWideFixedBanner =
        style.position === "fixed" &&
        box.width >= window.innerWidth * 0.7 &&
        box.height >= 48 &&
        box.height <= window.innerHeight * 0.5;
      if (
        isWideFixedBanner ||
        ((style.position === "fixed" || style.position === "sticky") &&
          box.width * box.height >= window.innerWidth * window.innerHeight * 0.1)
      ) {
        score = Math.max(score, 2);
      }
      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        current = parent;
      } else {
        const root = current.getRootNode();
        current =
          root instanceof ShadowRoot && root.host instanceof HTMLElement
            ? root.host
            : null;
      }
    }
    return score;
  };
  const candidateSelector =
    "button, a, [role='button'], [tabindex], input[type='button'], input[type='submit'], [id*='dismiss' i], [id*='close' i], [class*='dismiss' i], [class*='close' i]";
  const roots: Array<Document | ShadowRoot> = [document];
  const candidates: HTMLElement[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!;
    candidates.push(...root.querySelectorAll<HTMLElement>(candidateSelector));
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }

  let bestCandidate: HTMLElement | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!isVisible(candidate)) continue;
    const containerScore = obstructionScore(candidate);
    if (containerScore === 0) continue;
    const ariaLabel = normalize(candidate.getAttribute("aria-label") ?? "");
    const title = normalize(candidate.getAttribute("title") ?? "");
    const className = normalize(candidate.getAttribute("class") ?? "");
    const id = normalize(candidate.id);
    const text = normalize(
      candidate instanceof HTMLInputElement ? candidate.value : candidate.innerText || candidate.textContent || ""
    );
    const explicitlyNamedClose =
      /(?:^|[-_\s])(close|dismiss)(?:[-_\s]|$)/.test(className) ||
      /(?:^|[-_\s])(close|dismiss)(?:[-_\s]|$)/.test(id);
    const accessibleCloseAction = [ariaLabel, title].some((label) =>
      /^(?:close|dismiss)\s+(?:the\s+)?(?:banner|chat|dialog|message|modal|notification|popup|window)\b/.test(
        label
      )
    );
    const explicitlyClosable =
      allowedLabels.has(ariaLabel) ||
      allowedLabels.has(title) ||
      allowedLabels.has(text) ||
      ariaLabel === "close dialog" ||
      ariaLabel === "close modal" ||
      accessibleCloseAction ||
      explicitlyNamedClose;
    if (!explicitlyClosable) continue;

    const labels = [ariaLabel, title, text];
    const actionScore = labels.some((label) => optOutLabels.has(label))
      ? 30
      : explicitlyNamedClose ||
          labels.some((label) => label === "close" || label === "×")
        ? 20
        : 10;
    const score = actionScore + containerScore;
    if (score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (bestCandidate) {
    bestCandidate.click();
    return true;
  }

  const nonContentEmbedTitle =
    /^(?:(?:button to )?(?:launch|open) (?:a )?(?:chat|messaging)(?: window)?|(?:google )?recaptcha)$/;
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>("iframe[title]")) {
    const title = normalize(iframe.title);
    if (!nonContentEmbedTitle.test(title) || !isVisible(iframe)) continue;

    let fixedContainer: HTMLElement | null = iframe;
    while (fixedContainer && getComputedStyle(fixedContainer).position !== "fixed") {
      fixedContainer = fixedContainer.parentElement;
    }
    if (!fixedContainer || !isVisible(fixedContainer)) continue;

    const box = fixedContainer.getBoundingClientRect();
    const coverage = (box.width * box.height) / Math.max(1, window.innerWidth * window.innerHeight);
    if (coverage > 0.15) continue;

    fixedContainer.dataset.ataSuppressedNonContentEmbed = "true";
    fixedContainer.style.setProperty("display", "none", "important");
    return true;
  }

  return false;
}

export function measureVisibleObstructionCoverage(): number {
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
  let maximumCoverage = 0;
  const isTransparent = (color: string): boolean =>
    !color ||
    color === "transparent" ||
    /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
  const hasVisiblePaint = (root: HTMLElement): boolean => {
    if ((root.innerText || root.textContent || "").trim()) return true;

    for (const candidate of [
      root,
      ...root.querySelectorAll<HTMLElement>("*")
    ]) {
      const style = getComputedStyle(candidate);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number.parseFloat(style.opacity || "1") <= 0
      ) {
        continue;
      }
      if (
        ["IMG", "PICTURE", "SVG", "CANVAS", "VIDEO"].includes(
          candidate.tagName
        )
      ) {
        return true;
      }
      if (
        !isTransparent(style.backgroundColor) ||
        (style.backgroundImage && style.backgroundImage !== "none") ||
        (style.boxShadow && style.boxShadow !== "none") ||
        [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth
        ].some((width) => Number.parseFloat(width) > 0)
      ) {
        return true;
      }
    }
    return false;
  };
  const roots: Array<Document | ShadowRoot> = [document];
  const elements: HTMLElement[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index]!;
    elements.push(...root.querySelectorAll<HTMLElement>("*"));
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  for (const element of elements) {
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number.parseFloat(style.opacity || "1") <= 0
    ) {
      continue;
    }
    const modal = element.matches(
      "dialog[open], [role='dialog'], [role='alertdialog'], [aria-modal='true']"
    );
    if (!modal && style.position !== "fixed") continue;
    if (
      !modal &&
      style.pointerEvents === "none" &&
      !hasVisiblePaint(element)
    ) {
      continue;
    }
    const box = element.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(window.innerWidth, box.right) - Math.max(0, box.left)
    );
    const height = Math.max(
      0,
      Math.min(window.innerHeight, box.bottom) - Math.max(0, box.top)
    );
    maximumCoverage = Math.max(maximumCoverage, (width * height) / viewportArea);
  }
  return maximumCoverage;
}
