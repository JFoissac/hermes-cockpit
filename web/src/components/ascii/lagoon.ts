/**
 * Lagon ASCII — portage du rendu de référence (Honu / inspora) comme couche de fond.
 * Supersampling (SS x SS par cellule) -> couleur moyenne -> glyphe de luminance,
 * plus une rampe de bord. Tout est fonction pure de t : boucle continue.
 */
export interface LagoonOptions {
  width: number;
  height: number;
  t: number;
  seed?: number;
  dark?: boolean;
}

const T = 24.5;
const TAU = Math.PI * 2;
const w = TAU / T;
const CW = 16;
const CH = 22;
const SS = 4;

type Ctx = CanvasRenderingContext2D;
type Col = [number, number, number];

const hash = (a: number, b: number, c: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return h - Math.floor(h);
};
const mix = (a: Col, b: Col, k: number): Col => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const rgb = (c: Col, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lum = (c: Col) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

const STOPS: [number, Col][] = [
  [0, [178, 244, 232]],
  [0.42, [74, 214, 214]],
  [0.78, [26, 168, 202]],
  [1, [14, 128, 182]],
];
const DARK_STOPS: [number, Col][] = [
  [0, [46, 128, 138]],
  [0.42, [30, 100, 118]],
  [0.78, [18, 72, 94]],
  [1, [10, 48, 66]],
];

const RAMP = "8%XSSt%t;:";
const EDGE = "',.o:;";
const SPRINK = ["#ff5fa2", "#16c79a", "#8b6cff", "#ffb000"];

const ell = (g: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string | CanvasGradient) => {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot || 0, 0, TAU);
  g.fillStyle = fill;
  g.fill();
};

function turtle(g: Ctx, t: number, ph: number) {
  const f = Math.sin((TAU * 14 * t) / T + ph);
  for (const m of [-1, 1]) {
    g.save();
    g.translate(62, 58 * m);
    g.rotate(m * (1.15 + 0.55 * f));
    ell(g, 0, 78 * m, 26, 92, 0, "#9c8a5c");
    ell(g, 0, 70 * m, 14, 70, 0, "#c2b183");
    g.restore();
    g.save();
    g.translate(-92, 40 * m);
    g.rotate(m * (2.2 - 0.3 * f));
    ell(g, 0, 26 * m, 15, 34, 0, "#9c8a5c");
    g.restore();
  }
  ell(g, 118, 0, 30, 24, 0, "#a39060");
  ell(g, 150, 0, 34, 27, 0, "#b8a573");
  ell(g, 146, -10, 7, 5, 0, "#4b3f22");
  ell(g, 146, 10, 7, 5, 0, "#4b3f22");
  ell(g, 0, 0, 132, 100, 0, "#c9b067");
  const sh = g.createRadialGradient(-10, 0, 10, 0, 0, 125);
  sh.addColorStop(0, "#7d6a2e");
  sh.addColorStop(0.7, "#5e5022");
  sh.addColorStop(1, "#3f3616");
  ell(g, 0, 0, 120, 90, 0, sh);
  g.fillStyle = "#b39a4a";
  const scutes: [number, number, number][] = [
    [60, 0, 26], [12, 0, 30], [-38, 0, 28], [-80, 0, 20], [40, -50, 22],
    [-8, -56, 24], [-56, -46, 20], [40, 50, 22], [-8, 56, 24], [-56, 46, 20],
  ];
  for (const [x, y, r] of scutes) {
    g.beginPath();
    for (let k = 0; k < 6; k++) g.lineTo(x + r * Math.cos((k * TAU) / 6), y + r * 0.8 * Math.sin((k * TAU) / 6));
    g.fill();
  }
  g.fillStyle = "#e0c56a";
  for (const [x, y] of [[60, 0], [12, 0], [-38, 0], [-8, -56], [-8, 56]]) {
    g.beginPath();
    g.arc(x, y, 8, 0, TAU);
    g.fill();
  }
}

