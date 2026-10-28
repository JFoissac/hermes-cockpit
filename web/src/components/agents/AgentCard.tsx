import type { AgentSession } from "../../types/api";

export type AgentAction = "resume" | "stop" | "open";

interface Props {
  session: AgentSession;
  onAction?: (action: AgentAction, session: AgentSession) => void;
}

/** 12 400 -> "12.4k", 1 000 000 -> "1M". Compact pour la ligne de stats. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Dernier segment d'un chemin Windows ou POSIX, pour la ligne de méta. */
function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export default function AgentCard({ session, onAction }: Props) {
  const title = session.title?.trim() || session.id;
  const attention = session.running && session.tool_call_count > 0;
  const context = formatTokens(session.input_tokens + session.output_tokens);
  const cost = `$${session.cost_usd.toFixed(3)}`;
  const workspace = session.cwd ? lastSegment(session.cwd) : session.source;

  const fire = (action: AgentAction) => () => onAction?.(action, session);

  return (
    <article
      className={`agent-card${attention ? " agent-card--attention" : ""}`}
      data-state={session.running ? "running" : "idle"}
      data-origin={session.origin}
    >
      <header className="agent-card__head">
        <span className="agent-card__dot" data-running={session.running} aria-hidden="true" />
        <h3 className="agent-card__title" title={title}>
          {title}
        </h3>
        <span className="badge mono agent-card__model" title={session.model ?? "modèle inconnu"}>
          {session.model ?? "—"}
        </span>
      </header>

      <p className="agent-card__meta mono">
        <span className="agent-card__origin">{session.origin === "OpenCode" ? "opencode" : "hermes"}</span>
        <span aria-hidden="true">·</span>
        <span className="agent-card__cwd" title={session.cwd ?? session.source}>
          {workspace}
        </span>
        {session.git_branch && (
          <>
            <span aria-hidden="true">·</span>
            <span className="agent-card__cwd" title={session.git_branch}>
              {session.git_branch}
            </span>
          </>
        )}
      </p>

      <p className="agent-card__stats mono">
        <span title="Messages">{session.message_count} msg</span>
        <span title="Appels d'outils">{session.tool_call_count} tools</span>
        <span title="Contexte (entrée + sortie)">{context} ctx</span>
        <span title="Coût cumulé">{cost}</span>
      </p>

      {session.preview && <p className="agent-card__preview">{session.preview}</p>}

      <footer className="agent-card__foot">
        <button
          type="button"
          className="icon-btn"
          data-tone="green"
          aria-label={`Reprendre la session : ${title}`}
          title="Reprendre"
          onClick={fire("resume")}
        >
          ▶
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tone="red"
          aria-label={`Arrêter la session : ${title}`}
          title="Arrêter"
          onClick={fire("stop")}
        >
          ■
        </button>
        <button
          type="button"
          className="icon-btn"
          data-tone="blue"
          aria-label={`Ouvrir le dossier de travail : ${title}`}
          title="Ouvrir le dossier"
          onClick={fire("open")}
        >
          🌐
        </button>
      </footer>
    </article>
  );
}
