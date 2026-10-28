import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "./EffortBar.css";

/* ── Niveaux d'effort ────────────────────────────────────────────────────
 * L'ordre du tableau fait foi : il fournit à la fois la valeur ARIA
 * (`aria-valuenow` = index) et le ratio de remplissage (index / dernier).
 */
export interface EffortLevel {
  id: "low" | "medium" | "high" | "xhigh" | "ultra";
  label: string;
  hint: string;
}

export const EFFORT_LEVELS: EffortLevel[] = [
  { id: "low", label: "Rapide", hint: "Une passe, réponse directe." },
  { id: "medium", label: "Standard", hint: "Équilibre vitesse et détail." },
  { id: "high", label: "Approfondi", hint: "Lit le code avant d'écrire." },
  { id: "xhigh", label: "Intense", hint: "Vérifie, teste, recommence." },
  { id: "ultra", label: "Ultra", hint: "Budget max, plusieurs pistes." },
];

const LAST = EFFORT_LEVELS.length - 1;

export interface EffortBarProps {
  value: EffortLevel["id"];
  onChange: (id: EffortLevel["id"]) => void;
  /** Pendant que l'agent travaille : le dégradé s'anime et pulse. */
  busy?: boolean;
  className?: string;
}

/** Index du niveau demandé ; une valeur inconnue retombe sur le premier cran. */
function indexOfLevel(id: EffortLevel["id"]): number {
  const found = EFFORT_LEVELS.findIndex((level) => level.id === id);
  return found === -1 ? 0 : found;
}

/** Ratio 0→1 vers le cran le plus proche (5 crans = 4 intervalles). */
function indexFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  const bounded = Math.min(1, Math.max(0, ratio));
  return Math.round(bounded * LAST);
}

/**
 * Curseur de niveau d'effort du composer. Contrôlé : le parent garde la
 * valeur. Clic et glissement sur la piste, pilotage clavier complet
 * (role="slider"), animation optionnelle pendant le travail de l'agent.
 */
export default function EffortBar({
  value,
  onChange,
  busy = false,
  className,
}: EffortBarProps): JSX.Element {
  const railRef = useRef<HTMLDivElement>(null);
  // Le glissement vit dans une ref : `pointermove` ne doit pas dépendre d'un
  // rendu déjà appliqué, sinon les premiers mouvements sont perdus.
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const index = indexOfLevel(value);
  const level = EFFORT_LEVELS[index];
  const ratio = index / LAST;

  /** Change de cran, sans rien émettre si l'on reste sur place. */
  const commitIndex = useCallback(
    (next: number) => {
      const clamped = Math.min(LAST, Math.max(0, next));
      if (clamped === indexOfLevel(value)) return;
      onChange(EFFORT_LEVELS[clamped].id);
    },
    [onChange, value]
  );

  /** Traduit une abscisse écran en cran. `width` nulle (élément masqué) = no-op. */
  const commitFromClientX = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      if (!rect.width) return;
      commitIndex(indexFromRatio((clientX - rect.left) / rect.width));
    },
    [commitIndex]
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    draggingRef.current = true;
    setDragging(true);
    // jsdom (tests) n'implémente pas la capture, et un pointeur déjà relâché la
    // refuse : un échec de capture ne doit pas casser le glissement.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* sans capture, les pointermove remontent quand même au rail */
    }
    event.currentTarget.focus();
    commitFromClientX(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    // Empêche la sélection de texte / le scroll pendant le glissement.
    event.preventDefault();
    commitFromClientX(event.clientX);
  };

  const endDrag = useCallback((pointerId?: number) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (pointerId !== undefined) {
      try {
        railRef.current?.releasePointerCapture?.(pointerId);
      } catch {
        /* capture déjà perdue : rien à libérer */
      }
    }
  }, []);

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    endDrag(event.pointerId);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        commitIndex(index + 1);
        return;
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        commitIndex(index - 1);
        return;
      case "Home":
        event.preventDefault();
        commitIndex(0);
        return;
      case "End":
        event.preventDefault();
        commitIndex(LAST);
        return;
      default:
        return;
    }
  };

  const classes = ["effort", busy ? "effort--busy" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={{ "--effort-ratio": ratio } as CSSProperties}
      data-busy={busy ? "true" : "false"}
      data-level={level.id}
      aria-busy={busy}
    >
      <div className="effort__meta">
        <span className="effort__eyebrow">Niveau d'effort</span>
        <span className="effort__hint">{level.hint}</span>
      </div>

      <div className="effort__row">
        <span className="effort__label">{level.label}</span>

        <div
          ref={railRef}
          className="effort__rail"
          role="slider"
          tabIndex={0}
          aria-label="Niveau d'effort"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={LAST}
          aria-valuenow={index}
          aria-valuetext={`${level.label} — ${level.hint}`}
          data-dragging={dragging ? "true" : "false"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <div className="effort__track">
            <span className="effort__fill" aria-hidden="true" />
            <span className="effort__thumb" aria-hidden="true" />
          </div>

          <div className="effort__ticks" aria-hidden="true">
            {EFFORT_LEVELS.map((entry, position) => (
              <span
                key={entry.id}
                className="effort__notch"
                data-on={position <= index ? "true" : "false"}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