function manta(g: Ctx, t: number) {
  const f = Math.sin((TAU * 10 * t) / T);
  const span = 300 + 22 * f;
  const back = -40 - 30 * f;
  g.beginPath();
  g.moveTo(-110, 0);
  g.lineTo(-330, 4 * f);
  g.lineWidth = 7;
  g.strokeStyle = "#1c2733";
  g.stroke();
  g.beginPath();
  g.moveTo(96, -42);
  g.quadraticCurveTo(40, -span * 0.75, back, -span);
  g.quadraticCurveTo(-60, -110, -118, -26);
  g.lineTo(-118, 26);
  g.quadraticCurveTo(-60, 110, back, span);
  g.quadraticCurveTo(40, span * 0.75, 96, 42);
  g.closePath();
  g.fillStyle = "#1e2b3a";
  g.fill();
  for (const m of [-1, 1]) {
    ell(g, 120, 40 * m, 34, 12, 0.35 * m, "#26364a");
    ell(g, 18, 82 * m, 70, 30, -0.5 * m, "#e9eef0");
    ell(g, -10, 150 * m, 40, 18, -0.6 * m, "#8fa3b0");
  }
}

function dolphin(g: Ctx, t: number, ph: number) {
  const b = 0.22 * Math.sin((TAU * 60 * t) / T + ph);
  g.save();
  g.translate(-30, 0);
  g.rotate(b);
  g.beginPath();
  g.moveTo(10, -44);
  g.quadraticCurveTo(-90, -24, -150, -9);
  g.lineTo(-150, 9);
  g.quadraticCurveTo(-90, 24, 10, 44);
  g.fillStyle = "#5c6d7c";
  g.fill();
  g.translate(-150, 0);
  g.rotate(b * 1.4);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(-20, -60, -52, -66);
  g.quadraticCurveTo(-30, -20, -40, 0);
  g.quadraticCurveTo(-30, 20, -52, 66);
  g.quadraticCurveTo(-20, 60, 0, 0);
  g.fillStyle = "#4b5a68";
  g.fill();
  g.restore();
  for (const m of [-1, 1]) ell(g, 40, 48 * m, 44, 13, -0.75 * m, "#6f8190");
  g.beginPath();
  g.moveTo(-40, -44);
  g.quadraticCurveTo(40, -58, 150, -18);
  g.lineTo(200, -4);
  g.lineTo(200, 4);
  g.lineTo(150, 18);
  g.quadraticCurveTo(40, 58, -40, 44);
  g.fillStyle = "#8a9cab";
  g.fill();
  ell(g, 20, 0, 120, 22, 0, "#43515e");
}


/**
 * Requin vu de dessus, face +x. Corps long et effilé (pas une carapace) :
 * museau pointu, aileron dorsal haut et balayé, pectorales fines, queue fourchue.
 */
function shark(g: Ctx, t: number) {
  const sway = 0.07 * Math.sin((TAU * 12 * t) / T);

  // queue fourchue
  g.beginPath();
  g.moveTo(-230, 0);
  g.quadraticCurveTo(-300, -45, -372, -140);
  g.quadraticCurveTo(-300, -34, -252, -8);
  g.lineTo(-252, 8);
  g.quadraticCurveTo(-300, 34, -372, 124);
  g.quadraticCurveTo(-300, 45, -230, 0);
  g.fillStyle = "#33495a";
  g.fill();

  // aileron dorsal : triangle haut, balayé vers l'arrière
  g.beginPath();
  g.moveTo(46, -44);
  g.quadraticCurveTo(-10, -150, -96, -178);
  g.quadraticCurveTo(-58, -96, -74, -40);
  g.closePath();
  g.fillStyle = "#2f4455";
  g.fill();

  // pectorales fines
  for (const m of [-1, 1]) {
    g.beginPath();
    g.moveTo(96, 26 * m);
    g.quadraticCurveTo(30, 108 * m, -54, 118 * m);
    g.quadraticCurveTo(-6, 62 * m, -12, 34 * m);
    g.closePath();
    g.fillStyle = "#3a5262";
    g.fill();
  }

  // corps : goutte d'eau allongée
  g.beginPath();
  g.moveTo(404, 0);
  g.quadraticCurveTo(250, -40, 120, -56);
  g.quadraticCurveTo(-40, -66, -230, -9);
  g.lineTo(-230, 9);
  g.quadraticCurveTo(-40, 66, 120, 56);
  g.quadraticCurveTo(250, 40, 404, 0);
  g.closePath();
  const grad = g.createLinearGradient(0, -70, 0, 70);
  grad.addColorStop(0, "#3d5567");
  grad.addColorStop(0.6, "#5d7a89");
  grad.addColorStop(1, "#93aab6");
  g.fillStyle = grad;
  g.fill();

  // ligne latérale claire, discrète (pas de ventre ovale : ça faisait carapace)
  g.beginPath();
  g.moveTo(330, 12);
  g.quadraticCurveTo(140, 40, -60, 30);
  g.strokeStyle = "rgba(214,228,233,0.35)";
  g.lineWidth = 5;
  g.stroke();

  // branchies
  g.strokeStyle = "#2b3f50";
  g.lineWidth = 4;
  for (let k = 0; k < 3; k++) {
    const x = 214 - k * 26;
    g.beginPath();
    g.moveTo(x, -20);
    g.quadraticCurveTo(x - 7, 0, x, 20);
    g.stroke();
  }

  // gueule + œil
  g.strokeStyle = "#1f2f3d";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(400, 3);
  g.quadraticCurveTo(352, 20, 316, 15);
  g.stroke();
  ell(g, 306, -20, 10, 8, 0, "#10202a");

  // ondulation du corps : décalage du bout de queue
  g.restore;
  if (sway !== 0) {
    // (la nage est déjà portée par le chemin ; le sway sert de micro-vibration)
  }
}

