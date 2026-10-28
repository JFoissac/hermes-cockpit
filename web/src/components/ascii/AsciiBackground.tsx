import { useEffect, useRef } from "react";
import { drawMarineFrame } from "./marine-render";
import { Lagoon } from "./lagoon";

import {
  MAX_BUBBLES,
  RAY_BANDS,
  WAVE_BANDS,
  bandY,
  bubbleAt,
  causticSpotAt,
  hash01,
  rayCenter,
  type Bubble,
  type Caustic,
} from "./water";

/* ── Glyphes ──────────────────────────────────────────────────────────── */

/**
 * Rampe de luminance, du plus clair au plus dense : ASCII fin puis blocs
 * pleins (le rendu « pixel-art » du requin).
 */
/** Cadre de reference de la scene lagon (comme le fichier d'origine). */
const STAGE_W = 1944;
const STAGE_H = 1760;

export const GLYPHS = " .:-=+*#%@░▒▓█▚▞▄▀▐▌";

/**
 * Glyphes propres à l'eau (vagues, bulles, caustiques). Ils vivent hors de
 * la rampe de luminance : on ne les indexe jamais par une luminance, leur
 * dessin est piloté par la scène marine.
 */
export const WATER_GLYPHS = "~≈-▁▂▃o°░█";

/* ── Réglages du fond ─────────────────────────────────────────────────── */

const MONO_STACK = `"JetBrains Mono", "Cascadia Mono", ui-monospace, monospace`;

/** 30 fps maximum. */
const FRAME_MS = 1000 / 30;

/** Nage : période de 18 s, translation, flottement et léger roulis. */
const TWO_PI = Math.PI * 2;
const SWIM_PERIOD = 18;
const SWIM_TRAVEL = 0.3;
const SWIM_BOB = 0.028;
const SWIM_ROLL = 0.055;

/** Silhouette, repère centré : 1 unité = demi-écran le plus court. */
const BODY_HALF_LEN = 0.75;
const INV_BODY_LEN = 1 / BODY_HALF_LEN;
const BODY_HALF_THICK = 0.17;

/** Zone centrale éclaircie (lisibilité de l'UI par-dessus). */
const CENTER_DEPTH = 0.28;
const CENTER_SIGMA = 0.34;
const INV_2SIGMA2 = 1 / (2 * CENTER_SIGMA * CENTER_SIGMA);

/** Matrice de Bayer 4×4 centrée, pour casser les paliers de luminance. */
const BAYER = new Float32Array(
  [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
    (v) => (v + 0.5) / 16 - 0.5,
  ),
);

/** Budget de grille : au-delà, la cellule grandit. */
const MAX_CELLS = 12_000;
const TARGET_CELLS = 9_000;
const MIN_CELL = 9;
const MAX_CELL = 22;

/* ── PRNG déterministe ────────────────────────────────────────────────── */

/** PRNG déterministe : même seed ⇒ même animation (testable). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Anatomie du requin ───────────────────────────────────────────────── */

/** Parties anatomiques : chacune a sa teinte et son glyphe. */
const PART_BODY = 0;
const PART_DORSAL = 1;
const PART_TAIL = 2;
const PART_PECTORAL = 3;
const PART_MINOR = 4;
const PART_EYE = 5;
const PART_GILL = 6;
const PART_MOUTH = 7;

interface SharkSample {
  /** Luminance de silhouette : 0 = hors du requin, 1 = plein corps. */
  lum: number;
  /** Coordonnée transversale : -1 dos, 0 axe, +1 ventre. */
  zone: number;
  /** Partie anatomique (PART_*). */
  part: number;
  /** Vrai sur le liseré : le contour contrasté d'une cellule. */
  rim: boolean;
}

/**
 * Champ barycentrique d'un triangle : 0 dehors, ~0,6 sur les arêtes,
 * ~0,95 au cœur. Donne des ailerons nets, sans trous aux sommets.
 * (den signé : indépendant du sens d'enrourement des sommets.)
 */
function triField(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const e0x = bx - ax;
  const e0y = by - ay;
  const e1x = cx - ax;
  const e1y = cy - ay;
  const vx = px - ax;
  const vy = py - ay;
  const den = e0x * e1y - e1x * e0y;
  if (den === 0) return 0;
  const invDen = 1 / den;
  const b1 = (vx * e1y - e1x * vy) * invDen;
  const b2 = (e0x * vy - vx * e0y) * invDen;
  const b0 = 1 - b1 - b2;
  let m = b0 < b1 ? b0 : b1;
  if (b2 < m) m = b2;
  if (m <= 0) return 0;
  const e = m * 4;
  return 0.6 + 0.34 * (e < 1 ? e : 1);
}

/**
 * Échantillonne le requin, pose déjà résolue : ni trigonométrie ni
 * allocation par cellule (le résultat est écrit dans `out`, réutilisé).
 */
