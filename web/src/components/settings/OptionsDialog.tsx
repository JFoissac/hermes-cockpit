import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import ModelPicker, { type ModelRef, type ProviderModels } from "../shell/ModelPicker";
import type { ThemeMode } from "../../lib/theme";

export type { FontChoice as OptionsFontChoice, ModelRef, ProviderModels };
import "./options.css";

export interface FontChoice {
  value: string;
  onChange: (value: string) => void;
  options?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  providers: ProviderModels[];
  model: ModelRef | null;
  onModelChange: (model: ModelRef) => void;
  folder: string;
  onFolderChange: (folder: string) => void;
  recentFolders: string[];
  police?: FontChoice;
}

const SECTIONS = [
  { id: "apparence", label: "Apparence", glyph: "◐" },
  { id: "modele", label: "Modèle", glyph: "◇" },
  { id: "dossier", label: "Dossier de travail", glyph: "▤" },
  { id: "raccourcis", label: "Raccourcis", glyph: "⌨" },
  { id: "apropos", label: "À propos", glyph: "ⓘ" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const THEME_CHOICES: { value: ThemeMode; label: string; glyph: string; hint: string }[] = [
  { value: "light", label: "Clair", glyph: "☀", hint: "Fond papier, encre noire" },
  { value: "dark", label: "Sombre", glyph: "☾", hint: "Fond graphite, encre claire" },
  { value: "system", label: "Système", glyph: "◐", hint: "Suit le réglage de l'OS" },
];

const SHORTCUTS: [string, string][] = [
  ["Entrée", "Envoyer le message"],
  ["Maj + Entrée", "Aller à la ligne sans envoyer"],
  ["Échap", "Fermer le panneau ou la fenêtre"],
  ["↑ / ↓", "Parcourir la liste des modèles"],
  ["Tab", "Passer au champ suivant"],
];

const FONTS = ["Inter", "Système (Segoe UI)", "JetBrains Mono"];

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const nodes = root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
  );
  return [...nodes].filter((el) => el.getAttribute("aria-hidden") !== "true" && el.tabIndex >= 0);
}

/**
 * Modale d'options du cockpit : apparence, modèle, dossier de travail,
 * raccourcis, à propos. Entièrement pilotée par props.
 */
