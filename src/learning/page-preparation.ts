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
    "×"
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
  const isInsideObstruction = (element: HTMLElement): boolean => {
    if (window !== window.top) {
      return true;
    }
    let current: HTMLElement | null = element;
    while (current) {
      if (current.matches("dialog[open], [role='dialog'], [aria-modal='true']")) {
        return true;
      }
      const style = getComputedStyle(current);
      const box = current.getBoundingClientRect();
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
        return true;
      }
      current = current.parentElement;
    }
    return false;
  };
  const candidates = document.querySelectorAll<HTMLElement>(
    "button, [role='button'], input[type='button'], input[type='submit'], [id*='dismiss' i]"
  );

  for (const candidate of candidates) {
    if (!isVisible(candidate) || !isInsideObstruction(candidate)) continue;
    const ariaLabel = normalize(candidate.getAttribute("aria-label") ?? "");
    const title = normalize(candidate.getAttribute("title") ?? "");
    const text = normalize(
      candidate instanceof HTMLInputElement ? candidate.value : candidate.innerText || candidate.textContent || ""
    );
    const explicitlyClosable =
      allowedLabels.has(ariaLabel) ||
      allowedLabels.has(title) ||
      allowedLabels.has(text) ||
      ariaLabel === "close dialog" ||
      ariaLabel === "close modal";
    if (!explicitlyClosable) continue;

    candidate.click();
    return true;
  }

  return false;
}
