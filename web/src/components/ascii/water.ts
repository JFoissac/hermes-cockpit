/**
 * Scène marine du fond ASCII : maths pures — aucun DOM, aucun canvas.
 *
 * Tout est déterministe (même seed + même temps ⇒ même image), sans
 * `Math.random()`, ce qui rend la scène testable en isolation et empêche
 * toute dérive entre deux frames.
 */

/* ── Hash & bruit ─────────────────────────────────────────────────────── */

/** Hash entier → [0, 1). Aucune allocation, aucun état. */
export function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Bruit de valeur 2D bilinéaire (lissage cubique), déterministe et borné
 * dans [0, 1). Sert au scintillement des caustiques et à la dérive des
 * taches : jamais de Math.random, donc aucune frame imprévisible.
 */
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = smooth01(fx);
  const sy = smooth01(fy);
  const s = seed | 0;
  const kx = Math.imul(xi, 0x27d4eb2f);
  const kx1 = Math.imul(xi + 1, 0x27d4eb2f);
  const ky = Math.imul(yi, 0x165667b1);
  const ky1 = Math.imul(yi + 1, 0x165667b1);
  const n00 = hash01(s ^ kx ^ ky);
  const n10 = hash01(s ^ kx1 ^ ky);
  const n01 = hash01(s ^ kx ^ ky1);
  const n11 = hash01(s ^ kx1 ^ ky1);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return a + (b - a) * sy;
}

/* ── Vagues ───────────────────────────────────────────────────────────── */

/** Période de référence de {@link waveY} (secondes). */
export const REF_PERIOD = 15;

export interface WaveBand {
  /** Position verticale moyenne, normalisée (0 = haut, 1 = bas). */
  base: number;
  /** Amplitude maximale, en fraction de la hauteur. */
  amp: number;
  /** Période en secondes (comprise entre 9 et 22). */
  period: number;
  /** Déphasage en radians. */
  phase: number;
  /** Dérive horizontale, en fraction de largeur par seconde. */
  drift: number;
}

/**
 * Cinq bandes de houle : les plus basses sont les plus rapides, comme une
 * vraie houle qui se resserre en approchant du bord. Les périodes vont de
 * 9,6 s à 21 s, donc aucun battement synchrone à l'écran.
 */
export const WAVE_BANDS: readonly WaveBand[] = [
  { base: 0.17, amp: 0.012, period: 19.4, phase: 4.3, drift: 0.0034 },
  { base: 0.3, amp: 0.016, period: 21.0, phase: 0.0, drift: 0.003 },
  { base: 0.48, amp: 0.02, period: 16.2, phase: 1.9, drift: 0.0024 },
  { base: 0.66, amp: 0.024, period: 12.4, phase: 3.6, drift: 0.0018 },
  { base: 0.82, amp: 0.028, period: 9.6, phase: 5.2, drift: 0.0012 },
];

/**
 * Décalage vertical d'une vague : somme de deux sinusoïdes déphasées.
 * `x` est normalisé (0..1), `t` en secondes, `phase` en radians.
 * Le résultat est borné par ±`amp` (somme des poids = 1).
 */
export function waveY(
  x: number,
  t: number,
  phase: number,
  amp: number,
): number {
  const w = (Math.PI * 2) / REF_PERIOD;
  const a = Math.sin(w * t + x * 6.4 + phase);
  const b = Math.sin(w * 1.7 * t - x * 11.3 - phase * 0.6);
  return amp * (0.7 * a + 0.3 * b);
}

/** Ordonnée normalisée d'une bande à l'abscisse `x`, bornée dans [0, 1]. */
export function bandY(band: WaveBand, x: number, t: number): number {
  const ty = t * (REF_PERIOD / band.period);
  const y = band.base + waveY(x - t * band.drift, ty, band.phase, band.amp);
  return y < 0 ? 0 : y > 1 ? 1 : y;
}

/* ── Bulles ───────────────────────────────────────────────────────────── */

/** Budget de dessin : jamais plus de 80 bulles simultanées. */
export const MAX_BUBBLES = 80;

export interface Bubble {
  /** Abscisse normalisée [0, 1). */
  x: number;
  /** Ordonnée normalisée [0, 1] (0 = surface). */
  y: number;
  /** Hauteur en cellules : 1 à 3. */
  size: number;
  /** Fondu : 0 à la surface, 1 en profondeur. */
  alpha: number;
}

/**
 * Bulle n° `i` à l'instant `t` : montée verticale, léger balancement,
 * taille variable et fondu au ras de la surface. Écrit dans `out`
 * (aucune allocation) et le renvoie.
 */