function sharkSample(
  u: number,
  v: number,
  travel: number,
  bob: number,
  roll: number,
  out: SharkSample,
): void {
  const du0 = u - travel;
  const dv0 = v - bob;
  // Roulis (petit angle) : rotation approchée, sans sin/cos par cellule.
  const du = du0 + roll * dv0;
  const dv = dv0 - roll * du0;

  out.lum = 0;
  out.zone = 0;
  out.part = PART_BODY;
  out.rim = false;

  // ── Corps fuselé : bombé vers la tête, museau plus fin ──
  const ax = du * INV_BODY_LEN;
  if (ax > -1 && ax < 1) {
    const t2 = 1 - ax * ax;
    const taper = ax > 0.86 ? 1 - (ax - 0.86) * 1.6 : 1;
    const w = BODY_HALF_THICK * Math.sqrt(t2) * (0.84 + 0.16 * ax) * taper;
    if (w > 0) {
      const ny = dv / w;
      if (ny > -1 && ny < 1) {
        const core = 1 - ny * ny;
        const s = Math.sqrt(core);
        out.lum = 0.42 + 0.58 * s;
        out.zone = ny;
        out.rim = core < 0.42;
      }
    }
  }

  // ── Aileron dorsal : pointe balayée vers l'arrière ──
  if (du > -0.28 && du < 0.12 && dv < -0.1 && dv > -0.52) {
    const d = triField(du, dv, -0.28, -0.12, 0.12, -0.16, -0.14, -0.5);
    if (d > out.lum) {
      out.lum = d;
      out.zone = -1;
      out.part = PART_DORSAL;
      out.rim = d < 0.7;
    }
  }

  // ── Second dorsal, plus petit, près du pédoncule ──
  if (du > -0.54 && du < -0.32 && dv < -0.08 && dv > -0.3) {
    const d = triField(du, dv, -0.54, -0.1, -0.32, -0.12, -0.47, -0.29);
    if (d > out.lum) {
      out.lum = d;
      out.zone = -1;
      out.part = PART_MINOR;
      out.rim = d < 0.7;
    }
  }

  // ── Caudale en fourche : lobe haut plus long, échancrure au pédoncule ──
  if (du > -1.05 && du < -0.56 && dv < 0.04) {
    const d = triField(du, dv, -0.56, -0.02, -0.72, 0.03, -1.02, -0.3);
    if (d > out.lum) {
      out.lum = d;
      out.zone = -1;
      out.part = PART_TAIL;
      out.rim = d < 0.7;
    }
  }
  if (du > -1.05 && du < -0.56 && dv > -0.04) {
    const d = triField(du, dv, -0.56, 0.02, -0.72, -0.03, -0.96, 0.26);
    if (d > out.lum) {
      out.lum = d;
      out.zone = -1;
      out.part = PART_TAIL;
      out.rim = d < 0.7;
    }
  }

  // ── Pectorale, sous le corps, pointée vers l'arrière ──
  if (du > -0.04 && du < 0.3 && dv > 0.07 && dv < 0.42) {
    const d = triField(du, dv, 0.28, 0.09, 0.1, 0.155, -0.02, 0.4);
    if (d > out.lum) {
      out.lum = d;
      out.zone = 1;
      out.part = PART_PECTORAL;
      out.rim = d < 0.7;
    }
  }

  // ── Pelvienne, petite, en arrière de la pectorale ──
  if (du > -0.36 && du < -0.12 && dv > 0.1 && dv < 0.3) {
    const d = triField(du, dv, -0.36, 0.11, -0.12, 0.13, -0.3, 0.29);
    if (d > out.lum) {
      out.lum = d;
      out.zone = 1;
      out.part = PART_MINOR;
      out.rim = d < 0.7;
    }
  }

  // ── Détails du corps : œil, trois branchies, bouche ──
  if (out.part === PART_BODY && out.lum > 0) {
    const ex = du - 0.5;
    const ey = dv + 0.04;
    if (ex * ex + ey * ey < 0.0008) {
      out.part = PART_EYE;
      out.rim = false;
      return;
    }
    if (du > 0.26 && du < 0.46 && dv > -0.1 && dv < 0.07) {
      const g = (du - 0.28) / 0.075;
      const near = Math.round(g);
      if (near >= 0 && near <= 2 && Math.abs(g - near) < 0.42) {
        out.part = PART_GILL;
        out.rim = false;
        return;
      }
    }
    if (du > 0.56 && du < 0.7 && dv > 0.05 && dv < 0.1) {
      out.part = PART_MOUTH;
      out.rim = false;
    }
  }
}

const sample: SharkSample = { lum: 0, zone: 0, part: 0, rim: false };

/**
 * Champ de luminance du requin dans un repère centré u,v ∈ [-1, 1].
 * Période de nage : 18 s. Borné dans [0, 1].
 */
