import {
  dismissVisibleObstruction,
  measureVisibleObstructionCoverage
} from "../../src/learning/page-preparation";

describe("page preparation", () => {
  it("dismisses an explicit opt-out control inside a visible fixed obstruction", () => {
    document.body.innerHTML = `
      <div role="dialog" style="position: fixed">
        <button id="decline">No, thank you.</button>
      </div>
    `;
    mockVisibleBounds();
    const button = document.querySelector<HTMLButtonElement>("#decline")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("does not click similar controls in ordinary page content", () => {
    document.body.innerHTML = `
      <main>
        <section>
          <button id="ordinary">No thanks</button>
        </section>
      </main>
    `;
    mockVisibleBounds();
    const button = document.querySelector<HTMLButtonElement>("#ordinary")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("dismisses an explicit close control inside a shallow fixed cookie banner", () => {
    document.body.innerHTML = `
      <aside id="cookie-banner" style="position: fixed">
        <p>Cookie policy</p>
        <button id="close-banner">Close</button>
      </aside>
    `;
    vi.spyOn(document.querySelector<HTMLElement>("#cookie-banner")!, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 900,
        width: 1440,
        height: 80,
        top: 900,
        right: 1440,
        bottom: 980,
        left: 0,
        toJSON: () => ({})
      });
    vi.spyOn(document.querySelector<HTMLButtonElement>("#close-banner")!, "getBoundingClientRect")
      .mockReturnValue({
        x: 1320,
        y: 920,
        width: 100,
        height: 40,
        top: 920,
        right: 1420,
        bottom: 960,
        left: 1320,
        toJSON: () => ({})
      });
    const button = document.querySelector<HTMLButtonElement>("#close-banner")!;
    const clicked = vi.fn();
    button.addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("accepts a cookie dialog only when the control is inside an obstruction", () => {
    document.body.innerHTML = `
      <div role="dialog" style="position: fixed">
        <button id="accept">Got it</button>
      </div>
    `;
    mockVisibleBounds();
    const clicked = vi.fn();
    document
      .querySelector<HTMLButtonElement>("#accept")!
      .addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("dismisses a consent link styled as the dialog confirmation control", () => {
    document.body.innerHTML = `
      <section role="dialog" style="position: fixed">
        <a id="confirm" href="#">OK</a>
      </section>
    `;
    mockVisibleBounds();
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document
      .querySelector<HTMLAnchorElement>("#confirm")!
      .addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("measures unresolved modal viewport coverage", () => {
    document.body.innerHTML = `<div id="modal" role="dialog"></div>`;
    vi.spyOn(
      document.querySelector<HTMLElement>("#modal")!,
      "getBoundingClientRect"
    ).mockReturnValue({
      x: 0,
      y: 0,
      width: 512,
      height: 384,
      top: 0,
      right: 512,
      bottom: 384,
      left: 0,
      toJSON: () => ({})
    });

    expect(measureVisibleObstructionCoverage()).toBeCloseTo(0.25);
  });
});

function mockVisibleBounds(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 600,
    height: 400,
    top: 0,
    right: 600,
    bottom: 400,
    left: 0,
    toJSON: () => ({})
  });
}
