import type { AgentSession, SessionOrigin } from "../../types/api";

export type OriginFilter = "Tout" | SessionOrigin;

export const ORIGIN_TABS: readonly OriginFilter[] = ["Tout", "Hermes", "OpenCode"];

export function filterByOrigin(sessions: AgentSession[], filter: OriginFilter): AgentSession[] {
  return filter === "Tout" ? sessions : sessions.filter((session) => session.origin === filter);
}

interface Props {
  sessions: AgentSession[];
  value: OriginFilter;
  onChange: (next: OriginFilter) => void;
}

export default function OriginTabs({ sessions, value, onChange }: Props) {
  const counts: Record<OriginFilter, number> = { Tout: sessions.length, Hermes: 0, OpenCode: 0 };
  for (const session of sessions) counts[session.origin] += 1;

  return (
    <div className="origin-tabs" role="tablist" aria-label="Filtrer par origine">
      {ORIGIN_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          className="origin-tabs__tab"
          data-origin={tab}
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
        >
          <span>{tab}</span>
          <span className="mono origin-tabs__count">{counts[tab]}</span>
        </button>
      ))}
    </div>
  );
}