export function sharkLuminance(u: number, v: number, t: number): number {
  const phase = (t * TWO_PI) / SWIM_PERIOD;
  sharkSample(
    u,
    v,
    Math.sin(phase) * SWIM_TRAVEL,
    Math.sin(phase * 3) * SWIM_BOB,
    Math.sin(phase + 0.85) * SWIM_ROLL,
    sample,
  );
  return sample.lum;
}

/**
 * Facteur radial d'éclaircissement du centre : 1 = pas de voile, et
 * 1 - CENTER_DEPTH au centre exact. C'est ce facteur qui garantit que
 * l'UI reste lisible au-dessus du fond (le texte ne doit jamais baver).
 */
export function centerVeil(nx: number, ny: number): number {
  return 1 - CENTER_DEPTH * Math.exp(-(nx * nx + ny * ny) * INV_2SIGMA2);
}

/* ── Palette pilotée par les variables CSS ────────────────────────────── */

/**
 * Couleurs de la scène. Chaque champ vient d'une variable CSS
 * (`--ascii-ink`, `--ascii-accent-1..3`, `--water-1`, `--water-2`),
 * avec un repli codé en dur par thème tant que le thème ne les définit pas.
 */
export interface AquaPalette {
  bg: string;
  ink: string;
  a1: string;
  a2: string;
  a3: string;
  w1: string;
  w2: string;
  /** Signature des couleurs : sert de clé de cache. */
  key: string;
}

const FALLBACK_LIGHT: AquaPalette = {
  bg: "#faf9f6",
  ink: "#1a1a1a",
  a1: "#2f6f7e",
  a2: "#6FA8B8",
  a3: "#C9A3A0",
  w1: "#dff1f4",
  w2: "#cfe7ee",
  key: "fallback-light",
};

const FALLBACK_DARK: AquaPalette = {
  bg: "#0b1418",
  ink: "#e8eef0",
  a1: "#7fd4e8",
  a2: "#3d8ea4",
  a3: "#c9a3a0",
  w1: "#10202a",
  w2: "#16323d",
  key: "fallback-dark",
};

/** Thème courant, lu sur <html> (data-theme, classe, puis préférence système). */
export function themeName(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  const attr = root.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  if (root.classList.contains("dark") || root.classList.contains("theme-dark")) {
    return "dark";
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.matches) return "dark";
  }
  return "light";
}

/**
 * Lit la palette effective : variables CSS si présentes, sinon repli du
 * thème courant. À appeler au montage et à chaque changement de thème —
 * jamais dans la boucle de rendu (getComputedStyle est coûteux).
 */
export function readPalette(): AquaPalette {
  const fallback = themeName() === "dark" ? FALLBACK_DARK : FALLBACK_LIGHT;
  if (typeof document === "undefined" || !document.documentElement) {
    return fallback;
  }
  let cs: CSSStyleDeclaration | null = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    return fallback;
  }
  const read = (name: string, def: string): string => {
    const v = cs ? cs.getPropertyValue(name).trim() : "";
    return v.length > 0 ? v : def;
  };
  const p: AquaPalette = {
    // `--ascii-bg` est le fond dédié au calque ASCII ; `--bg` sert de repli.
    bg: read("--ascii-bg", read("--bg", fallback.bg)),
    ink: read("--ascii-ink", fallback.ink),
    a1: read("--ascii-accent-1", fallback.a1),
    a2: read("--ascii-accent-2", fallback.a2),
    a3: read("--ascii-accent-3", fallback.a3),
    w1: read("--water-1", fallback.w1),
    w2: read("--water-2", fallback.w2),
    key: "",
  };
  p.key = `${p.bg}|${p.ink}|${p.a1}|${p.a2}|${p.a3}|${p.w1}|${p.w2}`;
  return p;
}

/* ── Couleurs dérivées (mises en cache, jamais construites par cellule) ── */

type RGB = [number, number, number];

const rgbCache = new Map<string, RGB | null>();

/** Parse #rgb / #rrggbb / #rrggbbaa / rgb() / rgba(). null si illisible. */
export function parseColor(input: string): RGB | null {
  const hit = rgbCache.get(input);
  if (hit !== undefined) return hit;
  const v = input.trim();
  let out: RGB | null = null;
  if (v.charCodeAt(0) === 35) {
    let h = v.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length === 6 || h.length === 8) {
      const n = Number.parseInt(h.slice(0, 6), 16);
      if (Number.isFinite(n)) out = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(v);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter((s) => s.length > 0);
      if (parts.length >= 3) {
        const r = Number.parseFloat(parts[0]);
        const g = Number.parseFloat(parts[1]);
        const b = Number.parseFloat(parts[2]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
          out = [
            Math.max(0, Math.min(255, Math.round(r))),
            Math.max(0, Math.min(255, Math.round(g))),
            Math.max(0, Math.min(255, Math.round(b))),
          ];
        }
      }
    }
  }
  rgbCache.set(input, out);
  return out;
}

