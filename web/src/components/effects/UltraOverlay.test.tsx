import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import UltraOverlay from "./UltraOverlay";

/* ── Doublures d'environnement ────────────────────────────────────────
   jsdom n'a ni matchMedia ni ResizeObserver, et son canvas 2D est absent :
   on fournit les trois, plus une horloge rAF maîtrisée. */

let pending = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let rafCalls = 0;
let cancelledIds: number[] = [];

function installFrameLoop(): void {
  pending = new Map();
  nextFrameId = 1;
  rafCalls = 0;
  cancelledIds = [];

  vi.spyOn(window, "requestAnimationFrame").mockImplementation(
    (callback: FrameRequestCallback) => {
      rafCalls += 1;
      const id = nextFrameId++;
      pending.set(id, callback);
      return id;
    },
  );
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    cancelledIds.push(id);
    pending.delete(id);
  });
}

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
}

interface ResizeObserverStub {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: () => void;
}

function stubResizeObserver(): ResizeObserverStub {
  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnect = vi.fn();
  let recorded: ResizeObserverCallback = () => {};

  class ResizeObserverFake {
    constructor(callback: ResizeObserverCallback) {
      recorded = callback;
    }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverFake);

  return {
    observe,
    disconnect,
    trigger: () => recorded([], {} as ResizeObserver),
  };
}

function stubCanvasContext() {
  const ctx = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    lineCap: "butt",
    lineWidth: 1,
    strokeStyle: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("UltraOverlay", () => {
  let ctx: ReturnType<typeof stubCanvasContext>;
  let observer: ResizeObserverStub;

  beforeEach(() => {
    stubMatchMedia(false);
    observer = stubResizeObserver();
    ctx = stubCanvasContext();
    installFrameLoop();
  });

  afterEach(() => {
    cleanup();
    pending.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ne rend rien quand active=false : aucun nœud, aucun rAF", () => {
    const { container } = render(<UltraOverlay active={false} />);

    expect(container.firstChild).toBeNull();
    expect(container.querySelector(".ultra")).toBeNull();
    expect(document.querySelector(".ultra")).toBeNull();
    expect(rafCalls).toBe(0);
    expect(pending.size).toBe(0);
    expect(observer.observe).not.toHaveBeenCalled();
  });

  it("rend un conteneur plein écran décoratif quand active=true", () => {
    const { container } = render(<UltraOverlay active />);

    const root = container.querySelector(".ultra");
    expect(root).not.toBeNull();
    expect(root).toHaveClass("ultra");
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root?.querySelector("canvas.ultra__canvas")).toBeInstanceOf(
      HTMLCanvasElement,
    );
    expect(root?.querySelector(".ultra__vig")).not.toBeNull();
    expect(root?.querySelector(".ultra__scan")).not.toBeNull();

    // Le canvas a été mesuré (mesure faite sur innerWidth/innerHeight en jsdom).
    const canvas = root?.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(canvas.style.width).not.toBe("");

    // Une seule frame en vol, jamais deux.
    expect(rafCalls).toBe(1);
    expect(pending.size).toBe(1);
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0);
  });

  it("affiche le libellé fourni, en bas au centre", () => {
    const { container } = render(
      <UltraOverlay active label="Ultracode · 3 agents en vol" />,
    );

    const text = container.querySelector(".ultra__text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("Ultracode · 3 agents en vol");
    expect(container.querySelector(".ultra__dot")).not.toBeNull();
  });

  it("retombe sur un libellé par défaut (et ignore un libellé vide)", () => {
    const { container, rerender } = render(<UltraOverlay active />);
    expect(container.querySelector(".ultra__text")?.textContent).toBe(
      "Ultracode · 3 agents",
    );

    rerender(<UltraOverlay active label="   " />);
    expect(container.querySelector(".ultra__text")?.textContent).toBe(
      "Ultracode · 3 agents",
    );
  });

  it("coupe la boucle rAF et l'observateur au démontage", () => {
    const { unmount } = render(<UltraOverlay active />);

    const live = [...pending.keys()];
    expect(live).toHaveLength(1);

    unmount();

    expect(cancelledIds).toEqual(live);
    expect(pending.size).toBe(0);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("retire l'overlay et la boucle quand active repasse à false", () => {
    const { container, rerender } = render(<UltraOverlay active />);
    expect(container.querySelector(".ultra")).not.toBeNull();

    rerender(<UltraOverlay active={false} />);

    expect(container.querySelector(".ultra")).toBeNull();
    expect(pending.size).toBe(0);
    expect(cancelledIds.length).toBeGreaterThanOrEqual(1);
  });

  it("chaque frame replanifie la suivante et avance le champ", () => {
    render(<UltraOverlay active />);

    const first = [...pending.entries()][0];
    expect(first).toBeDefined();
    const [id, frame] = first;
    const strokesBefore = ctx.stroke.mock.calls.length;
    const clearsBefore = ctx.clearRect.mock.calls.length;

    act(() => {
      pending.delete(id); // la frame est consommée
      frame(32);
    });

    expect(pending.size).toBe(1); // une seule frame replanifiée
    expect(ctx.clearRect.mock.calls.length).toBeGreaterThan(clearsBefore);
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(strokesBefore);
    expect(ctx.setTransform).toHaveBeenCalled();
  });

  it("préfère les animations réduites : image statique, aucun rAF", () => {
    stubMatchMedia(true);
    const { container } = render(<UltraOverlay active />);

    const root = container.querySelector(".ultra");
    expect(root).toHaveAttribute("data-reduced", "true");
    // Le champ est peint une fois, sans boucle.
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0);
    expect(rafCalls).toBe(0);
    expect(pending.size).toBe(0);
  });

  it("se réajuste quand l'hôte est redimensionné", () => {
    const { container } = render(<UltraOverlay active />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    const before = canvas.width;

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(900);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(500);

    act(() => {
      observer.trigger();
    });

    expect(observer.observe).toHaveBeenCalledTimes(1);
    expect(canvas.width).not.toBe(before);
    expect(canvas.style.width).toBe("900px");
  });
});
