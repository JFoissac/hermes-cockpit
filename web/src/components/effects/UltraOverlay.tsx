import { useEffect, useRef, useState } from "react";
import "./UltraOverlay.css";

/**
 * Overlay « sensation de vitesse » d'Ultracode.
 *
 * Des traînées radiales filent depuis le centre de l'écran, doublées d'un halo,
 * d'une vignette et d'un scanline qui pulse (CSS). Purement décoratif :
 * `pointer-events: none`, `aria-hidden`, aucun nœud quand `active` est faux.
 *
 * Rendu canvas 2D : les particules vivent dans des tableaux typés alloués une
 * seule fois, les directions sont précalculées (aucune trigonométrie par frame)
 * et les styles sont des chaînes précalculées indexées par teinte × opacité.
 * Zéro allocation dans la boucle.
 */
export interface UltraOverlayProps {
  active: boolean;
  /** Texte affiché au centre, ex. « Ultracode · 3 agents ». */
  label?: string;
}

const DEFAULT_LABEL = "Ultracode · 3 agents";

/* ── Réglages du champ de traînées ────────────────────────────────────── */

/** Plafond dur de traînées simultanées (indépendant de la surface). */
const MAX_STREAKS = 220;
/** Plancher : même sur une petite fenêtre, le champ reste dense. */
const MIN_STREAKS = 90;
/** Surface de référence : au-delà, on sature au plafond. */
const REF_AREA = 1440 * 900;

/** Vitesse radiale, en fraction du rayon max par seconde. */
const SPEED_MIN = 0.55;
const SPEED_MAX = 1.75;
/** Longueur de la traînée, en fraction du rayon max. */
const LEN_MIN = 0.02;
const LEN_MAX = 0.12;
/** Épaisseur du trait, en px CSS. */
const WIDTH_MIN = 0.6;
const WIDTH_MAX = 2.2;
/** Zone de réapparition : les traînées renaissent près du centre. */
const SPAWN_MIN = 0.02;
const SPAWN_MAX = 0.2;

/** Teintes bleu / violet / cyan, cohérentes avec le thème du cockpit. */
const TINTS = ["79, 124, 255", "160, 107, 255", "96, 214, 255"];
/** Niveaux d'opacité précalculés : les styles ne sont jamais reconstruits. */
const ALPHA_STEPS = 8;
const ALPHA_MIN = 0.16;
const ALPHA_MAX = 0.92;

/* ── Utilitaires sans allocation ──────────────────────────────────────── */

/** PRNG déterministe : même graine ⇒ même champ de traînées. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

/** Champ de styles RGBA, indexé `teinte * ALPHA_STEPS + palier`. */
function buildStyles(): string[] {
  const styles: string[] = [];
  for (let c = 0; c < TINTS.length; c++) {
    for (let s = 0; s < ALPHA_STEPS; s++) {
      const alpha = ALPHA_MIN + ((ALPHA_MAX - ALPHA_MIN) * s) / (ALPHA_STEPS - 1);
      styles.push(`rgba(${TINTS[c]}, ${alpha.toFixed(3)})`);
    }
  }
  return styles;
}

/* ── Composant ────────────────────────────────────────────────────────── */