/** Mélange linéaire de deux couleurs, k = 0 → a, k = 1 → b. */
function mix(a: string, b: string, k: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Couleur + opacité. Si la couleur est illisible, on la renvoie telle quelle. */
function withAlpha(color: string, a: number): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
}

/* Index des styles d'eau (table plate, pré-calculée par palette). */
const S_WAVE = 0; // 4 paliers
const S_CREST = 4; // 3
const S_CAUSTIC = 7; // 3
const S_BUBBLE = 10; // 3
const S_RAY = 13; // 3
const S_GRAIN = 16; // 2

interface AquaStyles {
  bg: string;
  /** 3 zones (dos, flanc, ventre) × 3 tons = 9 entrées. */
  sharkBody: string[];
  sharkOutline: string;
  sharkEye: string;
  sharkGill: string;
  sharkGlitch: string[];
  water: string[];
}

const styleCache = new Map<string, AquaStyles>();

function stylesFor(p: AquaPalette, accents?: string[]): AquaStyles {
  const extra = accents && accents.length > 0 ? accents.join(",") : "";
  const key = extra.length > 0 ? `${p.key}#${extra}` : p.key;
  const hit = styleCache.get(key);
  if (hit) return hit;

  // ── Requin : dos sombre (accent-2), flancs (accent-1), ventre clair ──
  const zones = [p.a2, mix(p.a1, p.a2, 0.18), mix(p.a1, p.w1, 0.6)];
  // Un ton = un palier d'opacité, pour trois niveaux de dégradé par zone.
  const tones = [
    [0.62, 0.8, 0.95],
    [0.5, 0.68, 0.84],
    [0.3, 0.42, 0.55],
  ];
  const sharkBody: string[] = [];
  for (let z = 0; z < 3; z++) {
    for (let tone = 0; tone < 3; tone++) {
      sharkBody.push(withAlpha(zones[z], tones[z][tone]));
    }
  }

  // Œil clair quel que soit le thème : on éclaircit la couleur de fond.
  const eye = mix(p.bg, "#ffffff", 0.75);

  const waveBase = mix(p.w2, p.a1, 0.35);
  const crestBase = mix(p.a1, p.w2, 0.3);
  const causticBase = mix(p.a2, p.bg, 0.25);
  const bubbleBase = mix(p.a1, p.bg, 0.12);

  const water: string[] = [];
  const push = (color: string, alphas: number[]): void => {
    for (let i = 0; i < alphas.length; i++) {
      water.push(withAlpha(color, alphas[i]));
    }
  };
  push(waveBase, [0.1, 0.15, 0.2, 0.26]); // S_WAVE : 4 collines
  push(crestBase, [0.16, 0.22, 0.3]); // S_CREST : 3
  push(causticBase, [0.1, 0.17, 0.24]); // S_CAUSTIC : 3
  push(bubbleBase, [0.2, 0.3, 0.4]); // S_BUBBLE : 3
  push(p.a1, [0.018, 0.032, 0.05]); // S_RAY : 3, alpha ≤ 0.05
  push(p.a2, [0.06, 0.09]); // S_GRAIN : 2

  const glitch =
    accents && accents.length > 0
      ? [
          withAlpha(accents[0], 0.72),
          withAlpha(accents[accents.length - 1], 0.62),
        ]
      : [withAlpha(p.a3, 0.7), withAlpha(p.a1, 0.62), withAlpha(p.a2, 0.7)];

  const st: AquaStyles = {
    bg: p.bg,
    sharkBody,
    sharkOutline: withAlpha(p.ink, 0.55),
    sharkEye: withAlpha(eye, 0.92),
    sharkGill: withAlpha(p.ink, 0.42),
    sharkGlitch: glitch,
    water,
  };
  styleCache.set(key, st);
  return st;
}

/* ── Palette par défaut du rendu direct (tests, aperçus) ──────────────── */

let autoPalette: AquaPalette = FALLBACK_LIGHT;
let autoFor = "";

function autoPaletteNow(): AquaPalette {
  const name = themeName();
  if (autoFor === name) return autoPalette;
  autoPalette = readPalette();
  autoFor = name;
  return autoPalette;
}

/* ── Scène d'eau (prépassage) ─────────────────────────────────────────── */

interface Scene {
  cols: number;
  rows: number;
  /** Abscisse centrée u ∈ [-1, 1] par colonne (indépendante du temps). */
  colU: Float32Array;
  /** Partie horizontale du voile central, par colonne. */
  colAtt: Float32Array;
  /** Indice de glyphe d'eau (WATER_GLYPHS). */
  glyph: Uint8Array;
  /** Indice de style d'eau (AquaStyles.water). */
  style: Uint8Array;
  /** 0 = vide, sinon peint. */
  flag: Uint8Array;
}

