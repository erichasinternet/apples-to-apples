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

  it("prefers declining a standards alertdialog over accepting it", () => {
    document.body.innerHTML = `
      <section role="alertdialog" aria-modal="false">
        <button id="accept">Accept</button>
        <button id="decline">Decline</button>
      </section>
    `;
    mockVisibleBounds();
    const accepted = vi.fn();
    const declined = vi.fn();
    document.querySelector<HTMLButtonElement>("#accept")!.addEventListener("click", accepted);
    document.querySelector<HTMLButtonElement>("#decline")!.addEventListener("click", declined);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(declined).toHaveBeenCalledOnce();
    expect(accepted).not.toHaveBeenCalled();
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

  it("dismisses a textless close control inside a fixed open shadow root", () => {
    document.body.innerHTML = `<div id="widget" style="position: fixed"></div>`;
    const host = document.querySelector<HTMLElement>("#widget")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div id="close" class="widget-close-button"></div>`;
    mockVisibleBounds();
    const clicked = vi.fn();
    shadow
      .querySelector<HTMLElement>("#close")!
      .addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("dismisses a standard accessible close-message action inside an obstruction", () => {
    document.body.innerHTML = `
      <div role="dialog">
        <button id="close-message" aria-label="Close message from company"></button>
      </div>
    `;
    mockVisibleBounds();
    const clicked = vi.fn();
    document
      .querySelector<HTMLButtonElement>("#close-message")!
      .addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("suppresses a small fixed messaging launcher iframe", () => {
    document.body.innerHTML = `
      <iframe
        id="launcher"
        title="Button to launch messaging window"
        style="position: fixed"
      ></iframe>
    `;
    const launcher = document.querySelector<HTMLIFrameElement>("#launcher")!;
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 16,
      y: 764,
      width: 64,
      height: 64,
      top: 764,
      right: 80,
      bottom: 828,
      left: 16,
      toJSON: () => ({})
    });

    expect(dismissVisibleObstruction()).toBe(true);
    expect(launcher.dataset.ataSuppressedNonContentEmbed).toBe("true");
    expect(launcher.style.getPropertyValue("display")).toBe("none");
    expect(launcher.style.getPropertyPriority("display")).toBe("important");
  });

  it("suppresses the small fixed container of a reCAPTCHA badge", () => {
    document.body.innerHTML = `
      <div id="badge" style="position: fixed">
        <iframe id="recaptcha" title="reCAPTCHA"></iframe>
      </div>
    `;
    const badge = document.querySelector<HTMLElement>("#badge")!;
    const recaptcha = document.querySelector<HTMLIFrameElement>("#recaptcha")!;
    const badgeBounds = {
      x: 320,
      y: 770,
      width: 256,
      height: 60,
      top: 770,
      right: 576,
      bottom: 830,
      left: 320,
      toJSON: () => ({})
    };
    vi.spyOn(badge, "getBoundingClientRect").mockReturnValue(badgeBounds);
    vi.spyOn(recaptcha, "getBoundingClientRect").mockReturnValue(badgeBounds);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(badge.dataset.ataSuppressedNonContentEmbed).toBe("true");
    expect(badge.style.getPropertyValue("display")).toBe("none");
  });

  it("does not suppress a large reCAPTCHA challenge", () => {
    document.body.innerHTML = `
      <div id="challenge" style="position: fixed">
        <iframe title="reCAPTCHA"></iframe>
      </div>
    `;
    mockVisibleBounds();

    expect(dismissVisibleObstruction()).toBe(false);
    expect(
      document.querySelector<HTMLElement>("#challenge")!.dataset
        .ataSuppressedNonContentEmbed
    ).toBeUndefined();
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

  it("measures an alertdialog even when aria-modal is false", () => {
    document.body.innerHTML = `
      <section id="alert" role="alertdialog" aria-modal="false"></section>
    `;
    vi.spyOn(
      document.querySelector<HTMLElement>("#alert")!,
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
