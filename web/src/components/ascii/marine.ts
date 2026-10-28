/**
 * Rendu « marine » : requin pixel-ASCII coloré + eau animée.
 *
 * Le requin est dessiné comme une FORME (dedans/dehors), pas comme un dégradé :
 * l'intérieur est rempli de blocs pleins, le contour est plus clair, la couleur
 * dépend de la hauteur (dos sombre → ventre clair). C'est ce qui donne un vrai
 * pixel-art lisible plutôt qu'une trame floue.
 *
 * Autonome : lit ses couleurs dans les variables CSS (compatibles dark mode) avec
 * des replis codés en dur.
 */

export const MARINE_GLYPHS = " .:-=+*#%@░▒▓█▚▞▄▀▐▌";

export interface MarinePalette {
  /** Dégradé de fond, du haut (surface) vers le bas (profondeur). */
  scene: string[];
  /** Petits poissons jaunes. */
  fish: string;
  fishAlt: string;
  /** Rayons de lumière. */
  ray: string;
  back: string;
  mid: string;
  belly: string;
  rim: string;
  eye: string;
  water: string;
  crest: string;
  bubble: string;
  caustic: string;
}

const LIGHT: MarinePalette = {
  scene: ["#f7fcfd", "#f1f8fa", "#eaf4f7", "#e3eff3", "#dcebef", "#d5e7ec"],
  fish: "#d9a93c",
  fishAlt: "#c98f33",
  ray: "#9ed3e0",
  back: "#12414f",
  mid: "#2f7f93",
  belly: "#cfe9ef",
  rim: "#0b2b33",
  eye: "#ffffff",
  water: "#7fb9c9",
  crest: "#a8d8e4",
  bubble: "#8fd0e0",
  caustic: "#bfe6ef",
};