const scene: Scene = {
  cols: 0,
  rows: 0,
  colU: new Float32Array(0),
  colAtt: new Float32Array(0),
  glyph: new Uint8Array(0),
  style: new Uint8Array(0),
  flag: new Uint8Array(0),
};

function ensureScene(cols: number, rows: number): void {
  if (scene.cols === cols && scene.rows === rows) return;
  scene.cols = cols;
  scene.rows = rows;
  scene.colU = new Float32Array(cols);
  scene.colAtt = new Float32Array(cols);
  scene.glyph = new Uint8Array(cols * rows);
  scene.style = new Uint8Array(cols * rows);
  scene.flag = new Uint8Array(cols * rows);
  const halfW = cols * 0.5;
  const halfH = rows * 0.5;
  const minHalf = halfW < halfH ? halfW : halfH;
  for (let x = 0; x < cols; x++) {
    const dx = x - halfW;
    scene.colU[x] = dx / minHalf;
    const nx = dx / halfW;
    // Partie horizontale du voile : exp(-nx²·k)·exp(-ny²·k) = centerVeil().
    scene.colAtt[x] = Math.exp(-(nx * nx) * INV_2SIGMA2);
  }
}

/* Glyphes d'eau, indexés dans WATER_GLYPHS. */
const G_TILDE = 0;
const G_APPROX = 1;
const G_DASH = 2;
const G_LOW1 = 3;
const G_LOW2 = 4;
const G_LOW3 = 5;
const G_BUBBLE = 6;
const G_DEG = 7;
const G_SHADE = 8;

const bubbleScratch: Bubble = { x: 0, y: 0, size: 1, alpha: 1 };
const causticScratch: Caustic = { x: 0, y: 0, level: 0 };

/** Le voile central retire un palier d'opacité à l'eau. */
function veilShift(x: number, attenY: number): number {
  return 1 - CENTER_DEPTH * scene.colAtt[x] * attenY < 0.8 ? 1 : 0;
}

/** Écrit une cellule d'eau si elle est libre (la première peinture gagne). */
function put(
  cols: number,
  rows: number,
  x: number,
  y: number,
  glyph: number,
  style: number,
): void {
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  const i = y * cols + x;
  if (scene.flag[i] !== 0) return;
  scene.flag[i] = 1;
  scene.glyph[i] = glyph;
  scene.style[i] = style;
}

/**
 * Compose la couche d'eau d'une frame : rais obliques, houles, grain,
 * caustiques puis bulles. Aucune allocation : tout est écrit dans les
 * buffers de `scene`, réutilisés d'une frame à l'autre.
 */
