import { describe, expect, it } from "vitest";

import { drawFrame, type DrawOptions } from "./AsciiBackground";

/** Faux contexte 2D : aucun rendu réel, on ne mesure que notre boucle. */
function makeCtx(): CanvasRenderingContext2D {
  const noop = () => undefined;
  return {
    fillRect: noop,
    clearRect: noop,
    fillText: noop,
    globalAlpha: 1,
    setTransform: noop,
    font: "",
    fillStyle: "",
    textBaseline: "",
    textAlign: "",
  } as unknown as CanvasRenderingContext2D;
}

describe("budget CPU du fond ASCII", () => {
  it("dessine 120 frames (120×60) en moins de 4 ms par frame", () => {
    const ctx = makeCtx();
    const o: DrawOptions = { cols: 120, rows: 60, cell: 8, t: 0, seed: 1337 };

    // Échauffement : JIT + construction des palettes/styles.
    for (let i = 0; i < 5; i++) {
      o.t = i / 30;
      drawFrame(ctx, o);
    }

    // Trois passes : on garde la MÉDIANE, sinon une machine chargée (CI, build
    // parallèle) fait échouer le budget alors que le rendu est conforme.
    const frames = 120;
    const passes: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const start = performance.now();
      for (let i = 0; i < frames; i++) {
        o.t = i / 30;
        drawFrame(ctx, o);
      }
      passes.push((performance.now() - start) / frames);
    }
    passes.sort((a, b) => a - b);
    const avg = passes[1];
    const total = avg * frames;

    // eslint-disable-next-line no-console
    console.log(
      `[perf ascii] ${frames} frames (${o.cols}×${o.rows}) : ${total.toFixed(
        1,
      )} ms au total, ${avg.toFixed(3)} ms/frame`,
    );

    expect(avg).toBeLessThan(4);
  });

  it("tient aussi le budget sur une grille de 128×72", () => {
    const ctx = makeCtx();
    const o: DrawOptions = { cols: 128, rows: 72, cell: 9, t: 0, seed: 1337 };
    for (let i = 0; i < 5; i++) {
      o.t = i / 30;
      drawFrame(ctx, o);
    }
    const frames = 60;
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      o.t = i / 30;
      drawFrame(ctx, o);
    }
    const avg = (performance.now() - start) / frames;
    // eslint-disable-next-line no-console
    console.log(
      `[perf ascii] ${frames} frames (${o.cols}×${o.rows}) : ${avg.toFixed(
        3,
      )} ms/frame`,
    );
    expect(avg).toBeLessThan(4);
  });
});
