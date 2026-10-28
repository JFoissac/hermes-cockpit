import { describe, expect, it } from "vitest";

import {
  MAX_BUBBLES,
  MAX_RAY_ALPHA,
  RAY_BANDS,
  REF_PERIOD,
  WAVE_BANDS,
  bandY,
  bubbleAt,
  bubblePositions,
  causticSpotAt,
  causticSpots,
  hash01,
  noise2,
  rayBandIntensity,
  rayCenter,
  rayIntensity,
  waveY,
  type Bubble,
} from "./water";

describe("hash01 / noise2", () => {
  it("hash01 est déterminé et borné dans [0, 1)", () => {
    for (let i = 0; i < 500; i += 7) {
      const a = hash01(i);
      expect(a).toBe(hash01(i));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
    expect(hash01(1234)).not.toBe(hash01(1235));
  });

  it("noise2 est déterministe, borné et continu", () => {
    for (let x = 0; x < 8; x += 1.3) {
      for (let y = 0; y < 8; y += 1.7) {
        const n = noise2(x, y, 99);
        expect(Number.isFinite(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(1);
        expect(noise2(x, y, 99)).toBe(n);
      }
    }
    // Continuité : deux points voisins ne sautent pas.
    expect(Math.abs(noise2(2.1, 3.4, 7) - noise2(2.1001, 3.4, 7))).toBeLessThan(
      0.01,
    );
    // Deux seeds différentes donnent deux champs différents.
    expect(noise2(2.5, 3.5, 1)).not.toBe(noise2(2.5, 3.5, 2));
  });
});

describe("vagues", () => {
  it("expose 3 à 5 bandes, avec des périodes de 9 à 22 s", () => {
    expect(WAVE_BANDS.length).toBeGreaterThanOrEqual(3);
    expect(WAVE_BANDS.length).toBeLessThanOrEqual(5);
    for (const b of WAVE_BANDS) {
      expect(b.period).toBeGreaterThanOrEqual(9);
      expect(b.period).toBeLessThanOrEqual(22);
      expect(b.base).toBeGreaterThan(0);
      expect(b.base).toBeLessThan(1);
      expect(b.amp).toBeGreaterThan(0);
    }
  });

  it("waveY est borné par son amplitude et déterministe", () => {
    for (const amp of [0.012, 0.03, 0.1]) {
      for (let t = 0; t < 30; t += 1.7) {
        for (let x = 0; x <= 1; x += 0.05) {
          const y = waveY(x, t, 1.3, amp);
          expect(Number.isFinite(y)).toBe(true);
          expect(Math.abs(y)).toBeLessThanOrEqual(amp + 1e-12);
        }
      }
    }
    expect(waveY(0.3, 4, 0.7, 0.02)).toBe(waveY(0.3, 4, 0.7, 0.02));
  });

  it("waveY varie dans le temps et avec l'abscisse", () => {
    expect(waveY(0.2, 0, 0, 0.03)).not.toBe(waveY(0.2, 3, 0, 0.03));
    expect(waveY(0.2, 1, 0, 0.03)).not.toBe(waveY(0.4, 1, 0, 0.03));
    // Déphaser revient à décaler l'abscisse : les crêtes se déplacent.
    expect(waveY(0.5, 2, 0, 0.02)).not.toBe(waveY(0.5, 2, 1.1, 0.02));
  });

  it("bandY reste dans [0, 1] et autour de sa position de repos", () => {
    for (const band of WAVE_BANDS) {
      for (let t = 0; t < 60; t += 2.3) {
        for (let x = 0; x <= 1.001; x += 0.02) {
          const y = bandY(band, x, t);
          expect(Number.isFinite(y)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
          expect(Math.abs(y - band.base)).toBeLessThanOrEqual(band.amp + 1e-12);
        }
      }
    }
  });

  it("chaque bande oscille autour de sa position de repos", () => {
    // La houle monte puis descend : sur une période, la déviation par
    // rapport au repos change de signe au moins une fois.
    for (const band of WAVE_BANDS) {
      let up = false;
      let down = false;
      for (let t = 0; t < band.period * 1.5; t += band.period / 24) {
        const d = bandY(band, 0.37, t) - band.base;
        if (d > 1e-6) up = true;
        if (d < -1e-6) down = true;
      }
      expect(up).toBe(true);
      expect(down).toBe(true);
    }
    expect(REF_PERIOD).toBeGreaterThan(0);
  });
});

describe("bulles", () => {
  it("plafonne à MAX_BUBBLES et reste dans le cadre", () => {
    expect(MAX_BUBBLES).toBe(80);
    const many = bubblePositions(500, 3.5, 42);
    expect(many.length).toBe(MAX_BUBBLES);

    for (let t = 0; t < 40; t += 0.9) {
      for (const b of bubblePositions(MAX_BUBBLES, t, 42)) {
        expect(Number.isFinite(b.x)).toBe(true);
        expect(Number.isFinite(b.y)).toBe(true);
        expect(Number.isFinite(b.alpha)).toBe(true);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThan(1);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(1);
        expect(b.size).toBeGreaterThanOrEqual(1);
        expect(b.size).toBeLessThanOrEqual(3);
        expect(b.alpha).toBeGreaterThanOrEqual(0);
        expect(b.alpha).toBeLessThanOrEqual(1);
      }
    }
  });

  it("est déterministe et écrit dans l'objet fourni", () => {
    const a = bubbleAt(3, 5.5, 7, { x: 0, y: 0, size: 1, alpha: 1 });
    const b = bubbleAt(3, 5.5, 7, { x: 0, y: 0, size: 1, alpha: 1 });
    expect(a).toEqual(b);

    const out: Bubble = { x: -1, y: -1, size: 0, alpha: 0 };
    expect(bubbleAt(9, 1.2, 7, out)).toBe(out);
    expect(out.size).toBeGreaterThanOrEqual(1);
  });

  it("monte (y décroît) en s'éloignant du fond", () => {
    let risen = 0;
    const count = 40;
    for (let i = 0; i < count; i++) {
      const y0 = bubbleAt(i, 0, 11, { x: 0, y: 0, size: 1, alpha: 1 }).y;
      const y1 = bubbleAt(i, 0.4, 11, { x: 0, y: 0, size: 1, alpha: 1 }).y;
      if (y1 < y0) risen++;
    }
    // Quelques bulles repassent par le bas (elles ont bouclé) : on exige
    // la grande majorité, pas la totalité.
    expect(risen).toBeGreaterThan(count * 0.7);
  });

  it("s'éteint en approchant de la surface", () => {
    // On cherche une bulle dont la position est très haute à un instant t.
    let found = false;
    for (let i = 0; i < MAX_BUBBLES && !found; i++) {
      for (let t = 0; t < 20; t += 0.05) {
        const b = bubbleAt(i, t, 3, { x: 0, y: 0, size: 1, alpha: 1 });
        if (b.y < 0.06) {
          expect(b.alpha).toBeLessThan(0.6);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe("caustiques", () => {
  it("dérive de façon déterministe, sans NaN", () => {
    const a = causticSpots(20, 4.2, 8);
    const b = causticSpots(20, 4.2, 8);
    expect(a).toEqual(b);

    for (let t = 0; t < 30; t += 1.3) {
      for (const c of causticSpots(20, t, 8)) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
        expect(Number.isFinite(c.level)).toBe(true);
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(1);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThanOrEqual(1);
        expect(c.level).toBeGreaterThanOrEqual(0);
        expect(c.level).toBeLessThan(1);
      }
    }
  });

  it("scintille : le niveau d'une tache change au cours du temps", () => {
    const l0 = causticSpotAt(2, 0, 5, { x: 0, y: 0, level: 0 }).level;
    let changed = false;
    for (let t = 0.2; t < 6; t += 0.2) {
      const l = causticSpotAt(2, t, 5, { x: 0, y: 0, level: 0 }).level;
      if (Math.abs(l - l0) > 0.02) changed = true;
    }
    expect(changed).toBe(true);
  });
});

describe("rayons de lumière", () => {
  it("décrit 2 à 3 rais obliques, très doux", () => {
    expect(RAY_BANDS.length).toBeGreaterThanOrEqual(2);
    expect(RAY_BANDS.length).toBeLessThanOrEqual(3);
    expect(MAX_RAY_ALPHA).toBeLessThanOrEqual(0.05);
  });

  it("intensité bornée dans [0, 1], nulle loin du rai", () => {
    for (let t = 0; t < 20; t += 1.1) {
      for (let y = 0; y <= 1; y += 0.05) {
        for (let x = 0; x <= 1; x += 0.02) {
          const v = rayIntensity(x, y, t);
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
    const band = RAY_BANDS[0];
    const cx = rayCenter(band, 0.5, 3);
    expect(rayBandIntensity(band, cx + 0.4, 0.5, 3)).toBe(0);
    expect(rayBandIntensity(band, cx, 0.5, 3)).toBeCloseTo(1, 6);
  });

  it("les rais balaient lentement l'écran", () => {
    const a = rayCenter(RAY_BANDS[1], 0.5, 0);
    let moved = false;
    for (let t = 1; t < 30; t += 1) {
      if (Math.abs(rayCenter(RAY_BANDS[1], 0.5, t) - a) > 0.005) moved = true;
    }
    expect(moved).toBe(true);
  });
});
