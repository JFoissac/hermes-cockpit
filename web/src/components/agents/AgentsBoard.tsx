import { useMemo } from "react";
import type { AgentSession } from "../../types/api";
import AgentCard, { type AgentAction } from "./AgentCard";

/** Actives d'abord, puis activité la plus récente. Ne mute pas l'entrée. */
export function sortSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0);
  });
}

interface Props {
  sessions: AgentSession[];
  onAction?: (action: AgentAction, session: AgentSession) => void;
}

export default function AgentsBoard({ sessions, onAction }: Props) {
  const ordered = useMemo(() => sortSessions(sessions), [sessions]);

  if (ordered.length === 0) {
    return <p className="empty">Aucune session — démarre Hermes dans un terminal.</p>;
  }

  return (
    <ul className="agents-board" aria-label="Sessions">
      {ordered.map((session) => (
        <li key={`${session.origin}-${session.id}`} className="agents-board__item">
          <AgentCard session={session} onAction={onAction} />
        </li>
      ))}
    </ul>
  );
}
