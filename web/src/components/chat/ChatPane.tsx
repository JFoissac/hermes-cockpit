import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MicButton from "./MicButton";
import SlashMenu, { filterSlashItems, type SlashItem } from "./SlashMenu";
import ModelPicker, { type ModelRef, type ProviderModels } from "../shell/ModelPicker";
import EffortBar, { type EffortLevel } from "./EffortBar";
import type { MessageDelta } from "../../types/api";
import "./chat.css";
import { apiUrl } from "../../lib/base";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string | null;
  /** Thinking du modèle : jamais affiché en clair, il va dans le bloc d'activité. */
  reasoning?: string | null;
  /** Aperçu déjà lisible des arguments de l'outil (prioritaire sur le JSON brut). */
  toolPreview?: string | null;
}

/** Résume un message d'outil en une ligne lisible (jamais le JSON brut). */
export function summarizeTool(content: string, toolName?: string | null): string {
  const name = (toolName ?? "outil").replace(/_/g, " ");
  try {
    const j = JSON.parse(content) as Record<string, unknown>;
    if (typeof j.command === "string") return `${name} · ${String(j.command).slice(0, 90)}`;
    if (typeof j.resolved_path === "string") {
      const size = typeof j.bytes_written === "number" ? ` · ${Math.round(Number(j.bytes_written) / 1024)} Ko` : "";
      const base = String(j.resolved_path).split(/[\\/]/).slice(-2).join("/");
      return `${name} · ${base}${size}`;
    }
    if (typeof j.pattern === "string") return `${name} · ${String(j.pattern).slice(0, 80)}`;
    if (typeof j.error === "string") return `${name} · échec : ${String(j.error).slice(0, 90)}`;
    const first = Object.keys(j)[0];
    if (first) return `${name} · ${first}`;
  } catch {
    /* pas du JSON : on tronque */
  }
  return `${name} · ${content.replace(/\s+/g, " ").slice(0, 100)}`;
}

/** Une ligne du bloc d'activité : « nom · aperçu ». */
export interface ActivityTool {
  id: string;
  label: string;
}

/**
 * Le fil est une suite de nœuds, pas une suite de messages : un tour regroupe
 * les outils et le thinking entre une question et la réponse qui la suit.
 */
export type ThreadNode =
  | { kind: "user"; key: string; text: string }
  | { kind: "activity"; key: string; tools: ActivityTool[]; thinking: string | null }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "system"; key: string; text: string };

/**
 * Les notifications du harnais (fin de tâche de fond, rappels de boucle, prompt
 * système) arrivent en base avec `role = "user"`. Les afficher à droite ferait
 * croire que le porteur les a écrites : on les reconnaît et on les rend à part.
 */
const HARNESS_MARKERS = [
  "[IMPORTANT:",
  "[INTERNAL NOTIFICATION",
  "[OUT-OF-BAND USER MESSAGE",
  "[ASYNC DELEGATION BATCH COMPLETE",
  "[Continuing toward your standing goal]",
  "[System:",
  "[/loop wakeup",
];

export function isHarnessMarker(text: string): boolean {
  const head = text.trimStart();
  return HARNESS_MARKERS.some((marker) => head.startsWith(marker));
}

function toolLabel(message: ChatMessage): string {
  const preview = message.toolPreview?.trim();
  if (!preview) return summarizeTool(message.content, message.toolName);
  const name = (message.toolName ?? "outil").replace(/_/g, " ");
  return `${name} · ${preview}`;
}

