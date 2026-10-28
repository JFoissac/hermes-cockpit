import { useMemo, useState } from "react";
import AgentsBoard from "../components/agents/AgentsBoard";
import OriginTabs, { filterByOrigin, type OriginFilter } from "../components/agents/OriginTabs";
import SubagentTree from "../components/agents/SubagentTree";
import { useSessions, useSubagents } from "../lib/api";
import "../components/agents/agents.css";

/** Seuil de repli de l'en-tête : au-delà, il passe de 96px à 56px. */
const COMPACT_AFTER = 32;

export default function AgentsView() {
  const { data: sessions } = useSessions(60);
  const { data: subagents } = useSubagents();

  const [origin, setOrigin] = useState<OriginFilter>("Tout");
  const [compact, setCompact] = useState(false);

  const visible = useMemo(() => filterByOrigin(sessions, origin), [sessions, origin]);
  const running = useMemo(() => sessions.filter((session) => session.running).length, [sessions]);

  const groups = useMemo(() => {
    const sessionIds = new Set(sessions.map((session) => session.id));
    const subagentIds = new Set(subagents.map((sub) => sub.id));

    const bySession = visible
      .map((session) => ({
        session,
        subs: subagents.filter((sub) => sub.parent_id === session.id),
      }))
      .filter((group) => group.subs.length > 0);

    // Sous-agents dont le parent n'est ni une session chargée ni un sous-agent connu.
    const orphans = subagents.filter(
      (sub) => !sessionIds.has(sub.parent_id) && !subagentIds.has(sub.parent_id)
    );

    return { bySession, orphans };
  }, [visible, subagents]);

  const subtitle = `${sessions.length} session${sessions.length > 1 ? "s" : ""} · ${subagents.length} sous-agent${
    subagents.length > 1 ? "s" : ""
  } · ${running} en cours`;

  return (
    <main
      className="agents"
      aria-labelledby="agents-title"
      onScroll={(event) => setCompact(event.currentTarget.scrollTop > COMPACT_AFTER)}
    >
      <header className="agents__head" data-compact={compact}>
        <h1 className="agents__title" id="agents-title">
          Agents
        </h1>
        <p className="agents__sub mono">{subtitle}</p>
      </header>

      <div className="agents__toolbar">
        <OriginTabs sessions={sessions} value={origin} onChange={setOrigin} />
        <span className="agents__hint mono">
          {visible.length} / {sessions.length} sessions
        </span>
      </div>

      <div className="agents__layout">
        <section className="agents__board">
          <AgentsBoard sessions={visible} />
        </section>

        <aside className="agents__rail" aria-label="Sous-agents">
          <div className="section-label">
            <span>Sous-agents</span>
            <span className="mono">{subagents.length}</span>
          </div>

          {groups.bySession.length === 0 && groups.orphans.length === 0 ? (
            <SubagentTree subagents={[]} />
          ) : (
            <>
              {groups.bySession.map(({ session }) => (
                <section key={session.id} className="agents__group">
                  <h2 className="agents__group-title" title={session.title ?? session.id}>
                    {session.title ?? session.id}
                  </h2>
                  <SubagentTree subagents={subagents} rootId={session.id} />
                </section>
              ))}
              {groups.orphans.length > 0 && (
                <section className="agents__group">
                  <h2 className="agents__group-title">Sessions inconnues</h2>
                  <SubagentTree subagents={groups.orphans} />
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