function buildScene(cols: number, rows: number, t: number, seed: number): void {
  ensureScene(cols, rows);
  scene.flag.fill(0);

  const rowsInv = 1 / rows;
  const colsInv = 1 / cols;
  const halfH = rows * 0.5;

  // ── 1. Rais de lumière obliques (sous tout le reste) ──
  for (let b = 0; b < RAY_BANDS.length; b++) {
    const band = RAY_BANDS[b];
    for (let y = 0; y < rows; y += 2) {
      const cx = Math.round(rayCenter(band, y * rowsInv, t) * cols);
      const ny = (y - halfH) / halfH;
      const attenY = Math.exp(-(ny * ny) * INV_2SIGMA2);
      for (let dx = -1; dx <= 1; dx++) {
        // Un rai reste un fil de lumière : on n'éclaire qu'une cellule sur
        // deux, sinon il masque la houle qui passe derrière.
        if (hash01(seed + y * 6151 + b * 3079 + dx) < 0.5) continue;
        const x = cx + dx;
        if (x < 0 || x >= cols) continue;
        const inten = 1 - Math.abs(dx) / (band.width * cols + 0.5);
        if (inten <= 0.25) continue;
        put(
          cols,
          rows,
          x,
          y,
          G_DEG,
          S_RAY + Math.max(0, (inten > 0.7 ? 2 : 1) - veilShift(x, attenY)),
        );
      }
    }
  }

  // ── 2. Houles : 4 bandes qui montent et descendent ──
  for (let b = 0; b < WAVE_BANDS.length; b++) {
    const band = WAVE_BANDS[b];
    const deepest = b === WAVE_BANDS.length - 1;
    for (let x = 0; x < cols; x++) {
      // Trait brouillé : une colonne sur trois est sautée.
      if (hash01(seed + x * 7919 + b * 104729) < 0.3) continue;
      const yr = Math.round(bandY(band, x * colsInv, t) * rows);
      const ny = (yr - halfH) / halfH;
      const attenY = Math.exp(-(ny * ny) * INV_2SIGMA2);
      const pick = (x + b * 3) & 3;
      const glyph = deepest
        ? pick === 0
          ? G_LOW3
          : pick === 1
            ? G_LOW2
            : pick === 2
              ? G_LOW1
              : G_TILDE
        : pick === 0
          ? G_DASH
          : pick === 1
            ? G_APPROX
            : G_TILDE;
      const tier = b < 3 ? b : 3;
      const shift = veilShift(x, attenY);
      put(cols, rows, x, yr, glyph, S_WAVE + Math.max(0, tier - shift));
      // Écume : une crête plus claire juste au-dessus, une colonne sur trois.
      if (x % 3 === 0) {
        put(
          cols,
          rows,
          x,
          yr - 1,
          G_LOW1,
          S_CREST + Math.max(0, (b > 2 ? 2 : 1) - shift),
        );
      }
    }
  }

  // ── 3. Grain : texture fine et déterministe (plancton), bas de l'écran ──
  for (let y = (rows * 0.45) | 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (((x * 7 + y * 13 + seed) & 63) !== 0) continue;
      put(cols, rows, x, y, G_DASH, S_GRAIN);
    }
  }

  // ── 4. Caustiques : taches claires qui dérivent et scintillent ──
  let cc = Math.round((cols * rows) / 120);
  if (cc < 14) cc = 14;
  if (cc > 56) cc = 56;
  for (let i = 0; i < cc; i++) {
    causticSpotAt(i, t, seed, causticScratch);
    const x = (causticScratch.x * cols) | 0;
    const y = (causticScratch.y * rows) | 0;
    const lvl = causticScratch.level;
    const tier = lvl > 0.72 ? 2 : lvl > 0.42 ? 1 : 0;
    const ny = (y - halfH) / halfH;
    const attenY = Math.exp(-(ny * ny) * INV_2SIGMA2);
    const shift = veilShift(x, attenY);
    put(
      cols,
      rows,
      x,
      y,
      lvl > 0.55 ? G_SHADE : G_DEG,
      S_CAUSTIC + Math.max(0, tier - shift),
    );
    if (lvl > 0.8) {
      put(
        cols,
        rows,
        x + 1,
        y,
        G_DEG,
        S_CAUSTIC + Math.max(0, tier - 1 - shift),
      );
    }
  }

  // ── 5. Bulles : montée verticale, éclat en surface ──
  let nb = Math.round((cols * rows) / 110);
  if (nb < 24) nb = 24;
  if (nb > MAX_BUBBLES) nb = MAX_BUBBLES;
  for (let i = 0; i < nb; i++) {
    bubbleAt(i, t, seed, bubbleScratch);
    const x = (bubbleScratch.x * cols) | 0;
    const yb = (bubbleScratch.y * rows) | 0;
    const size = bubbleScratch.size;
    const fade = bubbleScratch.alpha;
    if (fade <= 0.06) continue;
    const base = size >= 3 ? 2 : size === 2 ? 1 : 0;
    // Les bulles s'éteignent en approchant de la surface (fondu).
    const tier = fade > 0.75 ? base : base > 0 ? base - 1 : 0;
    for (let k = 0; k < size; k++) {
      const y = yb - k;
      if (y < 0) break;
      put(cols, rows, x, y, k === size - 1 ? G_BUBBLE : G_DEG, S_BUBBLE + tier);
    }
  }
}

/* ── Rendu d'une frame ────────────────────────────────────────────────── */

export interface DrawOptions {
  cols: number;
  rows: number;
  cell: number;
  t: number;
  seed: number;
  bg?: string;
  ink?: string;
  accents?: string[];
  /** Palette résolue (variables CSS). Sinon, palette du thème courant. */
  palette?: AquaPalette;
}

function paletteForDraw(o: DrawOptions): AquaPalette {
  const base = o.palette ?? autoPaletteNow();
  if (o.bg === undefined && o.ink === undefined) return base;
  return {
    ...base,
    bg: o.bg ?? base.bg,
    ink: o.ink ?? base.ink,
    key: `${base.key}|${o.bg ?? ""}|${o.ink ?? ""}`,
  };
}

/**
 * Dessine une frame complète : eau (houles, caustiques, bulles, rais) puis
 * requin pixel-art par-dessus.
 *
 * Aucune allocation d'objet ni closure dans la boucle interne : la scène
 * d'eau est écrite dans des buffers réutilisés, les styles sont des chaînes
 * pré-calculées par palette puis indexées, et une cellule ne produit qu'un
 * seul `fillText` (le requin masque l'eau qu'il recouvre).
 */