export default function UltraOverlay(props: UltraOverlayProps): JSX.Element | null {
  const { active, label } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState<boolean>(prefersReducedMotion);

  // Préférence système : lue au montage puis suivie, pour ne pas relancer
  // l'app quand l'utilisateur l'active en cours de route.
  useEffect(() => {
    if (!active) return;
    const media = reducedMotionQuery();
    if (!media) return;
    setReduced(media.matches);
    const onChange = () => setReduced(media.matches);
    if (typeof media.addEventListener !== "function") return;
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rnd = makeRandom(0x51ed270b);

    // Buffers réutilisés d'une frame à l'autre : la boucle n'alloue rien.
    const dirX = new Float32Array(MAX_STREAKS);
    const dirY = new Float32Array(MAX_STREAKS);
    const radius = new Float32Array(MAX_STREAKS);
    const speed = new Float32Array(MAX_STREAKS);
    const length = new Float32Array(MAX_STREAKS);
    const width = new Float32Array(MAX_STREAKS);
    const tint = new Uint8Array(MAX_STREAKS);
    const shade = new Uint8Array(MAX_STREAKS);
    // Propriétés statiques : direction figée (pas de sin/cos par frame).
    const shadeSpan = ALPHA_STEPS - 2;

    for (let i = 0; i < MAX_STREAKS; i++) {
      const angle = rnd() * Math.PI * 2;
      dirX[i] = Math.cos(angle);
      dirY[i] = Math.sin(angle);
      speed[i] = SPEED_MIN + rnd() * (SPEED_MAX - SPEED_MIN);
      length[i] = LEN_MIN + rnd() * (LEN_MAX - LEN_MIN);
      width[i] = WIDTH_MIN + rnd() * (WIDTH_MAX - WIDTH_MIN);
      tint[i] = (rnd() * TINTS.length) | 0;
      shade[i] = 2 + ((rnd() * shadeSpan) | 0);
    }

    const styles = buildStyles();

    let handle = 0;
    let last = 0;
    let w = 0;
    let h = 0;
    let cx = 0;
    let cy = 0;
    let maxR = 1;
    let count = 0;

    const spawn = (i: number): void => {
      radius[i] = (SPAWN_MIN + rnd() * (SPAWN_MAX - SPAWN_MIN)) * maxR;
    };

    const draw = (): void => {
      ctx.clearRect(0, 0, w, h);
      const fadeIn = 0.14 * maxR;
      const fadeOut = 0.86 * maxR;
      const spanOut = maxR - fadeOut || 1;
      for (let i = 0; i < count; i++) {
        const r = radius[i];
        if (r <= 0) continue;
        // Fondu d'entrée près du centre, fondu de sortie sur le bord.
        let fade = 1;
        if (r < fadeIn) fade = r / fadeIn;
        else if (r > fadeOut) fade = (maxR - r) / spanOut;
        if (fade <= 0) continue;
        const step = (shade[i] * fade) | 0;
        const tail = r - length[i] * maxR;
        const tailR = tail > 0 ? tail : 0;
        const dx = dirX[i];
        const dy = dirY[i];
        ctx.strokeStyle = styles[tint[i] * ALPHA_STEPS + step];
        ctx.lineWidth = width[i];
        ctx.beginPath();
        ctx.moveTo(cx + dx * tailR, cy + dy * tailR);
        ctx.lineTo(cx + dx * r, cy + dy * r);
        ctx.stroke();
      }
    };

    const advance = (dt: number): void => {
      const sec = dt / 1000;
      for (let i = 0; i < count; i++) {
        radius[i] += speed[i] * sec * maxR;
        if (radius[i] > maxR) spawn(i);
      }
    };

    const measure = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // clientWidth/Height : on ignore la barre de défilement et on évite la
      // boucle « le canvas déborde → la page s'élargit → il se réajuste plus large ».
      w = host.clientWidth || window.innerWidth || 1024;
      h = host.clientHeight || window.innerHeight || 768;
      const pixelW = Math.max(1, Math.round(w * dpr));
      const pixelH = Math.max(1, Math.round(h * dpr));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      cx = w / 2;
      cy = h / 2;
      // Math.hypot est lent sur certains moteurs : appelé une fois par resize.
      const diag = Math.sqrt(cx * cx + cy * cy);
      maxR = diag > 0 ? diag * 1.02 : 1;
      count = Math.max(
        MIN_STREAKS,
        Math.min(MAX_STREAKS, Math.round((MAX_STREAKS * w * h) / REF_AREA)),
      );
      // Étale les traînées sur tout le rayon : la première frame est déjà pleine
      // (et la version « mouvement réduit » n'est jamais un écran vide).
      for (let i = 0; i < count; i++) {
        radius[i] = (0.04 + rnd() * 0.96) * maxR;
      }
    };

    const repaint = (): void => {
      measure();
      draw();
    };

    repaint();

    // Redimensionnement : ResizeObserver quand il existe, sinon resize.
    let observer: ResizeObserver | null = null;
    const onResize = (): void => {
      measure();
      if (reduced) draw();
    };
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(onResize);
      observer.observe(host);
    } else {
      window.addEventListener("resize", onResize);
    }

    const dispose = (): void => {
      if (handle) {
        window.cancelAnimationFrame(handle);
        handle = 0;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      window.removeEventListener("resize", onResize);
    };

    // Mouvement réduit : une seule image statique (halo et vignette viennent
    // du CSS), aucune boucle rAF, aucun travail par frame.
    if (reduced) return dispose;

    const frame = (now: number): void => {
      handle = window.requestAnimationFrame(frame);
      const dt = last > 0 ? Math.min(now - last, 48) : 16;
      last = now;
      if (document.hidden) return;
      advance(dt);
      draw();
    };
    handle = window.requestAnimationFrame(frame);

    return dispose;
  }, [active, reduced]);

  if (!active) return null;

  const text = label && label.trim() !== "" ? label : DEFAULT_LABEL;

  return (
    <div
      className="ultra"
      aria-hidden="true"
      ref={hostRef}
      data-reduced={reduced ? "true" : "false"}
    >
      <canvas className="ultra__canvas" ref={canvasRef} />
      <div className="ultra__halo" />
      <div className="ultra__scan" />
      <div className="ultra__vig" />
      <div className="ultra__label">
        <span className="ultra__dot" />
        <span className="ultra__text">{text}</span>
      </div>
    </div>
  );
}