/** En-tête du bloc replié : « 7 outils · thinking ». */
export function activitySummary(toolCount: number, hasThinking: boolean): string {
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} ${toolCount > 1 ? "outils" : "outil"}`);
  if (hasThinking) parts.push("thinking");
  return parts.length > 0 ? parts.join(" · ") : "activité";
}

/** Regroupe les messages en bulles et blocs d'activité, dans l'ordre du fil. */
export function buildThread(messages: ChatMessage[]): ThreadNode[] {
  const nodes: ThreadNode[] = [];
  let tools: ActivityTool[] = [];
  let thinking: string[] = [];
  let anchor: string | null = null;

  const pushActivity = (): void => {
    if (!anchor) return;
    nodes.push({
      kind: "activity",
      key: `activity-${anchor}`,
      tools,
      thinking: thinking.length > 0 ? thinking.join("\n\n") : null,
    });
    tools = [];
    thinking = [];
    anchor = null;
  };

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "user") {
      pushActivity();
      const text = message.content.trim();
      if (!text) continue;
      if (isHarnessMarker(text)) {
        nodes.push({ kind: "system", key: `system-${message.id}`, text });
      } else {
        nodes.push({ kind: "user", key: `user-${message.id}`, text });
      }
      continue;
    }

    if (message.role === "tool") {
      anchor ??= message.id;
      tools.push({ id: message.id, label: toolLabel(message) });
      continue;
    }

    const reasoning = message.reasoning?.trim();
    const text = message.content.trim();
    if (reasoning) {
      anchor ??= message.id;
      thinking.push(reasoning);
    }
    if (text) {
      // Le thinking de ce message précède sa réponse : il part dans le bloc.
      pushActivity();
      nodes.push({ kind: "assistant", key: `assistant-${message.id}`, text });
    }
  }
  pushActivity();
  return nodes;
}

export interface ChatPaneProps {
  title: string | null;
  model: string | null;
  folder: string | null;
  messages: ChatMessage[];
  toolCount: number;
  streaming: boolean;
  error: string | null;
  /** La conversation tourne déjà côté Hermes (tour en cours, pas forcément le nôtre). */
  sessionBusy?: boolean;
  /** Information non bloquante affichée au-dessus du champ. */
  notice?: string | null;
  /** Fournisseur / modèle du tour, et effort de raisonnement. */
  providers?: ProviderModels[];
  modelRef?: ModelRef | null;
  onModelChange?: (next: ModelRef) => void;
  effort?: string;
  onEffortChange?: (next: string) => void;
  /** Lance trois agents en parallèle sur la tâche en cours de saisie. */
  onUltracode?: (text: string) => void;
  onSend: (text: string, images?: string[]) => void;
  onStop: () => void;
  /** Présent seulement pour un sous-agent : retour à la conversation parente. */
  onBackToParent?: () => void;
  parentTitle?: string | null;
}

/**
 * Fil de conversation façon messagerie : bulles à droite pour l'utilisateur,
 * à gauche pour l'agent, et tout ce que fait l'agent (outils, thinking) replié
 * dans un bloc dépliable plutôt que déversé en clair.
 */
export default function ChatPane({
  title,
  model,
  folder,
  messages,
  toolCount,
  streaming,
  error,
  sessionBusy = false,
  notice = null,
  providers = [],
  modelRef = null,
  onModelChange,
  effort = "medium",
  onEffortChange,
  onUltracode,
  onSend,
  onStop,
  onBackToParent,
  parentTitle = null,
}: ChatPaneProps): JSX.Element {
  const [value, setValue] = useState("");
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => new Set());
  // Fermetures explicites : un bloc ouvert d'office doit pouvoir être refermé.
  const [closedKeys, setClosedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement | null>(null);

  const nodes = useMemo(() => buildThread(messages), [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [nodes.length, streaming]);

  // Dictée : le partiel remplace la fin du brouillon, le final l'ancre.
  const micBaseRef = useRef("");
  const handleTranscript = useCallback((text: string, final: boolean) => {
    if (final) {
      micBaseRef.current = micBaseRef.current ? micBaseRef.current + " " + text : text;
      setValue(micBaseRef.current);
    } else {
      setValue(micBaseRef.current ? micBaseRef.current + " " + text : text);
    }
  }, []);

  const toggleActivity = useCallback((key: string, isOpen: boolean) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(key);
      else next.add(key);
      return next;
    });
    setClosedKeys((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Envoyer reste possible pendant que l'agent travaille : App met le texte en
  // file et le fait partir à la fin du tour courant.
  // ── images collées ─────────────────────────────────────────────────────
  // L'API Hermes accepte les images en data-URL ; on les garde en mémoire
  // jusqu'à l'envoi et on les affiche en vignettes au-dessus du champ.
  const [images, setImages] = useState<Array<{ name: string; dataUrl: string }>>([]);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? "");
        if (dataUrl) setImages((prev) => [...prev, { name: file.name || "collage.png", dataUrl }].slice(0, 6));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // ── menu « / » ────────────────────────────────────────────────────────
  // Les skills installés sont des commandes slash dynamiques côté Hermes : on
  // les récupère une fois pour les proposer à côté des commandes intégrées.
  const [skills, setSkills] = useState<Array<{ name: string }>>([]);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashOff, setSlashOff] = useState(false);

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

  const pickSlash = useCallback(
    (item: SlashItem) => {
      setValue(`/${item.name} `);
      setSlashOff(true);
      setSlashIndex(0);
      textareaRef.current?.focus();
    },
    []
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = value.trim().length > 0 || images.length > 0;
  const submit = useCallback(() => {
    if (value.trim().length === 0 && images.length === 0) return;
    onSend(value.trim(), images.map((i) => i.dataUrl));
    setValue("");
    setImages([]);
  }, [value, images, onSend]);

  const typingLabel =
    toolCount > 0 ? `Hermes écrit · ${toolCount} outil${toolCount > 1 ? "s" : ""}` : "Hermes écrit";

  return (
    <main className="chat">
      <header className="chat__head">
        {/* Retour à la conversation parente quand on regarde un sous-agent. */}
        {onBackToParent && (
          <button
            className="icon-btn chat__back"
            title={parentTitle ? `Retour à « ${parentTitle} »` : "Retour à la conversation principale"}
            aria-label="Retour à la conversation principale"
            onClick={onBackToParent}
          >
            ←
          </button>
        )}
        <h1 className="chat__title">{title ?? "Nouvelle conversation"}</h1>
        <span className="chat__model">{model ?? "modèle du profil"}</span>
        {folder && (
          <span className="chat__model mono" title={folder}>
            {folder.split(/[\\/]/).filter(Boolean).pop()}
          </span>
        )}
      </header>

      {nodes.length === 0 ? (
        <div className="chat__empty">
          <h2 className="chat__headline">Qu'est-ce qu'on construit&nbsp;?</h2>
          <p className="chat__sub">Hermes · sous-agents · opencode</p>
        </div>
      ) : (
        <div className="messages" ref={listRef}>
          {nodes.map((node) => {
            if (node.kind === "user") {
              return (
                <article key={node.key} className="bubble bubble--right" data-role="user">
                  {node.text}
                </article>
              );
            }
            if (node.kind === "system") {
              return (
                <p key={node.key} className="thread-system" data-role="system">
                  <span className="thread-system__tag">hermes</span> {node.text}
                </p>
              );
            }
            if (node.kind === "assistant") {
              return (
                <article key={node.key} className="bubble bubble--left" data-role="assistant">
                  {node.text}
                </article>
              );
            }

            // Le thinking d'un tour n'arrive pas en direct par cette API : il est
            // écrit en base à la fin du tour. On ouvre donc d'office le bloc de
            // thinking le plus récent, pour qu'il soit visible sans clic.
            const lastThinkingKey = [...nodes]
              .reverse()
              .find((n) => n.kind === "activity" && n.thinking)?.key;
            const autoOpen = (streaming && Boolean(node.thinking)) || node.key === lastThinkingKey;
            const open = !closedKeys.has(node.key) && (autoOpen || openKeys.has(node.key));
            return (
              <div key={node.key} className="activity" data-open={open}>
                <button
                  type="button"
                  className="activity__summary"
                  aria-expanded={open}
                  aria-label={activitySummary(node.tools.length, node.thinking !== null)}
                  onClick={() => toggleActivity(node.key, open)}
                >
                  <span className="activity__chevron" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="activity__label">
                    {activitySummary(node.tools.length, node.thinking !== null)}
                  </span>
                  {!open && node.thinking && (
                    <span className="activity__peek" aria-hidden="true">{node.thinking.replace(/\s+/g, " ").slice(0, 110)}</span>
                  )}
                </button>
                {open && (
                  <div className="activity__body">
                    {node.tools.length > 0 && (
                      <ul className="activity__tools">
                        {node.tools.map((tool) => (
                          <li key={tool.id} className="activity__tool">
                            {tool.label}
                          </li>
                        ))}
                      </ul>
                    )}
                    {node.thinking && <p className="activity__thinking">{node.thinking}</p>}
                  </div>
                )}
              </div>
            );
          })}

          {streaming && (
            <article
              className="bubble bubble--left bubble--typing"
              data-role="assistant"
              role="status"
              aria-label={typingLabel}
            >
              <span className="typing__dots" aria-hidden="true">
                <span className="typing__dot" />
                <span className="typing__dot" />
                <span className="typing__dot" />
              </span>
              {toolCount > 0 && <span className="typing__count">{toolCount} outils</span>}
            </article>
          )}
        </div>
      )}

      {error && (
        <div className="composer__error" role="alert">
          <strong>Envoi impossible</strong>
          <span className="mono">{error}</span>
        </div>
      )}

      <div className="composer">
        {slashItems.length > 0 && (
          <SlashMenu
            items={slashItems}
            active={Math.min(slashIndex, slashItems.length - 1)}
            onPick={pickSlash}
            onHover={setSlashIndex}
          />
        )}
        <textarea
          ref={textareaRef}
          className="composer__input"
          placeholder="Demande-moi n'importe quoi…"
          value={value}
          onPaste={onPaste}
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
          rows={2}
          autoFocus
        />
        {images.length > 0 && (
          <div className="composer__thumbs">
            {images.map((img, i) => (
              <span className="thumb" key={`${img.name}-${i}`}>
                <img src={img.dataUrl} alt={img.name} />
                <button
                  type="button"
                  className="thumb__x"
                  aria-label={`Retirer ${img.name}`}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {(notice || streaming || sessionBusy) && (
          <div className="composer__notices">
            {notice && <span className="composer__hint composer__hint--notice">{notice}</span>}
            {(streaming || sessionBusy) && (
              <span className="composer__hint composer__hint--queue">
                {streaming
                  ? "l'agent travaille · ton message partira à la fin"
                  : "conversation occupée · ton message sera traité à la fin du tour en cours"}
              </span>
            )}
          </div>
        )}
        <div className="composer__bar">
          <div className="composer__left">
            <button className="icon-btn" title="Joindre un fichier (à venir)" aria-label="Joindre" disabled>
              +
            </button>
            <span className="composer__hint">/ commandes · Entrée envoyer · Maj+Entrée à la ligne</span>
          </div>
          <div className="composer__right">
            {(providers.length > 0 || modelRef) && (
              <ModelPicker providers={providers} value={modelRef} onChange={(next) => onModelChange?.(next)} />
            )}
            <EffortBar
              className="composer__effort"
              value={(effort as EffortLevel["id"]) ?? "medium"}
              onChange={(next) => onEffortChange?.(next)}
              busy={streaming}
            />
            <button
              type="button"
              className="icon-btn ultracode"
              title="Ultracode : 3 agents en parallèle sur cette tâche"
              aria-label="Ultracode"
              onClick={() => onUltracode?.(value)}
            >
              ⚡
            </button>
            <MicButton onTranscript={handleTranscript} />
            {streaming ? (
              <button className="icon-btn icon-btn--solid" data-tone="red" title="Arrêter" aria-label="Arrêter" onClick={onStop}>
                ■
              </button>
            ) : (
              <button className="icon-btn icon-btn--solid" title="Envoyer" aria-label="Envoyer" onClick={submit} disabled={!canSend}>
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export type { MessageDelta };
