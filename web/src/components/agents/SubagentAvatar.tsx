import "./SubagentAvatar.css";

export interface SubagentAvatarProps {
  /** Graine stable : l'id du sous-agent (ou son objectif). Même graine = même avatar. */
  seed: string;
  /** Taille en px. Défaut 22. */
  size?: number;
  /** État du sous-agent : anneau animé quand ça tourne. */
  state?: "running" | "done" | "error";
  /** Libellé accessible (objectif du sous-agent). */
  title?: string;
  className?: string;
}

/** Formes disponibles. L'ordre fait partie du rendu : ne pas le réordonner. */
const SHAPES = ["square", "circle", "squircle"] as const;
type AvatarShape = (typeof SHAPES)[number];

/** Rayon (fraction de la taille) pour les formes non circulaires. */
const SHAPE_RADIUS: Record<Exclude<AvatarShape, "circle">, number> = {
  square: 0.26,
  squircle: 0.38,
};

/** Petite table de symboles géométriques, rendus en texte (aucune image). */
const GLYPHS = ["◆", "◇", "▲", "△", "●", "◐", "▮", "✦"] as const;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * FNV-1a 32 bits, insensible à la casse et aux espaces de bord : « Abc » et
 * « abc » désignent le même sous-agent et donc le même avatar.
 */
function hashSeed(seed: string): number {
  const normalized = seed.normalize("NFC").trim().toLowerCase();
  let hash = FNV_OFFSET;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Hash déterministe exporté pour les tests. */
export function avatarHue(seed: string): { from: number; to: number } {
  const hash = hashSeed(seed);
  const from = hash % 360;
  // Deux teintes voisines : le dégradé reste dans la même famille chromatique.
  const to = (from + 34) % 360;
  return { from, to };
}

/** 1 à 2 initiales tirées du libellé ; chaîne vide si le titre n'a pas de lettre. */
function initialsFrom(title: string | undefined): string {
  if (!title) return "";
  const words = title.match(/[\p{L}\p{N}]+/gu);
  if (!words || words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}

export default function SubagentAvatar({
  seed,
  size = 22,
  state = "done",
  title,
  className,
}: SubagentAvatarProps): JSX.Element {
  const { from, to } = avatarHue(seed);
  const hash = hashSeed(seed);
  // Bits distincts du même hash : forme et glyphe varient indépendamment.
  const shape = SHAPES[(hash >>> 9) % SHAPES.length];
  const glyph = GLYPHS[(hash >>> 17) % GLYPHS.length];

  const label = title?.trim() || "sous-agent";
  const text = initialsFrom(title) || glyph;
  const radius = shape === "circle" ? "50%" : `${Math.round(size * SHAPE_RADIUS[shape])}px`;

  const classes = ["sa-avatar", `sa-avatar--${state}`];
  if (className) classes.push(className);

  return (
    <span
      role="img"
      aria-label={label}
      className={classes.join(" ")}
      data-state={state}
      data-shape={shape}
      data-glyph={text.length}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        // 135° et deux teintes voisines : lisible en thème clair comme sombre.
        backgroundImage: `linear-gradient(135deg, hsl(${from} 68% 56%) 0%, hsl(${to} 72% 42%) 100%)`,
        fontSize: size * 0.45,
      }}
    >
      <span className="sa-avatar__glyph" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