const DARK: MarinePalette = {
  scene: ["#0d3543", "#0a2b37", "#08232d", "#061c24", "#05171e", "#04121a"],
  fish: "#f0cf5e",
  fishAlt: "#e8a94b",
  ray: "#7fd4e8",
  back: "#2b7f96",
  mid: "#63c2d8",
  belly: "#d9f2f8",
  rim: "#9fe6f5",
  eye: "#ffffff",
  water: "#3d8ea4",
  crest: "#7fd4e8",
  bubble: "#9fe0ee",
  caustic: "#cdeef7",
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

let paletteCache: { theme: string; palette: MarinePalette } | null = null;

/**
 * Palette courante : variables CSS si présentes, sinon repli selon le thème.
 * Mise en cache par thème — getComputedStyle par frame coûtait ~6 ms.
 */
export function marinePalette(): MarinePalette {
  const theme =
    typeof document === "undefined" ? "light" : document.documentElement.dataset.theme ?? "light";
  if (paletteCache && paletteCache.theme === theme) return paletteCache.palette;
  const dark = theme === "dark";
  const base = dark ? DARK : LIGHT;
  const built: MarinePalette = {
    scene: base.scene,
    fish: cssVar("--ascii-fish", base.fish),
    fishAlt: cssVar("--ascii-fish-alt", base.fishAlt),
    ray: cssVar("--water-2", base.ray),
    back: cssVar("--ascii-accent-2", base.back),
    mid: cssVar("--ascii-accent-1", base.mid),
    belly: cssVar("--ascii-belly", base.belly),
    rim: cssVar("--ascii-outline", base.rim),
    eye: base.eye,
    water: cssVar("--water-1", base.water),
    crest: cssVar("--water-2", base.crest),
    bubble: cssVar("--water-2", base.bubble),
    caustic: cssVar("--ascii-belly", base.caustic),
  };
  paletteCache = { theme, palette: built };
  return built;
}

/* ── Géométrie ───────────────────────────────────────────────────────── */

/** Demi-épaisseur du corps à l'abscisse u (corps fuselé, tête à droite). */
export function bodyHalfThickness(u: number): number {
  const span = 0.66;
  if (u < -span || u > span) return 0;
  const k = u / span;
  const taper = Math.pow(1 - k * k, 0.78);
  return 0.19 * taper * (1 + 0.16 * k);
}

function inTriangle(
  u: number,
  v: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (u - bx) * (ay - by) - (ax - bx) * (v - by);
  const d2 = (u - cx) * (by - cy) - (bx - cx) * (v - cy);
  const d3 = (u - ax) * (cy - ay) - (cx - ax) * (v - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

export type SharkPart = "none" | "body" | "dorsal" | "pectoral" | "tail" | "eye" | "gill";

export interface SharkSample {
  part: SharkPart;
  /** Position verticale relative dans la forme, -1 (haut) → +1 (bas). */
  depth: number;
  /** Vrai sur le bord de la silhouette (première cellule à l'intérieur). */
  rim: boolean;
}

/**
 * Échantillonne la silhouette à la position (u, v), requin déjà translaté/roulé.
 * `inset` sert à détecter le contour (échantillon décalé vers l'extérieur).
 */
export function sharkAt(u: number, v: number): SharkSample {
  const none: SharkSample = { part: "none", depth: 0, rim: false };

  // Corps
  const half = bodyHalfThickness(u);
  if (half > 0 && Math.abs(v) <= half) {
    const depth = v / half;
    const eyeU = u - 0.42;
    const eyeV = v + 0.02;
    if (eyeU * eyeU / 0.0022 + eyeV * eyeV / 0.0016 <= 1) {
      return { part: "eye", depth, rim: false };
    }
    const gill = u > 0.2 && u < 0.34 && Math.abs((v / half) - 0.15) < 0.55;
    return { part: "body", depth, rim: false , ...(gill ? { part: "gill" as SharkPart } : {}) };
  }

  // Aileron dorsal (au-dessus, pointe vers l'arrière)
  if (inTriangle(u, v, 0.12, -0.20, -0.06, -0.52, -0.32, -0.22)) {
    return { part: "dorsal", depth: (v + 0.38) / 0.3, rim: false };
  }
  // Pectorale (sous le corps, vers l'arrière)
  if (inTriangle(u, v, 0.18, 0.18, 0.06, 0.50, -0.16, 0.24)) {
    return { part: "pectoral", depth: (v - 0.2) / 0.3, rim: false };
  }
  // Queue en fourche
  if (inTriangle(u, v, -0.55, 0.0, -1.02, -0.40, -0.72, 0.0)) {
    return { part: "tail", depth: -0.6, rim: false };
  }
  if (inTriangle(u, v, -0.55, 0.0, -1.02, 0.36, -0.72, 0.0)) {
    return { part: "tail", depth: 0.6, rim: false };
  }

  return none;
}

/* ── Eau ──────────────────────────────────────────────────────────────── */

/** Hauteur (0..1) d'une vague pour l'abscisse normalisée nx. */
export function waveY(nx: number, t: number, band: number): number {
  const phase = t * (0.55 + band * 0.16) + band * 1.7;
  return 0.66 + band * 0.085 + 0.035 * Math.sin(nx * (5.2 + band) + phase)
    + 0.018 * Math.sin(nx * 11.3 - phase * 1.7);
}

export interface Bubble {
  x: number;
  y: number;
  size: number;
}

/** Bulles déterministes (aucun Math.random) : montée + balancement. */
export function bubbles(count: number, t: number, seed: number): Bubble[] {
  const out: Bubble[] = [];
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const base = rnd();
    const speed = 0.02 + rnd() * 0.05;
    const sway = 0.01 + rnd() * 0.02;
    const y = 1 - ((base + t * speed) % 1);
    out.push({
      x: rnd() * 0.98 + 0.01 + Math.sin(t * 0.9 + i) * sway,
      y,
      size: rnd() < 0.75 ? 1 : 2,
    });
  }
  return out;
}
