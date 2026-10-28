/**
 * Scène sous-marine pixel-ASCII : dégradé d'eau, rayons, plancton, petits
 * poissons jaunes, bulles, et le requin en fondu derrière l'UI.
 * Aucune allocation dans la boucle interne.
 */
import { bubbles, marinePalette, sharkAt, waveY, type MarinePalette } from "./marine";

export interface MarineOptions {
  cols: number;
  rows: number;
  cell: number;
  t: number;
  seed: number;
  bg?: string;
  palette?: MarinePalette;
  veil?: number;
}

function hash01(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const FULL = "▓";
const MID = "▒";
const LIGHT = "░";
const RIM = "▓";
const EYE = "●";
const GILL = "|";

export function drawMarineFrame(ctx: CanvasRenderingContext2D, o: MarineOptions): void {
  const cols = o.cols | 0;
  const rows = o.rows | 0;
  if (cols < 4 || rows < 4) return;

  const cell = o.cell > 0 ? o.cell : 10;
  const t = Number.isFinite(o.t) ? o.t : 0;
  const seed = o.seed | 0;
  const pal = o.palette ?? marinePalette();
  const veil = o.veil ?? 0.34;
  const w = cols * cell;
  const h = rows * cell;

  // ── 1. Dégradé d'eau (6 bandes, aucun coût par cellule) ────────────────
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Le dégradé d'eau est peint par le CSS (.ascii-layer) : plus de bandes.
    ctx.clearRect(0, 0, w, h);
  }

  ctx.font = `${Math.max(7, Math.round(cell * 0.98))}px "JetBrains Mono", "Cascadia Mono", ui-monospace, monospace`;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  const half = cell * 0.5;
  const pad = Math.max(0.5, cell * 0.04);

  const cx = cols * 0.70;
  const cy = rows * 0.46;
  const unit = Math.min((cols * 0.86) / 1.7, (rows * 0.82) / 1.45);

  const phase = (t * Math.PI * 2) / 18;
  const travel = Math.sin(phase) * cols * 0.05;
  const bob = Math.sin(phase * 2.3) * rows * 0.012;
  const roll = Math.sin(phase + 0.7) * 0.05;

  // ── 2. Rayons de lumière obliques ──────────────────────────────────────
  ctx.fillStyle = pal.ray;
  for (let r = 0; r < 3; r++) {
    for (let y = 0; y < rows * 0.8; y++) {
      const base = ((y * 1.1 + r * 17 + t * 1.2) % cols + cols) % cols;
      for (let k = 0; k < 5; k++) {
        ctx.globalAlpha = 0.10 - k * 0.03;
        const x = Math.round(base + k);
        if (x < 0 || x >= cols) continue;
        ctx.fillText("|", x * cell + half, y * cell + pad);
      }
    }
  }

  // ── 3. Plancton / poussière ────────────────────────────────────────────
  ctx.fillStyle = pal.ray;
  for (let i = 0; i < 28; i++) {
    const hx = hash01(seed + i * 2654435761);
    const hy = hash01(seed + i * 40503 + 13);
    const x = Math.floor(((hx + t * 0.004) % 1) * cols);
    const y = Math.floor((0.12 + hy * 0.85) * rows);
    ctx.globalAlpha = 0.06 + hash01(seed + i) * 0.06;
    ctx.fillText("·", x * cell + half, y * cell + pad);
  }

  // ── 4. Petits poissons jaunes (deux bancs qui nagent) ────────────
  const schools = [
    { y: 0.22, speed: 0.020, dir: 1, size: 6, phase: 0 },
    { y: 0.74, speed: 0.014, dir: -1, size: 4, phase: 2.1 },
  ];
  for (let sIdx = 0; sIdx < schools.length; sIdx++) {
    const school = schools[sIdx];
    const span = cols + 16;
    for (let k = 0; k < school.size; k++) {
      const offset = k * 2.4;
      const raw = (school.dir * t * school.speed * cols + offset + sIdx * 31) % span;
      const fx = Math.floor((raw + span) % span) - 8;
      const fy = Math.round(
        (school.y + Math.sin(t * 0.5 + k * 0.35 + school.phase) * 0.03) * rows +
          Math.sin(t * 0.7 + k) * 0.4,
      );
      if (fy < 1 || fy >= rows - 1) continue;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = k % 3 === 0 ? pal.fishAlt : pal.fish;
      const sprite = school.dir > 0 ? [">", "o", ">"] : ["<", "o", "<"];
      for (let c = 0; c < 3; c++) {
        const x = fx + c;
        if (x < 0 || x >= cols) continue;
        ctx.fillText(sprite[c], x * cell + half, fy * cell + pad);
      }
      ctx.globalAlpha = 0.3;
      const tailX = school.dir > 0 ? fx - 1 : fx + 3;
      if (tailX >= 0 && tailX < cols) ctx.fillText("~", tailX * cell + half, fy * cell + pad);
    }
  }
  ctx.globalAlpha = 1;

  // ── 5. Surface : deux houles claires en haut ───────────────────────────
  for (let band = 0; band < 2; band++) {
    ctx.fillStyle = pal.crest;
    ctx.globalAlpha = 0.22 + band * 0.06;
    for (let x = 0; x < cols; x++) {
      const yr = Math.round(waveY(x / cols, t, band) * rows * 0.18);
      if (yr < 0 || yr >= rows) continue;
      ctx.fillText((x + band) % 3 === 0 ? "≈" : "~", x * cell + half, yr * cell + pad);
    }
  }

  // ── 6. Bulles ──────────────────────────────────────────────────────────
  const bs = bubbles(24, t, seed);
  ctx.fillStyle = pal.bubble;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    const x = Math.floor(b.x * cols);
    const y = Math.floor((0.10 + b.y * 0.86) * rows);
    if (y < 0 || y >= rows) continue;
    ctx.globalAlpha = 0.34 + (b.size === 2 ? 0.12 : 0);
    ctx.fillText(b.size === 2 ? "o" : "°", x * cell + half, y * cell + pad);
  }
  ctx.globalAlpha = 1;

  // ── 7. Requin, en fondu derrière l'UI ──────────────────────────────────
  const sharkAlpha = 0.40;
  for (let y = 0; y < rows; y++) {
    const vy = (y - cy - bob) / unit;
    for (let x = 0; x < cols; x++) {
      const ux = (x - cx - travel) / unit;
      const u = ux + roll * vy;
      const v = vy - roll * ux;
      const s = sharkAt(u, v);
      if (s.part === "none") continue;

      const rim = Math.abs(s.depth) > 0.82;
      let glyph: string;
      let color: string;

      if (s.part === "eye") {
        glyph = EYE;
        color = pal.eye;
      } else if (s.part === "gill") {
        glyph = GILL;
        color = pal.rim;
      } else if (rim) {
        glyph = RIM;
        color = pal.rim;
      } else {
        const d = Math.abs(s.depth);
        glyph = d < 0.40 ? FULL : d < 0.75 ? MID : LIGHT;
        if (s.part === "body") {
          color = s.depth < -0.15 ? pal.back : s.depth > 0.42 ? pal.belly : pal.mid;
        } else {
          color = pal.back;
        }
      }

      const nx = (x - cx) / (cols * 0.5);
      const ny = (y - cy) / (rows * 0.5);
      const veilK = 1 - veil * Math.exp(-(nx * nx + ny * ny) * 1.7);

      ctx.globalAlpha = (rim || s.part === "eye" ? sharkAlpha + 0.12 : sharkAlpha) * veilK;
      ctx.fillStyle = color;
      ctx.fillText(glyph, x * cell + half, y * cell + pad);
    }
  }
  ctx.globalAlpha = 1;
}