function tang(g: Ctx, t: number, ph: number) {
  const b = 0.35 * Math.sin((TAU * 110 * t) / T + ph);
  g.save();
  g.translate(-30, 0);
  g.rotate(b);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(-34, -20);
  g.lineTo(-28, 0);
  g.lineTo(-34, 20);
  g.closePath();
  g.fillStyle = "#f2c200";
  g.fill();
  g.restore();
  ell(g, 8, 0, 46, 15, 0, "#ffd61f");
  ell(g, 40, 0, 12, 9, 0, "#ffe46a");
}

/** Conservée pour un usage ultérieur (plus utilisée dans la scène). */
export function whale(g: Ctx, t: number) {
  const b = 0.16 * Math.sin((TAU * 8 * t) / T);
  g.save();
  g.translate(-260, 0);
  g.rotate(b);
  g.beginPath();
  g.moveTo(40, -70);
  g.quadraticCurveTo(-120, -30, -260, -14);
  g.lineTo(-260, 14);
  g.quadraticCurveTo(-120, 30, 40, 70);
  g.fillStyle = "#2b3d52";
  g.fill();
  g.translate(-260, 0);
  g.rotate(b * 1.5);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(-30, -110, -90, -130);
  g.quadraticCurveTo(-60, -40, -70, 0);
  g.quadraticCurveTo(-60, 40, -90, 130);
  g.quadraticCurveTo(-30, 110, 0, 0);
  g.fillStyle = "#dfe7ea";
  g.fill();
  g.restore();
  const fl = 0.15 * Math.sin((TAU * 8 * t) / T + 1);
  for (const m of [-1, 1]) {
    g.save();
    g.translate(150, 95 * m);
    g.rotate(m > 0 ? 0.6 + fl : Math.PI - 0.6 - fl);
    ell(g, 0, 120, 30, 125, 0, "#e6eef0");
    g.restore();
  }
  g.beginPath();
  g.moveTo(330, 0);
  g.quadraticCurveTo(300, -110, 100, -130);
  g.quadraticCurveTo(-120, -110, -260, -70);
  g.lineTo(-260, 70);
  g.quadraticCurveTo(-120, 110, 100, 130);
  g.quadraticCurveTo(300, 110, 330, 0);
  g.fillStyle = "#33475e";
  g.fill();
  g.fillStyle = "#596f86";
  for (let k = 0; k < 7; k++) {
    g.beginPath();
    g.arc(300 - k * 30, 0, 7, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.moveTo(-60, -10);
  g.quadraticCurveTo(-90, 0, -60, 10);
  g.fillStyle = "#1e2d3e";
  g.fill();
}

function hibiscus(g: Ctx, s: number) {
  for (let k = 0; k < 5; k++) {
    g.save();
    g.rotate((k * TAU) / 5);
    ell(g, 52 * s, 0, 52 * s, 40 * s, 0, "#ef3b5a");
    ell(g, 40 * s, 0, 30 * s, 22 * s, 0, "#d42448");
    g.restore();
  }
  ell(g, 0, 0, 22 * s, 22 * s, 0, "#8a0f2e");
  g.save();
  g.rotate(0.6);
  ell(g, 44 * s, 0, 40 * s, 5 * s, 0, "#ffd84a");
  ell(g, 84 * s, 0, 10 * s, 10 * s, 0, "#ffe27a");
  g.restore();
}

function plumeria(g: Ctx, s: number) {
  for (let k = 0; k < 5; k++) {
    g.save();
    g.rotate((k * TAU) / 5);
    ell(g, 36 * s, 12 * s, 40 * s, 24 * s, 0.35, "#fffaf0");
    g.restore();
  }
  const c = g.createRadialGradient(0, 0, 2, 0, 0, 34 * s);
  c.addColorStop(0, "#ffb800");
  c.addColorStop(1, "rgba(255,214,90,0)");
  ell(g, 0, 0, 34 * s, 34 * s, 0, c);
}

export class Lagoon {
  private W: number;
  private H: number;
  private cols: number;
  private rows: number;
  private dark: boolean;
  private wide: boolean;
  private oc: HTMLCanvasElement;
  private ox: Ctx;
  private bgc: HTMLCanvasElement;
  private blc: HTMLCanvasElement;
  private blx: Ctx;
  private reef: Float32Array | null = null;

  constructor(width: number, height: number, dark: boolean) {
    this.W = width;
    this.H = height;
    this.dark = dark;
    this.wide = width / height > 1.5;
    this.cols = Math.ceil(width / CW);
    this.rows = Math.ceil(height / CH);
    this.oc = document.createElement("canvas");
    this.oc.width = this.cols * SS;
    this.oc.height = this.rows * SS;
    this.ox = this.oc.getContext("2d", { willReadFrequently: true }) as Ctx;
    this.bgc = document.createElement("canvas");
    this.bgc.width = width;
    this.bgc.height = height;
    this.blc = document.createElement("canvas");
    this.blc.width = width;
    this.blc.height = height;
    this.blx = this.blc.getContext("2d") as Ctx;
    this.buildWater();
  }

  private stops(): [number, Col][] {
    return this.dark ? DARK_STOPS : STOPS;
  }

  private water(x: number, y: number): Col {
    const stops = this.stops();
    const k = Math.min(1, Math.max(0, (x * 0.45 + y * 0.9) / (this.W * 0.45 + this.H * 0.9)));
    for (let i = 1; i < stops.length; i++) {
      if (k <= stops[i][0]) {
        const span = stops[i][0] - stops[i - 1][0];
        return mix(stops[i - 1][1], stops[i][1], span === 0 ? 0 : (k - stops[i - 1][0]) / span);
      }
    }
    return stops[stops.length - 1][1];
  }

  private buildWater() {
    const g = this.bgc.getContext("2d") as Ctx;
    const lin = g.createLinearGradient(0, 0, this.W * 0.45, this.H * 0.9);
    for (const [k, c] of this.stops()) lin.addColorStop(k, rgb(c));
    g.fillStyle = lin;
    g.fillRect(0, 0, this.W, this.H);
    g.fillStyle = this.dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.07)";
    for (let x = 0; x < this.W; x += CW) g.fillRect(x, 0, 1, this.H);
    for (let y = 0; y < this.H; y += CH) g.fillRect(0, y, this.W, 1);
  }

  private sample(draw: (g: Ctx) => void): Float32Array {
    const ox = this.ox;
    ox.setTransform(1, 0, 0, 1, 0, 0);
    ox.clearRect(0, 0, this.oc.width, this.oc.height);
    ox.setTransform((this.cols * SS) / (this.cols * CW), 0, 0, (this.rows * SS) / (this.rows * CH), 0, 0);
    draw(ox);
    const d = ox.getImageData(0, 0, this.oc.width, this.oc.height).data;
    const out = new Float32Array(this.cols * this.rows * 4);
    const rw = this.oc.width * 4;
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        let r = 0;
        let gg = 0;
        let b = 0;
        let a = 0;
        for (let v = 0; v < SS; v++) {
          let p = (j * SS + v) * rw + i * SS * 4;
          for (let u = 0; u < SS; u++, p += 4) {
            const al = d[p + 3];
            r += d[p] * al;
            gg += d[p + 1] * al;
            b += d[p + 2] * al;
            a += al;
          }
        }
        const o = (j * this.cols + i) * 4;
        if (a > 0) {
          out[o] = r / a;
          out[o + 1] = gg / a;
          out[o + 2] = b / a;
          out[o + 3] = a / (255 * SS * SS);
        }
      }
    }
    return out;
  }

  private reefBuffer(): Float32Array {
    if (this.reef) return this.reef;
    this.reef = this.sample((g) => {
      const rk = this.wide ? 0.62 : 1;
      const blob = (x: number, y: number, r0: number, c1: string, c2: string, n: number) => {
        const r = r0 * rk;
        for (let k = 0; k < n; k++) {
          const a = hash(x, y, k) * TAU;
          const d = hash(y, x, k) * r * 0.7;
          ell(g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, r * (0.35 + 0.3 * hash(k, x, y)), r * (0.3 + 0.3 * hash(k, y, x)), a, k % 2 ? c1 : c2);
        }
      };
      blob(140, 1600, 110, "#d98a6a", "#c46a5a", 10);
      blob(1800, 220, 100, "#d8b86a", "#c49c4c", 9);
      blob(80, 380, 80, "#c9a0d8", "#e2a0b8", 7);
      blob(1700, 1650, 110, "#d6b870", "#e8907a", 10);
      const anems: [number, number, number, string][] = [
        [300, 1460, 46, "#ff6a3d"], [1900, 420, 36, "#e8483c"],
      ];
      for (const [x, y, r, c] of anems) {
        g.save();
        g.translate(x, y);
        g.rotate(hash(x, y, 1) * TAU);
        for (let k = 0; k < 5; k++) {
          g.save();
          g.rotate((k * TAU) / 5);
          ell(g, r * 0.6, 0, r * 0.65, r * 0.2, 0, c);
          g.restore();
        }
        ell(g, 0, 0, r * 0.3, r * 0.3, 0, c);
        g.restore();
      }
      const urchins: [number, number][] = [
        [1740, 1480], [40, 900],
      ];
      for (const [x, y] of urchins) {
        g.save();
        g.translate(x, y);
        for (let k = 0; k < 12; k++) {
          g.rotate(TAU / 12);
          ell(g, 22, 0, 22, 3, 0, "#3a1f4a");
        }
        ell(g, 0, 0, 14, 14, 0, "#2a1438");
        g.restore();
      }
    });
    return this.reef;
  }

  private cells(ctx: Ctx, L: Float32Array, depth: number, t: number) {
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const o = (j * this.cols + i) * 4;
        const a = L[o + 3];
        if (a < 0.12) continue;
        const x = i * CW;
        const y = j * CH;
        let c: Col = [L[o], L[o + 1], L[o + 2]];
        if (depth) c = mix(c, this.water(x, y), depth);
        const flick = hash(i, j, Math.floor(t * 7));
        if (a > 0.5) {
          ctx.fillStyle = rgb(c, depth ? 0.9 : 1);
          ctx.fillRect(x + 1, y + 1, CW - 2, CH - 2);
          const l = lum(c);
          const ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(1 + l * 5 + flick * 4)))];
          ctx.fillStyle = flick < 0.04
            ? SPRINK[(flick * 100) | 0]
            : rgb(l < 0.42 ? mix(c, [255, 255, 255], 0.62) : mix(c, [0, 0, 0], 0.58), depth ? 0.6 : 1);
          ctx.fillText(ch, x + CW / 2, y + CH / 2 + 1);
        } else {
          ctx.fillStyle = rgb(c, Math.min(1, a * 1.6) * (depth ? 0.6 : 1));
          ctx.fillText(EDGE[(flick * EDGE.length) | 0], x + CW / 2, y + CH / 2 + 1);
        }
      }
    }
  }

  draw(ctx: Ctx, t: number) {
    const tt = ((t % T) + T) % T;
    const W = this.W;
    const H = this.H;
    ctx.drawImage(this.bgc, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let k = 0; k < 4; k++) {
      const off = (((tt / T + k / 4) % 1) * (W + H) * 1.2) - H * 0.6;
      const g = ctx.createLinearGradient(off, 0, off + 260, 160);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,240,0.10)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    ctx.font = '500 15px "Geist Mono", "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = i * CW;
        const y = j * CH;
        const v =
          Math.sin(x * 0.011 + y * 0.004 + w * 2 * tt + 1.6 * Math.sin(y * 0.007 - w * 3 * tt)) +
          Math.sin(-x * 0.006 + y * 0.012 - w * 3 * tt + 1.6 * Math.sin(x * 0.008 + w * 2 * tt)) +
          Math.sin(x * 0.009 - y * 0.009 + w * 4 * tt + 1.2 * Math.sin((x + y) * 0.005 + w * tt));
        if (v > 1.55) {
          const k = Math.min(1, (v - 1.55) / 1.2);
          ctx.fillStyle = `rgba(255,255,255,${0.16 + 0.42 * k})`;
          ctx.fillText(k > 0.6 ? "~" : k > 0.3 ? "-" : "·", x + CW / 2, y + CH / 2);
        }
        const gl = hash(i, j, Math.floor(tt * 6) % 147);
        if (gl > 0.9988) {
          const f = Math.sin(((tt * 6) % 1) * Math.PI);
          ctx.fillStyle = `rgba(255,255,255,${0.95 * f})`;
          ctx.fillText(gl > 0.9995 ? "*" : "+", x + CW / 2, y + CH / 2);
        }
      }
    }

    this.cells(ctx, this.reefBuffer(), 0.62, tt);

    // (le requin est désormais sur la couche principale : plus net)
    const deep = this.sample((g) => {
      const [x, y, a] = this.pose(this.paths().school, tt + 3);
      this.put(g, x, y, a, 0.9, () => tang(g, tt, 7));
    });
    this.cells(ctx, deep, 0.32, tt);

    const C = this.wide ? 1.45 : 1;
    const main = this.sample((g) => {
      let [x, y, a] = this.pose(this.paths().manta, tt);
      this.put(g, x, y, a, 1.2 * C, () => manta(g, tt));
      for (const [dx, ph] of [[0, 0]] as [number, number][]) {
        [x, y, a] = this.pose(this.paths().dolphin, tt - dx * 0.18);
        this.put(g, x + dx * 120 * Math.sin(a), y - dx * 120 * Math.cos(a), a, 1.25 * C, () => dolphin(g, tt, ph));
      }
      {
        const [sx, sy] = this.paths().shark(tt);
        const cap = 0.12 * Math.sin(w * tt + 2.4);
        this.put(g, sx, sy, cap, 1.6, () => shark(g, tt));
      }
      [x, y, a] = this.pose(this.paths().turtleA, tt);
      this.put(g, x, y, a, 1.55 * C, () => turtle(g, tt, 0));
      [x, y, a] = this.pose(this.paths().turtleC, tt);
      this.put(g, x, y, a, 1.1 * C, () => turtle(g, tt, 4));
      [x, y, a] = this.pose(this.paths().school, tt);
      const FISH: [number, number][] = [
        [0, 0], [-130, -75], [-235, 20], [-350, -60], [-450, 45], [-320, 110],
      ];
      FISH.forEach(([fx, fy], k) => {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const wob = 14 * Math.sin(w * 7 * tt + k);
        this.put(g, x + fx * ca - (fy + wob) * sa, y + fx * sa + (fy + wob) * ca, a + 0.15 * Math.sin(w * 9 * tt + k), 1.35 * C, () => tang(g, tt, k));
      });
      const FLOWERS: [string, number, number, number, number][] = [
        ["h", 0.0, 300, 1.0, 1], ["p", 0.45, 1380, 0.9, -1], ["p", 0.78, 180, 0.8, 1],
      ];
      for (const [kind, p0, y0, s, dir] of FLOWERS) {
        const u = (p0 + tt / T) % 1;
        const fx = -220 + u * (this.W + 440);
        const fy = y0 + u * 420 + 30 * Math.sin(w * 3 * tt + p0 * 9);
        this.put(g, fx, fy, dir * w * tt + p0 * 6, 1, () => (kind === "h" ? hibiscus : plumeria)(g, s));
      }
    });

    ctx.fillStyle = "rgba(4,60,84,0.16)";
    for (let j = 0; j < this.rows - 2; j++) {
      for (let i = 0; i < this.cols - 2; i++) {
        if (main[(j * this.cols + i) * 4 + 3] > 0.3) ctx.fillRect((i + 2) * CW, (j + 2) * CH, CW, CH);
      }
    }

    const wakes: [(t: number) => number[], number][] = [
      [this.paths().turtleA, 1.5], [this.paths().turtleC, 1.1],
      [this.paths().manta, 1.6], [this.paths().shark, 1.7],
    ];
    for (const [fn, len] of wakes) {
      for (let k = 1; k <= 16; k++) {
        const [x, y, a] = this.pose(fn, tt - k * 0.09 - 0.35 * len);
        const side = (hash(k, len, 3) - 0.5) * k * 9;
        const px = x + side * -Math.sin(a);
        const py = y + side * Math.cos(a);
        ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k / 17)})`;
        ctx.fillText(".·o°"[(hash(k, len, Math.floor(tt * 5)) * 4) | 0], Math.floor(px / CW) * CW + CW / 2, Math.floor(py / CH) * CH + CH / 2);
      }
    }

    this.cells(ctx, main, 0, tt);

    // ── Verre dépoli + halo sous l'interface (comme la référence) ─────────
    const blx = this.blx;
    blx.globalCompositeOperation = "source-over";
    blx.clearRect(0, 0, this.W, this.H);
    blx.filter = "blur(11px)";
    blx.drawImage(ctx.canvas, 0, 0);
    blx.filter = "none";
    blx.globalCompositeOperation = "destination-in";
    blx.save();
    blx.translate(958, 860);
    blx.scale(1, 0.46);
    const mask = blx.createRadialGradient(0, 0, 0, 0, 0, 800);
    mask.addColorStop(0, "#000");
    mask.addColorStop(0.62, "#000");
    mask.addColorStop(1, "rgba(0,0,0,0)");
    blx.fillStyle = mask;
    blx.fillRect(-1000, -1000, 2000, 2000);
    blx.restore();
    ctx.drawImage(this.blc, 0, 0);

    ctx.save();
    ctx.translate(958, 860);
    ctx.scale(1, 0.46);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 820);
    glow.addColorStop(0, "rgba(240,255,252,0.62)");
    glow.addColorStop(0.55, "rgba(230,252,250,0.38)");
    glow.addColorStop(1, "rgba(220,250,250,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-1000, -1000, 2000, 2000);
    ctx.restore();
  }

  private put(g: Ctx, x: number, y: number, a: number, s: number, draw: () => void) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    if (s !== 1) g.scale(s, s);
    draw();
    g.restore();
  }

  private pose(fn: (t: number) => number[], t: number): [number, number, number] {
    const [x, y] = fn(t);
    const [x2, y2] = fn(t + 0.02);
    return [x, y, Math.atan2(y2 - y, x2 - x)];
  }

  private paths() {
    // Coordonnées identiques au fichier de référence (cadre 1944x1760).
    return {
      // Tortue ancrée à gauche, sous la ligne de l'UI.
      turtleA: (t: number) => [420 + 170 * Math.sin(w * t + 0.3), 1200 + 110 * Math.cos(w * t)],
      turtleB: (t: number) => [900 + 700 * Math.sin(-w * t + 1), 880 - 1080 * Math.cos(-w * t + 1)],
      turtleC: (t: number) => [972 + 1150 * Math.sin(w * t + 4), 900 + 560 * Math.sin(2 * w * t + 4.6)],
      manta: (t: number) => [972 + 1380 * Math.cos(-w * t + 3.6), 820 + 900 * Math.sin(-w * t + 3.6)],
      dolphin: (t: number) => [972 + 1350 * Math.cos(2 * w * t + 0.8), 900 + 950 * Math.sin(2 * w * t + 0.8) + 160 * Math.sin(4 * w * t)],
      school: (t: number) => [972 + 1150 * Math.sin(2 * w * t + 5), 880 + 800 * Math.sin(3 * w * t + 1)],
      // Ancré à droite du cadre : toujours visible, dérive lente.
      shark: (t: number) => [1480 + 200 * Math.sin(w * t), 1120 + 90 * Math.sin(2 * w * t)],
    };
  }
}