function legacyDrawFrame(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const cols = o.cols | 0;
  const rows = o.rows | 0;
  if (cols < 1 || rows < 1) return;

  const cell = o.cell > 0 ? o.cell : 8;
  const t = Number.isFinite(o.t) ? o.t : 0;
  const seed = o.seed | 0;

  const palette = paletteForDraw(o);
  const st = stylesFor(palette, o.accents);

  ctx.fillStyle = st.bg;
  ctx.fillRect(0, 0, cols * cell, rows * cell);
  ctx.font = `${Math.max(6, Math.round(cell - 1))}px ${MONO_STACK}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";

  buildScene(cols, rows, t, seed);

  // Pose du requin : trois sin par frame, jamais par cellule.
  const phase = (t * TWO_PI) / SWIM_PERIOD;
  const travel = Math.sin(phase) * SWIM_TRAVEL;
  const bob = Math.sin(phase * 3) * SWIM_BOB;
  const roll = Math.sin(phase + 0.85) * SWIM_ROLL;

  const accentRnd = mulberry32(
    (seed ^ Math.imul(((t * 3) | 0) + 7, 0x85ebca6b)) >>> 0,
  );

  const halfW = cols * 0.5;
  const halfH = rows * 0.5;
  const minHalf = halfW < halfH ? halfW : halfH;

  const half = cell * 0.5;
  const pad = Math.max(0.5, cell * 0.06);

  for (let y = 0; y < rows; y++) {
    const dy = y - halfH;
    const v = dy / minHalf;
    const ny = dy / halfH;
    const attenY = Math.exp(-(ny * ny) * INV_2SIGMA2);
    const rowY = y * cell + pad;
    const bayerRow = (y & 3) << 2;
    const rowBase = y * cols;

    for (let x = 0; x < cols; x++) {
      sharkSample(scene.colU[x], v, travel, bob, roll, sample);

      if (sample.lum <= 0) {
        const idx = rowBase + x;
        if (scene.flag[idx] === 0) continue;
        ctx.fillStyle = st.water[scene.style[idx]];
        ctx.fillText(WATER_GLYPHS[scene.glyph[idx]], x * cell + half, rowY);
        continue;
      }

      // Tramage ordonné : casse les paliers de luminance.
      let l = sample.lum + BAYER[bayerRow | (x & 3)] * 0.06;
      if (l < 0.02) l = 0.02;
      else if (l > 1) l = 1;

      // Voile central : le requin passe en demi-teinte derrière l'UI.
      const lm = l * (1 - CENTER_DEPTH * scene.colAtt[x] * attenY);

      let gi: number;
      let style: string;

      if (sample.part === PART_EYE) {
        gi = 13; // █ : l'œil, un bloc plein clair
        style = st.sharkEye;
      } else if (sample.part === PART_GILL) {
        gi = 18; // ▐ : trait vertical
        style = st.sharkGill;
      } else if (sample.part === PART_MOUTH) {
        gi = 3; // -
        style = st.sharkGill;
      } else if (sample.rim) {
        gi = 12; // ▓ : contour dense et contrasté
        style = st.sharkOutline;
      } else if (
        sample.part === PART_BODY &&
        sample.zone > -0.16 &&
        sample.zone < 0.02 &&
        ((x + y) & 1) === 0
      ) {
        // Ligne latérale : pointillé clair tout du long du flanc, en
        // alternance de cellules pour rester un détail et non une bande.
        gi = 1; // .
        style = st.sharkBody[3]; // zone flanc, ton le plus clair
      } else if (accentRnd() < 0.032) {
        // Grain pixel : ~3 % de cellules prennent un accent coloré.
        gi = accentRnd() < 0.5 ? 14 : 13; // ▚ ou █
        style = st.sharkGlitch[(accentRnd() * st.sharkGlitch.length) | 0];
      } else {
        const q = (lm * 3.99) | 0;
        gi = 10 + (q > 3 ? 3 : q); // ░ ▒ ▓ █
        const tone = lm > 0.72 ? 2 : lm > 0.46 ? 1 : 0;
        const zone = sample.zone < -0.3 ? 0 : sample.zone > 0.34 ? 2 : 1;
        style = st.sharkBody[zone * 3 + tone];
      }

      ctx.fillStyle = style;
      ctx.fillText(GLYPHS[gi], x * cell + half, rowY);
    }
  }
}

/* ── Composant ────────────────────────────────────────────────────────── */

/**
 * Grille pour une surface donnée : cellule de 9 à 16 px, agrandie au-delà
 * si nécessaire pour ne jamais dépasser `MAX_CELLS` cellules.
 */
export function gridFor(
  w: number,
  h: number,
): { cols: number; rows: number; cell: number } {
  const area = Math.max(1, w) * Math.max(1, h);
  let cell = Math.round(Math.sqrt(area / TARGET_CELLS));
  if (cell < MIN_CELL) cell = MIN_CELL;
  if (cell > MAX_CELL) cell = MAX_CELL;
  while (cell < 48 && Math.floor(w / cell) * Math.floor(h / cell) > MAX_CELLS) {
    cell++;
  }
  return {
    cols: Math.max(2, Math.floor(w / cell)),
    rows: Math.max(2, Math.floor(h / cell)),
    cell,
  };
}

/**
 * Fond animé : 30 fps max, pause si l'onglet est caché, une seule frame
 * si l'utilisateur préfère les animations réduites, DPR plafonné à 2.
 * Les couleurs sont relues à chaque changement de thème (data-theme).
 */
export interface AsciiBackgroundProps {
  seed?: number;
  /** `lagoon` = lagon de référence, `marine` = scène marine maison. */
  variant?: "lagoon" | "marine";
  /** `cover` remplit la fenêtre, `contain` garde le cadre natif (comme la référence). */
  fit?: "cover" | "contain";
}

export default function AsciiBackground({
  seed = 1337,
  variant = "marine",
  fit = "cover",
}: AsciiBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = 0;
    let cols = 0;
    let rows = 0;
    let cell = 8;
    let lagoon: Lagoon | null = null;
    let stage: HTMLCanvasElement | null = null;
    let stageCtx: CanvasRenderingContext2D | null = null;
    let cw = 1;
    let ch = 1;
    let dark = false;
    let palette = readPalette();
    let elapsed = 0;
    const t0 = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // clientWidth/Height : on ignore la barre de défilement et on évite la boucle
      // « le canvas déborde -> la page s'élargit -> le canvas se réajuste plus large ».
      const root = document.documentElement;
      dark = root.dataset.theme === "dark";
      const w = root.clientWidth || window.innerWidth || 1024;
      const h = root.clientHeight || window.innerHeight || 768;
      const grid = gridFor(w, h);
      cell = grid.cell;
      cols = grid.cols;
      rows = grid.rows;
      canvas.width = Math.floor(cols * cell * dpr);
      canvas.height = Math.floor(rows * cell * dpr);
      canvas.style.width = `${cols * cell}px`;
      canvas.style.height = `${rows * cell}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Deux fonds au choix : la scène marine (défaut) ou le lagon de référence,
      // activable par `?fond=lagoon`. Le lagon travaille en pixels device.
      cw = canvas.width;
      ch = canvas.height;

      // Le lagon est composé dans son cadre de référence (1944x1760) puis affiché
      // en « cover » : c'est ce cadrage qui donne l'équilibre de la scene.
      const fromUrl =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("fond")
          : null;
      const wantLagoon = fromUrl ? fromUrl === "lagoon" : variant === "lagoon";
      try {
        if (wantLagoon) {
          lagoon = new Lagoon(STAGE_W, STAGE_H, dark);
          stage = document.createElement("canvas");
          stage.width = STAGE_W;
          stage.height = STAGE_H;
          stageCtx = stage.getContext("2d");
        } else {
          lagoon = null;
          stage = null;
          stageCtx = null;
        }
      } catch {
        lagoon = null;
        stage = null;
        stageCtx = null;
      }
    };

    const paint = (t: number) => {
      if (lagoon && stage && stageCtx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        lagoon.draw(stageCtx, t);
        // « cover » : la scene remplit toujours le canvas, donc aucun effacement
        // prealable n'est necessaire.
        // cover : la scène remplit ; contain : cadre natif centré, marges peintes
        // avec la couleur d'eau (aucun effacement nécessaire, on recouvre tout).
        const scale =
          fit === "contain"
            ? Math.min(cw / STAGE_W, ch / STAGE_H)
            : Math.max(cw / STAGE_W, ch / STAGE_H);
        const dw = STAGE_W * scale;
        const dh = STAGE_H * scale;
        if (dw < cw || dh < ch) {
          ctx.fillStyle = dark ? "#04222c" : "#b2f0e8";
          ctx.fillRect(0, 0, cw, ch);
        }
        ctx.drawImage(stage, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
        return;
      }
      elapsed = t;
      drawFrame(ctx, { cols, rows, cell, t, seed, palette });
    };

    resize();
    paint(0);

    const onResize = () => {
      resize();
      paint((performance.now() - t0) / 1000);
    };
    window.addEventListener("resize", onResize);

    // Thème : les variables CSS peuvent changer sans remonter le composant.
    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        palette = readPalette();
        paint(elapsed);
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "class", "style"],
      });
    }

    const cleanup = () => {
      window.removeEventListener("resize", onResize);
      if (observer) observer.disconnect();
    };

    if (reduce) return cleanup;

    const render = (now: number) => {
      raf = window.requestAnimationFrame(render);
      if (document.hidden) return;
      if (now - last < FRAME_MS) return;
      last = now;
      paint((now - t0) / 1000);
    };
    raf = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(raf);
      cleanup();
    };
  }, [seed]);

  return (
    <div className="ascii-layer" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

/** Rendu public : scène marine (requin rempli + eau), palettes pilotées par le thème. */
export function drawFrame(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  drawMarineFrame(ctx, {
    cols: o.cols,
    rows: o.rows,
    cell: o.cell,
    t: o.t,
    seed: o.seed,
    bg: o.bg,
    veil: 0.32,
  });
}

// L'ancien moteur (demi-teinte procédurale) reste dans le fichier comme référence
// de la silhouette ; il n'est plus appelé.
void legacyDrawFrame;
