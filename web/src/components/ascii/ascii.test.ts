import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AsciiBackground, {
  GLYPHS,
  centerVeil,
  drawFrame,
  mulberry32,
  sharkLuminance,
  type DrawOptions,
} from "./AsciiBackground";
import { bodyHalfThickness, waveY } from "./marine";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Recorded { ch: string; x: number; y: number; style: string; alpha: number }

function recorder() {
  const calls: Recorded[] = [];
  const ctx = {
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    font: "",
    fillStyle: "#000",
    textBaseline: "",
    textAlign: "",
    globalAlpha: 1,
    fillText(ch: string, x: number, y: number) {
      calls.push({ ch, x, y, style: String(this.fillStyle), alpha: this.globalAlpha });
    },
  };
  return { ctx, calls };
}

const asCtx = (c: unknown) => c as unknown as CanvasRenderingContext2D;
const frame = (over: Partial<DrawOptions> = {}): DrawOptions => ({
  cols: 120, rows: 60, cell: 8, t: 3.2, seed: 1337, ...over,
});

describe("primitives deterministes", () => {
  it("mulberry32 est reproductible et borne", () => {
    const a = mulberry32(42), b = mulberry32(42);
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect([mulberry32(43)(), mulberry32(43)(), mulberry32(43)()]).not.toEqual(seqA);
  });

  it("sharkLuminance reste bornee et depend du temps", () => {
    const rnd = mulberry32(2024);
    for (let i = 0; i < 200; i++) {
      const l = sharkLuminance(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 40);
      expect(Number.isFinite(l)).toBe(true);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
    expect(sharkLuminance(0.2, 0, 0)).not.toBeCloseTo(sharkLuminance(0.2, 0, 4), 3);
  });

  it("centerVeil eclaircit le centre et laisse les bords", () => {
    expect(centerVeil(0, 0)).toBeCloseTo(0.72, 2);
    expect(centerVeil(0, 0)).toBeLessThan(centerVeil(0.5, 0));
    expect(centerVeil(1, 1)).toBeGreaterThan(0.9);
  });
});

describe("geometrie marine", () => {
  it("le corps est fuselle", () => {
    expect(bodyHalfThickness(0)).toBeGreaterThan(bodyHalfThickness(0.55));
    expect(bodyHalfThickness(0.55)).toBeGreaterThan(bodyHalfThickness(0.9));
    expect(bodyHalfThickness(2)).toBe(0);
  });

  it("les vagues sont bornees et dephasees", () => {
    for (let band = 0; band < 4; band++) {
      for (let x = 0; x <= 1; x += 0.1) {
        const y = waveY(x, 3.2, band);
        expect(y).toBeGreaterThan(0.5);
        expect(y).toBeLessThan(1);
      }
    }
    expect(waveY(0.3, 0, 0)).not.toBeCloseTo(waveY(0.3, 0, 1), 3);
  });
});

describe("drawFrame", () => {
  it("dessine une scene dense sans jeter", () => {
    const { ctx, calls } = recorder();
    expect(() => drawFrame(asCtx(ctx), frame())).not.toThrow();
    expect(calls.length).toBeGreaterThan(400);
    expect(ctx.font).toContain("px");
    expect(ctx.textBaseline).toBe("top");
  });

  it("est deterministe", () => {
    const a = recorder(), b = recorder();
    drawFrame(asCtx(a.ctx), frame({ t: 6.4, seed: 99 }));
    drawFrame(asCtx(b.ctx), frame({ t: 6.4, seed: 99 }));
    expect(b.calls.map((c) => c.ch + "@" + c.x + "," + c.y)).toEqual(
      a.calls.map((c) => c.ch + "@" + c.x + "," + c.y),
    );
  });

  it("peint le degradé d'eau par defaut, une seule bande si un fond est fourni", () => {
    const defaut = recorder();
    drawFrame(asCtx(defaut.ctx), frame({ cols: 40, rows: 20 }));
    // Le dégradé d'eau est peint par le CSS : le canvas reste transparent.
    expect(defaut.ctx.clearRect).toHaveBeenCalled();
    expect(defaut.ctx.fillRect).not.toHaveBeenCalled();

    const impose = recorder();
    drawFrame(asCtx(impose.ctx), frame({ cols: 40, rows: 20, bg: "#101010" }));
    expect(impose.ctx.fillRect.mock.calls.length).toBe(1);
  });

  it("place le requin au-dessus du milieu de l'ecran", () => {
    const { ctx, calls } = recorder();
    const rows = 40;
    drawFrame(asCtx(ctx), frame({ cols: 80, rows, cell: 8, t: 0 }));
    const body = calls.filter((c) => c.ch === "\u2593" || c.ch === "\u2592");
    expect(body.length).toBeGreaterThan(50);
    const haut = body.filter((c) => c.y < (rows * 8) / 2).length;
    // Le requin est décentré à droite et légèrement sous la médiane (fond sobre) :
    // l'essentiel du corps reste dans la moitié haute de l'écran.
    expect(haut / body.length).toBeGreaterThan(0.6);
  });

  it("garde l'eau discrete (alpha <= 0,6)", () => {
    const { ctx, calls } = recorder();
    drawFrame(asCtx(ctx), frame({ cols: 100, rows: 50, t: 7 }));
    const eau = calls.filter((c) => c.ch === "~" || c.ch === "-" || c.ch === "=" || c.ch === "≈");
    expect(eau.length).toBeGreaterThan(20);
    expect(eau.every((c) => c.alpha <= 0.6)).toBe(true);
  });

  it("le requin occupe au moins un tiers de la largeur", () => {
    const { ctx, calls } = recorder();
    const cols = 100;
    drawFrame(asCtx(ctx), frame({ cols, rows: 44, cell: 8, t: 2 }));
    const xs = calls.filter((c) => c.ch === "\u2593" || c.ch === "\u2592" || c.ch === "%").map((c) => c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(cols * 8 * 0.33);
  });
});

describe("AsciiBackground", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let ctx: ReturnType<typeof recorder>["ctx"];
  let spyCalls: Recorded[];

  const stubMatchMedia = (matches: boolean) => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  };

  const mount = () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const r = createRoot(container);
    root = r;
    act(() => { r.render(createElement(AsciiBackground, { seed: 1337 })); });
  };

  beforeEach(() => {
    const rec = recorder();
    ctx = rec.ctx;
    spyCalls = rec.calls;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(asCtx(ctx));
  });

  afterEach(() => {
    if (root) { act(() => root!.unmount()); root = null; }
    if (container?.parentNode) container.parentNode.removeChild(container);
    container = null;
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("prefers-reduced-motion : une frame statique, aucun rAF", () => {
    stubMatchMedia(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    mount();
    expect(raf).toHaveBeenCalledTimes(0);
    expect(spyCalls.length).toBeGreaterThan(0);
  });

  it("mouvement autorise : la boucle demarre", () => {
    stubMatchMedia(false);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    mount();
    expect(raf.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("plafonne le devicePixelRatio a 2", () => {
    stubMatchMedia(true);
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, writable: true, value: 3 });
    mount();
    const calls = ctx.setTransform.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBeLessThanOrEqual(2);
  });
});

it("la rampe de glyphes reste exploitable", () => {
  expect(GLYPHS.length).toBeGreaterThan(5);
});