export default function OptionsDialog({
  open,
  onClose,
  theme,
  onThemeChange,
  providers,
  model,
  onModelChange,
  folder,
  onFolderChange,
  recentFolders,
  police,
}: Props) {
  const [section, setSection] = useState<SectionId>("apparence");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
  const previousFocus = useRef<HTMLElement | null>(null);

  const uid = useId();
  const titleId = `${uid}-titre`;
  const panelId = (id: SectionId) => `${uid}-panneau-${id}`;
  const tabId = (id: SectionId) => `${uid}-onglet-${id}`;

  // Focus initial dans la modale + restitution du focus à la fermeture.
  useEffect(() => {
    if (!open) return;
    previousFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    tabRefs.current[section]?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previousFocus.current?.focus?.();
      previousFocus.current = null;
    };
  }, [open]);

  if (!open) return null;

  const currentIndex = SECTIONS.findIndex((s) => s.id === section);

  const moveFocus = (nextIndex: number) => {
    const bounded = (nextIndex + SECTIONS.length) % SECTIONS.length;
    const target = SECTIONS[bounded];
    setSection(target.id);
    tabRefs.current[target.id]?.focus();
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(currentIndex + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(currentIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(SECTIONS.length - 1);
    }
  };

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusables(dialogRef.current);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !dialogRef.current?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0);

  return (
    <div
      className="opt-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="opt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        onKeyDown={onDialogKeyDown}
      >
        <header className="opt-dialog__head">
          <h2 className="opt-dialog__title" id={titleId}>
            Options
          </h2>
          <span className="opt-dialog__sub mono">cockpit local</span>
          <button type="button" className="opt-dialog__close icon-btn" aria-label="Fermer les options" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="opt-dialog__body">
          <div
            className="opt-tabs"
            role="tablist"
            aria-label="Sections des options"
            aria-orientation="vertical"
          >
            {SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={tabId(item.id)}
                aria-selected={section === item.id}
                aria-controls={panelId(item.id)}
                tabIndex={section === item.id ? 0 : -1}
                ref={(node) => {
                  tabRefs.current[item.id] = node;
                }}
                className="opt-tab"
                data-active={section === item.id}
                onClick={() => setSection(item.id)}
                onKeyDown={onTabKeyDown}
              >
                <span className="opt-tab__glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="opt-panels">
            {section === "apparence" && (
              <section className="opt-panel" role="tabpanel" id={panelId("apparence")} aria-labelledby={tabId("apparence")} tabIndex={0}>
                <h3 className="opt-panel__title">Apparence</h3>
                <p className="opt-hint">Le thème s'applique immédiatement à toute la fenêtre.</p>

                <div className="theme-choices" role="radiogroup" aria-label="Thème">
                  {THEME_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={theme === choice.value}
                      className="theme-choice"
                      data-active={theme === choice.value}
                      onClick={() => onThemeChange(choice.value)}
                    >
                      <span className="theme-choice__glyph" aria-hidden="true">
                        {choice.glyph}
                      </span>
                      <span className="theme-choice__label">{choice.label}</span>
                      <span className="theme-choice__hint">{choice.hint}</span>
                    </button>
                  ))}
                </div>

                {police && (
                  <label className="opt-field">
                    <span className="opt-field__label">Police de l'interface</span>
                    <select
                      className="opt-input"
                      value={police.value}
                      onChange={(event) => police.onChange(event.target.value)}
                      aria-label="Police de l'interface"
                    >
                      {(police.options ?? FONTS).map((font) => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>
            )}

            {section === "modele" && (
              <section className="opt-panel" role="tabpanel" id={panelId("modele")} aria-labelledby={tabId("modele")} tabIndex={0}>
                <h3 className="opt-panel__title">Modèle</h3>
                <p className="opt-hint">
                  Le modèle choisi sert aux nouvelles sessions. Les sessions en cours gardent le leur.
                </p>
                <div className="opt-field">
                  <span className="opt-field__label">Modèle par défaut</span>
                  <ModelPicker providers={providers} value={model} onChange={onModelChange} />
                </div>
                <p className="opt-hint mono">
                  {totalModels} modèle{totalModels > 1 ? "s" : ""} · {providers.length} fournisseur
                  {providers.length > 1 ? "s" : ""}
                </p>
              </section>
            )}

            {section === "dossier" && (
              <section className="opt-panel" role="tabpanel" id={panelId("dossier")} aria-labelledby={tabId("dossier")} tabIndex={0}>
                <h3 className="opt-panel__title">Dossier de travail</h3>
                <p className="opt-hint">
                  Répertoire courant des sessions : c'est là que l'agent lit et écrit.
                </p>
                <label className="opt-field">
                  <span className="opt-field__label">Chemin</span>
                  <input
                    className="opt-input mono"
                    type="text"
                    value={folder}
                    onChange={(event) => onFolderChange(event.target.value)}
                    placeholder="C:/Bureau/Dev/mon-projet"
                    aria-label="Dossier de travail"
                    spellCheck={false}
                  />
                </label>
                {recentFolders.length > 0 && (
                  <div className="opt-field">
                    <span className="opt-field__label">Dossiers récents</span>
                    <ul className="opt-recents">
                      {recentFolders.map((recent) => (
                        <li key={recent}>
                          <button
                            type="button"
                            className="opt-recent"
                            data-active={recent === folder}
                            title={recent}
                            onClick={() => onFolderChange(recent)}
                          >
                            <span className="opt-recent__icon" aria-hidden="true">
                              ▤
                            </span>
                            <span className="opt-recent__path mono">{recent}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {section === "raccourcis" && (
              <section className="opt-panel" role="tabpanel" id={panelId("raccourcis")} aria-labelledby={tabId("raccourcis")} tabIndex={0}>
                <h3 className="opt-panel__title">Raccourcis</h3>
                <p className="opt-hint">Lecture seule : les raccourcis sont fixés par le cockpit.</p>
                <table className="opt-keys">
                  <tbody>
                    {SHORTCUTS.map(([keys, description]) => (
                      <tr key={keys}>
                        <th scope="row">
                          <kbd>{keys}</kbd>
                        </th>
                        <td>{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {section === "apropos" && (
              <section className="opt-panel" role="tabpanel" id={panelId("apropos")} aria-labelledby={tabId("apropos")} tabIndex={0}>
                <h3 className="opt-panel__title">À propos</h3>
                <p className="opt-hint">
                  Observatoire local des sessions Hermes et OpenCode. Rien ne sort de la machine.
                </p>
                <dl className="opt-about">
                  <div>
                    <dt>Version</dt>
                    <dd className="mono">v0.1.0</dd>
                  </div>
                  <div>
                    <dt>Base d'état</dt>
                    <dd className="mono">state.db · lecture seule</dd>
                  </div>
                  <div>
                    <dt>API Hermes</dt>
                    <dd className="mono">127.0.0.1:8642</dd>
                  </div>
                  <div>
                    <dt>OpenCode</dt>
                    <dd className="mono">via CLI (opencode)</dd>
                  </div>
                </dl>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
