import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentsBoard, { sortSessions } from "./AgentsBoard";
import type { AgentSession } from "../../types/api";

function makeSession(patch: Partial<AgentSession> & { id: string; title: string }): AgentSession {
  return {
    source: "hermes",
    model: "deepseek-v4.1",
    parent_session_id: null,
    running: false,
    message_count: 4,
    tool_call_count: 0,
    input_tokens: 2000,
    output_tokens: 800,
    cost_usd: 0.012,
    last_activity_at: 0,
    cwd: "C:/Bureau/Dev/hermes-cockpit",
    git_branch: "main",
    origin: "Hermes",
    preview: null,
    ...patch,
  };
}

const runningOld = makeSession({
  id: "local-run",
  title: "En cours — orchestration",
  running: true,
  last_activity_at: 100,
});

const idleRecent = makeSession({
  id: "local-recent",
  title: "Récent — revue",
  last_activity_at: 900,
});

const idleOld = makeSession({
  id: "local-old",
  title: "Ancien — archivage",
  last_activity_at: 300,
});

describe("AgentsBoard", () => {
  it("trie les sessions actives d'abord, puis par activité décroissante", () => {
    const { container } = render(
      <AgentsBoard sessions={[idleOld, idleRecent, runningOld]} />
    );

    const titles = Array.from(container.querySelectorAll("article.agent-card h3")).map(
      (node) => node.textContent
    );
    expect(titles).toEqual(["En cours — orchestration", "Récent — revue", "Ancien — archivage"]);
  });

  it("ne mute pas le tableau reçu", () => {
    const input = [idleOld, runningOld];
    sortSessions(input);
    expect(input.map((session) => session.id)).toEqual(["local-old", "local-run"]);
  });

  it("affiche l'état vide sans session", () => {
    render(<AgentsBoard sessions={[]} />);

    expect(
      screen.getByText("Aucune session — démarre Hermes dans un terminal.")
    ).toBeInTheDocument();
  });
});
