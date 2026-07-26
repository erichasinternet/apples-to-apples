import { capturePageObservation } from "../../src/learning/page-observation";

describe("page observation capture", () => {
  it("captures generic rendered evidence without query strings or form values", () => {
    document.body.innerHTML = `
      <main>
        <article class="retailer-product-card">
          <a href="https://shop.example/item/123?tracking=secret">
            <span aria-label="Cat litter 48 lb">Cat litter 48 lb</span>
          </a>
          <a href="https://shop.example/item/800-555-1212">Support SKU</a>
          <span>current price $10.98</span>
          <input value="private value" placeholder="Email shopper@example.com">
        </article>
      </main>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 20,
      width: 300,
      height: 100,
      top: 20,
      right: 310,
      bottom: 120,
      left: 10,
      toJSON: () => ({})
    });

    const observation = capturePageObservation({ pageId: "unknown-shop", maxNodes: 100 });

    expect(observation.version).toBe(1);
    expect(observation.nodes.length).toBeGreaterThanOrEqual(5);
    expect(observation.truncated).toBe(false);
    expect(JSON.stringify(observation)).not.toContain("retailer-product-card");
    expect(JSON.stringify(observation)).not.toContain("tracking=secret");
    expect(JSON.stringify(observation)).not.toContain("private value");
    expect(JSON.stringify(observation)).not.toContain("shopper@example.com");
    expect(JSON.stringify(observation)).not.toContain("800-555-1212");
    expect(JSON.stringify(observation)).toContain("[REDACTED EMAIL]");
    expect(JSON.stringify(observation)).toContain("[REDACTED PHONE]");
    expect(observation.nodes.find((node) => node.tag === "a")?.attributes?.href).toBe(
      "https://shop.example/item/123"
    );
  });

  it("marks a capture as truncated when the generic node budget is exceeded", () => {
    document.body.innerHTML = "<main><section><span>one</span><span>two</span></section></main>";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({})
    });

    const observation = capturePageObservation({ pageId: "bounded", maxNodes: 2 });

    expect(observation.nodes).toHaveLength(2);
    expect(observation.truncated).toBe(true);
  });

  it("ignores non-HTML elements that do not implement HTMLElement APIs", () => {
    document.body.innerHTML = `
      <main>
        <svg><path d="M0 0"></path></svg>
        <article><span>$10.00 for 20 oz</span></article>
      </main>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({})
    });

    const observation = capturePageObservation({ pageId: "svg-safe" });

    expect(observation.nodes.some((node) => node.tag === "article")).toBe(true);
    expect(observation.nodes.some((node) => node.tag === "svg")).toBe(false);
  });

  it("falls back to the document body when a non-HTML element claims the main role", () => {
    document.body.innerHTML = `
      <svg role="main"><path d="M0 0"></path></svg>
      <section><span>$12.00 for 24 count</span></section>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({})
    });

    const observation = capturePageObservation({ pageId: "non-html-main" });

    expect(observation.nodes.some((node) => node.tag === "section")).toBe(true);
    expect(observation.rootNodeId).toBe("n0");
  });

  it("falls back to the rendered body when main uses display contents", () => {
    document.body.innerHTML = `
      <main style="display: contents">
        <article><span>$12.00 for 24 count</span></article>
      </main>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const isContentsMain = this.tagName === "MAIN";
        return {
          x: 0,
          y: 0,
          width: isContentsMain ? 0 : 600,
          height: isContentsMain ? 0 : 800,
          top: 0,
          right: isContentsMain ? 0 : 600,
          bottom: isContentsMain ? 0 : 800,
          left: 0,
          toJSON: () => ({})
        };
      }
    );

    const observation = capturePageObservation({ pageId: "display-contents-main" });
    const root = observation.nodes.find(
      (node) => node.id === observation.rootNodeId
    );

    expect(root?.tag).toBe("body");
    expect(root?.bounds).toMatchObject({ width: 600, height: 800 });
    expect(observation.nodes.some((node) => node.tag === "article")).toBe(true);
  });

  it("does not trust page-mutated Array iterator methods", () => {
    document.body.innerHTML = `
      <main>
        <article><span>$12.00 for 24 count</span></article>
      </main>
    `;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      toJSON: () => ({})
    });
    const originalEntries = Array.prototype.entries;
    Array.prototype.entries = function <T>(this: T[]): ArrayIterator<[number, T]> {
      if (this[0] instanceof HTMLElement) {
        throw new Error("page replaced element-array entries");
      }
      return originalEntries.call(this);
    };

    try {
      const observation = capturePageObservation({ pageId: "mutated-array-prototype" });

      expect(observation.nodes.some((node) => node.tag === "article")).toBe(true);
    } finally {
      Array.prototype.entries = originalEntries;
    }
  });
});
