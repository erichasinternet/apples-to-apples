import { capturePageObservation } from "../../src/learning/page-observation";

describe("page observation capture", () => {
  it("captures generic rendered evidence without query strings or form values", () => {
    document.body.innerHTML = `
      <main>
        <article class="retailer-product-card">
          <a href="https://shop.example/item/123?tracking=secret">
            <span aria-label="Cat litter 48 lb">Cat litter 48 lb</span>
          </a>
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
    expect(JSON.stringify(observation)).toContain("[REDACTED EMAIL]");
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
});
