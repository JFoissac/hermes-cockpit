import { useEffect, useMemo, useRef, useState } from "react";
import MicButton from "../chat/MicButton";
import SlashMenu, { filterSlashItems, type SlashItem } from "../chat/SlashMenu";
import type { Health } from "../../types/api";
import { apiUrl } from "../../lib/base";

interface Props {
  folders: string[];
  health: Health;
  busy: boolean;
  error: string | null;
  onStart: (text: string, folder: string | null) => void;
  onFullView: () => void;
  onOpenOptions: () => void;
}

const FOLDER_KEY = "cockpit.folder";
const RECENTS_KEY = "cockpit.folder.recents";

function loadRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/**
 * Accueil : juste le chat, le choix du dossier et le fond pixel-art.
 * Aucune donnée inventée : les dossiers récents viennent des sessions réelles.
 */
export default function Home({ folders, health, busy, error, onStart, onFullView, onOpenOptions }: Props) {
  const [value, setValue] = useState("");
  const [folder, setFolder] = useState<string | null>(() => localStorage.getItem(FOLDER_KEY));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFolder, setDraftFolder] = useState("");
  const [recents, setRecents] = useState<string[]>(loadRecents);

  useEffect(() => {
    if (folder) localStorage.setItem(FOLDER_KEY, folder);
    else localStorage.removeItem(FOLDER_KEY);
  }, [folder]);

  // Dossiers proposés : ceux mémorisés, puis les cwd réels des sessions.
  const suggestions = useMemo(() => {
    const all = [...recents, ...folders.filter(Boolean)];
    return Array.from(new Set(all)).slice(0, 6);
  }, [recents, folders]);

  const remember = (path: string) => {
    const next = Array.from(new Set([path, ...recents])).slice(0, 8);
    setRecents(next);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  };

  const choose = (path: string) => {
    setFolder(path);
    remember(path);
    setPickerOpen(false);
    setDraftFolder("");
  };

  // Dictée : partiel = remplace la fin, final = ancre le texte.
  const micBaseRef = useRef("");
  const handleTranscript = (text: string, final: boolean) => {
    if (final) {
      micBaseRef.current = micBaseRef.current ? micBaseRef.current + " " + text : text;
      setValue(micBaseRef.current);
    } else {
      setValue(micBaseRef.current ? micBaseRef.current + " " + text : text);
    }
  };

  // ── menu « / » (mêmes commandes et skills que dans le chat) ─────────────
  const [skills, setSkills] = useState<Array<{ name: string }>>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(apiUrl("/api/observatory/skills"), { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSkills(Array.isArray(data) ? data : []))
      .catch(() => {
        /* pas de catalogue : le menu garde les commandes intégrées */
      });
    return () => ctrl.abort();
  }, []);

  const slashQuery =
    !slashOff && value.startsWith("/") && !value.includes("\n") ? value.slice(1) : null;
  const slashItems = useMemo(
    () => (slashQuery === null ? [] : filterSlashItems(skills, slashQuery).slice(0, 40)),
    [slashQuery, skills]
  );

  const pickSlash = (item: SlashItem) => {
    setValue(`/${item.name} `);
    setSlashOff(true);
    setSlashIndex(0);
    inputRef.current?.focus();
  };

  // L'envoi reste possible pendant un tour : Hermes met le message en file.
  const canSend = value.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    onStart(value.trim(), folder);
    setValue("");
    setSlashOff(true);
  };

  const status = (state: string) => (state === "ok" ? "●" : state === "down" ? "○" : "◌");

  return (
    <main className="home">
      <div className="home__actions">
        <button className="home__fullview" onClick={onOpenOptions} title="Options : thème, modèle, dossier">
          <span aria-hidden="true">⚙</span> Options
        </button>
        <button className="home__fullview" onClick={onFullView} title="Vue complète : sessions, agents, aperçu">
          <span aria-hidden="true">▤</span> Vue complète
        </button>
      </div>
      <div className="home__inner">
        <p className="home__eyebrow mono">hermes cockpit · local</p>
        <h1 className="home__headline">Qu'est-ce qu'on construit&nbsp;?</h1>

        <div className="home__folder">
          <button
            className="folder-chip"
            onClick={() => setPickerOpen((o) => !o)}
            aria-expanded={pickerOpen}
            title={folder ?? "Aucun dossier choisi"}
          >
            <span className="folder-chip__icon" aria-hidden="true">▣</span>
            <span className="folder-chip__label mono">{folder ? folder.split(/[\\/]/).filter(Boolean).pop() : "Choisir un dossier"}</span>
            <span className="folder-chip__chev" aria-hidden="true">⌄</span>
          </button>
          {folder && (
            <button className="icon-btn" aria-label="Retirer le dossier" title="Retirer le dossier" onClick={() => setFolder(null)}>
              ×
            </button>
          )}
        </div>

        {pickerOpen && (
          <div className="folder-panel">
            <input
              className="folder-panel__input mono"
              placeholder="C:\Bureau\Dev\mon-projet"
              value={draftFolder}
              onChange={(e) => setDraftFolder(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draftFolder.trim()) choose(draftFolder.trim());
                if (e.key === "Escape") setPickerOpen(false);
              }}
              autoFocus
              spellCheck={false}
            />
            <button className="folder-panel__ok" onClick={() => draftFolder.trim() && choose(draftFolder.trim())} disabled={!draftFolder.trim()}>
              Ouvrir
            </button>
            {suggestions.length > 0 && (
              <ul className="folder-panel__list">
                {suggestions.map((p) => (
                  <li key={p}>
                    <button className="folder-panel__item mono" onClick={() => choose(p)} title={p}>
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && (
          <div className="composer__error" role="alert">
            <strong>Envoi impossible</strong>
            <span className="mono">{error}</span>
          </div>
        )}

        <div className="composer composer--hero">
          {slashItems.length > 0 && (
            <SlashMenu
              items={slashItems}
              active={Math.min(slashIndex, slashItems.length - 1)}
              onPick={pickSlash}
              onHover={setSlashIndex}
            />
          )}
          <textarea
            className="composer__input"
            placeholder="Demande-moi n'importe quoi…"
            value={value}
            ref={inputRef}
            onChange={(e) => {
              setValue(e.target.value);
              setSlashOff(false);
              setSlashIndex(0);
            }}
            onKeyDown={(e) => {
              if (slashItems.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSlashIndex((i) => (i + 1) % slashItems.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashOff(true);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            autoFocus
          />
          <div className="composer__bar">
            <div className="composer__left">
              <button className="icon-btn" title="Joindre un fichier (à venir)" aria-label="Joindre" disabled>
                +
              </button>
            </div>
            <div className="composer__right">
              <span className="composer__hint">/ commandes · Entrée envoyer · Maj+Entrée à la ligne</span>
              <MicButton onTranscript={handleTranscript} />
              <button
                className="icon-btn icon-btn--solid"
                title="Envoyer"
                aria-label="Envoyer"
                onClick={submit}
                disabled={!canSend}
              >
                {busy ? "■" : "↑"}
              </button>
            </div>
          </div>
        </div>

        <p className="home__status mono">
          {status(health.api)} api · {status(health.db)} base · {status(health.opencode)} opencode
        </p>
      </div>
    </main>
  );
}
