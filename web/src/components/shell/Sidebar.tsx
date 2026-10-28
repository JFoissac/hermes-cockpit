import { useMemo, useState } from "react";
import type { AgentSession, Health } from "../../types/api";
import { useDismissedSubagents } from "../../lib/dismissed";
import SubagentAvatar from "../agents/SubagentAvatar";

interface Props {
  sessions: AgentSession[];
  activeId: string | null;
  health: Health;
  view: "chat" | "agents";
  onSelect: (id: string) => void;
  onNew: () => void;
  onView: (v: "chat" | "agents") => void;
  /** Retour à l'accueil (le lagon). */
  onHome: () => void;
  /** Ouvre la popup d'options (thème, modèle, dossier). */
  onOpenOptions: () => void;
}

/** Un sous-agent terminé disparaît tout seul 10 min après sa dernière activité. */
const AUTO_HIDE_MS = 10 * 60 * 1000;

const dot = (h: "ok" | "down" | "unknown") => (h === "ok" ? "●" : h === "down" ? "○" : "◌");

const activity = (s: AgentSession) => s.last_activity_at ?? 0;

/** « Fini et ancien » : ne tourne plus et rien fait depuis 10 min. */
function isRetired(session: AgentSession, now: number): boolean {
  if (!session.parent_session_id || session.running) return false;
  const ts = session.last_activity_at;
  if (!ts) return true;
  return now - ts * 1000 > AUTO_HIDE_MS;
}

export default function Sidebar({
  sessions,
  activeId,
  health,
  view,
  onSelect,
  onNew,
  onView,
  onHome,
  onOpenOptions,
}: Props) {
  const [showFinished, setShowFinished] = useState(false);
  const [dismissed, hideChild] = useDismissedSubagents();

  const { roots, childrenOf, hiddenCount } = useMemo(() => {
    const now = Date.now();
    const ids = new Set(sessions.map((s) => s.id));
    const children = new Map<string, AgentSession[]>();
    const tops: AgentSession[] = [];
    let hidden = 0;

    for (const session of sessions) {
      const parent = session.parent_session_id;
      // Un enfant dont le parent n'est pas chargé remonte à la racine :
      // sinon il disparaîtrait de la liste sans explication.
      if (parent && ids.has(parent)) {
        if (dismissed.has(session.id)) continue;
        const retired = isRetired(session, now);
        if (retired) hidden += 1;
        if (retired && !showFinished && session.id !== activeId) continue;
        const list = children.get(parent);
        if (list) list.push(session);
        else children.set(parent, [session]);
      } else {
        tops.push(session);
      }
    }

    const byActivity = (a: AgentSession, b: AgentSession) => activity(b) - activity(a);
    tops.sort(byActivity);
    for (const list of children.values()) list.sort(byActivity);

    return { roots: tops, childrenOf: children, hiddenCount: hidden };
  }, [sessions, showFinished, activeId, dismissed]);

  const renderRow = (session: AgentSession, isChild: boolean) => (
    <div className="session-row-wrap" key={`${session.origin}-${session.id}`}>
    <button
      className="session-row"
      data-active={session.id === activeId}
      data-child={isChild}
      data-idle={session.message_count === 0}
      onClick={() => onSelect(session.id)}
      title={session.id}
    >
      {isChild ? (
        <SubagentAvatar
          seed={session.id}
          title={session.title ?? "sous-agent"}
          state={session.running ? "running" : "done"}
          size={18}
        />
      ) : (
        <span className="session-row__dot" data-running={session.running} />
      )}
      <span>
        <span className="session-row__title">{session.title ?? session.id.slice(0, 18)}</span>
        <span className="session-row__meta">
          {isChild ? "subagent" : session.origin === "OpenCode" ? "oc" : session.source} ·{" "}
          {session.message_count} msg · {session.tool_call_count} tools
        </span>
      </span>
    </button>
    {isChild && (
      <button
        className="session-row__dismiss"
        title="Masquer ce sous-agent"
        aria-label={`Masquer ${session.title ?? "ce sous-agent"}`}
        onClick={(e) => {
          e.stopPropagation();
          hideChild(session.id);
        }}
      >
        ×
      </button>
    )}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand__mark">⌘</span>
        <span>
          <span className="brand__name">Hermes Cockpit</span>
          <br />
          <span className="brand__sub">v0 · local</span>
        </span>
        <button
          className="icon-btn brand__gear"
          title="Options : thème, modèle, dossier"
          aria-label="Options"
          onClick={onOpenOptions}
        >
          ⚙
        </button>
      </div>

      <nav className="nav" aria-label="Navigation">
        <button className="nav__item" onClick={onHome} title="Accueil (lagon)">
          <span className="nav__glyph">⌂</span> Accueil
        </button>
        <button className="nav__item" aria-current={view === "chat" ? "page" : undefined} onClick={() => onView("chat")}>
          <span className="nav__glyph">▮</span> Chat
        </button>
        <button className="nav__item" aria-current={view === "agents" ? "page" : undefined} onClick={() => onView("agents")}>
          <span className="nav__glyph">⌥</span> Agents
        </button>
        <button className="nav__item" onClick={onNew}>
          <span className="nav__glyph">+</span> Nouvelle session
        </button>
      </nav>

      <div className="section-label">
        <span>Sessions</span>
        <span className="section-label__right">
          {hiddenCount > 0 && (
            <button
              className="session-toggle"
              onClick={() => setShowFinished((v) => !v)}
              title={
                showFinished
                  ? "Masquer les sous-agents terminés (auto après 10 min)"
                  : hiddenCount + " sous-agent(s) terminé(s) masqué(s) — cliquer pour afficher"
              }
              aria-pressed={showFinished}
            >
              {showFinished ? "– masquer" : "+" + hiddenCount}
            </button>
          )}
          <span className="mono" title="API Hermes / base d'état / OpenCode">
            {dot(health.api)} api · {dot(health.db)} db
          </span>
        </span>
      </div>

      <div className="session-list">
        {roots.length === 0 && (
          <p className="empty">
            Aucune session récente.
            <br />
            Lance <span className="mono">hermes</span> dans un terminal.
          </p>
        )}
        {roots.map((root) => (
          <div key={"group-" + root.origin + "-" + root.id} className="session-group">
            {renderRow(root, false)}
            {(childrenOf.get(root.id) ?? []).map((child) => renderRow(child, true))}
          </div>
        ))}
      </div>
    </aside>
  );
}