export function bubbleAt(
  i: number,
  t: number,
  seed: number,
  out: Bubble,
): Bubble {
  const k = seed ^ Math.imul(i + 1, 0x9e3779b1);
  const hx = hash01(k);
  const hy = hash01(k ^ 0x85ebca6b);
  const hs = hash01(k ^ 0x27d4eb2f);
  const hp = hash01(k ^ 0x165667b1);

  // Traversée de l'écran : 6,5 à 15 s selon la bulle.
  const period = 6.5 + hs * 8.5;
  const u = (t / period + hy) % 1;
  let y = 1 - u;

  // Balancement latéral, plus marqué pour les grosses bulles.
  const sway = 0.012 + hs * 0.02;
  let x = hx + Math.sin(t * (0.7 + hs * 1.3) + hp * 6.283185) * sway;
  x -= Math.floor(x);

  // Fondu sur les 12 % supérieurs : la bulle éclate en surface.
  const alpha = y < 0.12 ? y / 0.12 : 1;

  if (y < 0) y = 0;
  out.x = x;
  out.y = y;
  out.size = hs < 0.22 ? 3 : hs < 0.6 ? 2 : 1;
  out.alpha = alpha;
  return out;
}

/** Toutes les bulles (allouées) — pratique de test ; le rendu utilise `bubbleAt`. */
export function bubblePositions(
  count: number,
  t: number,
  seed: number,
): Bubble[] {
  const n = count < 0 ? 0 : count > MAX_BUBBLES ? MAX_BUBBLES : count | 0;
  const out: Bubble[] = [];
  for (let i = 0; i < n; i++) {
    out.push(bubbleAt(i, t, seed, { x: 0, y: 0, size: 1, alpha: 1 }));
  }
  return out;
}

/* ── Caustiques ───────────────────────────────────────────────────────── */

export interface Caustic {
  /** Abscisse normalisée [0, 1). */
  x: number;
  /** Ordonnée normalisée [0, 1]. */
  y: number;
  /** Scintillement : 0 (éteint) à 1 (éclat). */
  level: number;
}

/**
 * Tache de caustique n° `i` : dérive lente + scintillement tiré d'un
 * bruit de valeur seedé. Écrit dans `out`.
 */
export function causticSpotAt(
  i: number,
  t: number,
  seed: number,
  out: Caustic,
): Caustic {
  const k = seed ^ Math.imul(i + 1, 0x2545f491);
  const bx = hash01(k);
  const by = hash01(k ^ 0x7feb352d);
  const hp = hash01(k ^ 0x846ca68b) * 6.283185;
  const drift = 0.004 + hash01(k ^ 0x1b873593) * 0.008;

  let x = bx + t * drift + Math.sin(t * 0.23 + hp) * 0.012;
  x -= Math.floor(x);

  let y = by + Math.sin(t * 0.17 + hp * 1.7) * 0.014;
  if (y < 0.02) y = 0.02;
  else if (y > 0.98) y = 0.98;

  // Scintillement : bruit de valeur échantillonné sur une grille fine
  // qui glisse, pour un papillotement irrégulier mais déterministe.
  const level = noise2(x * 9.5 + t * 0.22, y * 9.5 - t * 0.15, seed + i);

  out.x = x;
  out.y = y;
  out.level = level;
  return out;
}

/** Toutes les caustiques (allouées) — pratique de test. */
export function causticSpots(
  count: number,
  t: number,
  seed: number,
): Caustic[] {
  const out: Caustic[] = [];
  for (let i = 0; i < count; i++) {
    out.push(causticSpotAt(i, t, seed, { x: 0, y: 0, level: 0 }));
  }
  return out;
}

/* ── Rayons de lumière ────────────────────────────────────────────────── */

export interface RayBand {
  /** Abscisse au milieu de l'écran, normalisée. */
  offset: number;
  /** Pente : la bande descend en biais vers la droite. */
  slope: number;
  /** Demi-largeur normalisée. */
  width: number;
  /** Vitesse d'oscillation (rad/s). */
  speed: number;
  /** Déphasage. */
  phase: number;
}

/** Trois rais obliques, très doux (alpha ≤ 0.05 côté rendu). */
export const RAY_BANDS: readonly RayBand[] = [
  { offset: 0.16, slope: 0.3, width: 0.055, speed: 0.06, phase: 0 },
  { offset: 0.46, slope: 0.22, width: 0.075, speed: 0.045, phase: 2.1 },
  { offset: 0.74, slope: 0.34, width: 0.045, speed: 0.075, phase: 4.0 },
];

/** Plafond d'opacité d'un rayon (consigne de rendu). */
export const MAX_RAY_ALPHA = 0.05;

/** Abscisse du centre du rai `band` à la hauteur normalisée `y`. */
export function rayCenter(band: RayBand, y: number, t: number): number {
  return (
    band.offset +
    band.slope * (y - 0.45) +
    Math.sin(t * band.speed + band.phase) * 0.02
  );
}

/** Intensité d'un rai en (x, y) : 0 hors bande, 1 au centre. */
export function rayBandIntensity(
  band: RayBand,
  x: number,
  y: number,
  t: number,
): number {
  const d = Math.abs(x - rayCenter(band, y, t)) / band.width;
  if (d >= 1) return 0;
  const k = 1 - d;
  return k * k;
}

/** Intensité cumulée des trois rais (max, pas somme : jamais > 1). */
export function rayIntensity(x: number, y: number, t: number): number {
  let m = 0;
  for (let i = 0; i < RAY_BANDS.length; i++) {
    const v = rayBandIntensity(RAY_BANDS[i], x, y, t);
    if (v > m) m = v;
  }
  return m;
}
