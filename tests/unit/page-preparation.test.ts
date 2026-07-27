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

  it.each([
    "Do not sell or share",
    "No, I'll pay full price"
  ])("recognizes a generic refusal action: %s", (label) => {
    document.body.innerHTML = `
      <section role="dialog" style="position: fixed">
        <button id="accept">Accept</button>
        <button id="refuse">${label}</button>
      </section>
    `;
    mockVisibleBounds();
    const accepted = vi.fn();
    const refused = vi.fn();
    document
      .querySelector<HTMLButtonElement>("#accept")!
      .addEventListener("click", accepted);
    document
      .querySelector<HTMLButtonElement>("#refuse")!
      .addEventListener("click", refused);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(refused).toHaveBeenCalledOnce();
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

  it("does not toggle a close-labelled control in a small fixed toolbar", () => {
    document.body.innerHTML = `
      <header id="toolbar" style="position: fixed">
        <label id="cart-close" aria-label="cart close"></label>
      </header>
    `;
    const toolbar = document.querySelector<HTMLElement>("#toolbar")!;
    const toggle = document.querySelector<HTMLElement>("#cart-close")!;
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
      x: 920,
      y: 0,
      width: 104,
      height: 64,
      top: 0,
      right: 1024,
      bottom: 64,
      left: 920,
      toJSON: () => ({})
    });
    vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue({
      x: 968,
      y: 16,
      width: 32,
      height: 32,
      top: 16,
      right: 1000,
      bottom: 48,
      left: 968,
      toJSON: () => ({})
    });
    const clicked = vi.fn();
    toggle.addEventListener("click", clicked);

    expect(dismissVisibleObstruction()).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it("does not click a close control in an offscreen fixed drawer", () => {
    document.body.innerHTML = `
      <aside id="drawer" style="position: fixed">
        <label id="drawer-close" aria-label="cart close"></label>
      </aside>
    `;
    const drawer = document.querySelector<HTMLElement>("#drawer")!;
    const close = document.querySelector<HTMLElement>("#drawer-close")!;
    vi.spyOn(drawer, "getBoundingClientRect").mockReturnValue({
      x: 1524,
      y: 0,
      width: 500,
      height: 768,
      top: 0,
      right: 2024,
      bottom: 768,
      left: 1524,
      toJSON: () => ({})
    });
    vi.spyOn(close, "getBoundingClientRect").mockReturnValue({
      x: 1980,
      y: 24,
      width: 20,
      height: 20,
      top: 24,
      right: 2000,
      bottom: 44,
      left: 1980,
      toJSON: () => ({})
    });
    const clicked = vi.fn();
    close.addEventListener("click", clicked);

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
        y: 680,
        width: 1024,
        height: 80,
        top: 680,
        right: 1024,
        bottom: 760,
        left: 0,
        toJSON: () => ({})
      });
    vi.spyOn(document.querySelector<HTMLButtonElement>("#close-banner")!, "getBoundingClientRect")
      .mockReturnValue({
        x: 900,
        y: 700,
        width: 100,
        height: 40,
        top: 700,
        right: 1000,
        bottom: 740,
        left: 900,
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

  it("prefers a persistent cookie choice over a generic close control", () => {
    document.body.innerHTML = `
      <div role="dialog" style="position: fixed">
        <button id="close">Close</button>
        <button id="accept">Accept All Cookies</button>
      </div>
    `;
    mockVisibleBounds();
    const closed = vi.fn();
    const accepted = vi.fn();
    document
      .querySelector<HTMLButtonElement>("#close")!
      .addEventListener("click", closed);
    document
      .querySelector<HTMLButtonElement>("#accept")!
      .addEventListener("click", accepted);

    expect(dismissVisibleObstruction()).toBe(true);
    expect(accepted).toHaveBeenCalledOnce();
    expect(closed).not.toHaveBeenCalled();
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

  it("suppresses a small fixed chat launcher from generic accessibility metadata", () => {
    document.body.innerHTML = `
      <div
        id="launcher"
        role="button"
        aria-label="Chat widget toggle"
        style="position: fixed"
      ></div>
    `;
    const launcher = document.querySelector<HTMLElement>("#launcher")!;
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 944,
      y: 688,
      width: 56,
      height: 56,
      top: 688,
      right: 1000,
      bottom: 744,
      left: 944,
      toJSON: () => ({})
    });

    expect(dismissVisibleObstruction()).toBe(true);
    expect(launcher.dataset.ataSuppressedNonContentLauncher).toBe("true");
    expect(launcher.style.getPropertyValue("display")).toBe("none");
    expect(launcher.style.getPropertyPriority("display")).toBe("important");
  });

  it("suppresses a small fixed chat launcher from generic class and text", () => {
    document.body.innerHTML = `
      <div id="launcher" class="b-chat" style="position: fixed">
        Chat Feedback
      </div>
    `;
    const launcher = document.querySelector<HTMLElement>("#launcher")!;
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 944,
      y: 688,
      width: 60,
      height: 60,
      top: 688,
      right: 1004,
      bottom: 748,
      left: 944,
      toJSON: () => ({})
    });

    expect(dismissVisibleObstruction()).toBe(true);
    expect(launcher.dataset.ataSuppressedNonContentLauncher).toBe("true");
    expect(launcher.style.getPropertyValue("display")).toBe("none");
  });

  it("does not suppress a large fixed chat surface without an explicit close action", () => {
    document.body.innerHTML = `
      <section id="chat-window" style="position: fixed">Chat with support</section>
    `;
    const chatWindow = document.querySelector<HTMLElement>("#chat-window")!;
    vi.spyOn(chatWindow, "getBoundingClientRect").mockReturnValue({
      x: 624,
      y: 268,
      width: 360,
      height: 460,
      top: 268,
      right: 984,
      bottom: 728,
      left: 624,
      toJSON: () => ({})
    });

    expect(dismissVisibleObstruction()).toBe(false);
    expect(
      chatWindow.dataset.ataSuppressedNonContentLauncher
    ).toBeUndefined();
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

  it("suppresses a standard accessible chat widget within the obstruction gate", () => {
    document.body.innerHTML = `
      <iframe
        id="launcher"
        title="Opens a widget where you can chat to one of our agents"
        style="position: fixed"
      ></iframe>
    `;
    const launcher = document.querySelector<HTMLIFrameElement>("#launcher")!;
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 123,
      y: 622,
      width: 260,
      height: 215,
      top: 622,
      right: 383,
      bottom: 837,
      left: 123,
      toJSON: () => ({})
    });

    expect(dismissVisibleObstruction()).toBe(true);
    expect(launcher.dataset.ataSuppressedNonContentEmbed).toBe("true");
    expect(launcher.style.getPropertyValue("display")).toBe("none");
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
      y: 700,
      width: 256,
      height: 60,
      top: 700,
      right: 576,
      bottom: 760,
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

  it("ignores an inert transparent fixed notification container", () => {
    document.body.innerHTML = `
      <div id="notifications" style="position: fixed; pointer-events: none">
        <div></div>
      </div>
    `;
    mockVisibleBounds();

    expect(measureVisibleObstructionCoverage()).toBe(0);
  });

  it("does not assign a transparent pointerless shell the paint of a small child", () => {
    document.body.innerHTML = `
      <div id="shell" style="position: fixed; pointer-events: none">
        <button id="chat" style="background: red">Chat</button>
      </div>
    `;
    mockVisibleBounds();

    expect(measureVisibleObstructionCoverage()).toBe(0);
  });

  it("still measures a painted pointerless fixed backdrop", () => {
    document.body.innerHTML = `
      <div
        id="backdrop"
        style="position: fixed; pointer-events: none; background: rgba(0, 0, 0, 0.4)"
      ></div>
    `;
    mockVisibleBounds();

    expect(measureVisibleObstructionCoverage()).toBeCloseTo(
      (600 * 400) / (1024 * 768)
    );
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
