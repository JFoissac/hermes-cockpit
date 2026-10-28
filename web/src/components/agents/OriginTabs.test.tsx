import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OriginTabs, { filterByOrigin, type OriginFilter } from "./OriginTabs";
import type { AgentSession } from "../../types/api";

function makeSession(id: string, title: string, origin: AgentSession["origin"]): AgentSession {
  return {
    id,
    title,
    source: origin === "OpenCode" ? "opencode" : "hermes",
    model: "deepseek-v4.1",
    parent_session_id: null,
    running: false,
    message_count: 3,
    tool_call_count: 1,
    input_tokens: 1200,
    output_tokens: 400,
    cost_usd: 0.01,
    last_activity_at: 1_760_000_000,
    cwd: "C:/Bureau/Dev/hermes-cockpit",
    git_branch: "main",
    origin,
    preview: null,
  };
}

const sessions = [
  makeSession("local-a1", "Refonte du rail", "Hermes"),
  makeSession("local-a2", "Revue des cartes", "Hermes"),
  makeSession("local-b1", "Audit des dépendances", "OpenCode"),
];

function Harness() {
  const [filter, setFilter] = useState<OriginFilter>("Tout");
  return (
    <>
      <OriginTabs sessions={sessions} value={filter} onChange={setFilter} />
      <ul>
        {filterByOrigin(sessions, filter).map((session) => (
          <li key={session.id}>{session.title}</li>
        ))}
      </ul>
    </>
  );
}

describe("OriginTabs", () => {
  it("affiche les compteurs par origine (3 / 2 / 1)", () => {
    render(<Harness />);

    const all = screen.getByRole("tab", { name: /^Tout/ });
    expect(all).toHaveTextContent("3");
    expect(all).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Hermes/ })).toHaveTextContent("2");
    expect(screen.getByRole("tab", { name: /^OpenCode/ })).toHaveTextContent("1");
  });

  it("filtre les sessions au clic sur un onglet", () => {
    render(<Harness />);

    expect(screen.getByText("Refonte du rail")).toBeInTheDocument();
    expect(screen.getByText("Audit des dépendances")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^OpenCode/ }));

    expect(screen.getByRole("tab", { name: /^OpenCode/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: /^Tout/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Audit des dépendances")).toBeInTheDocument();
    expect(screen.queryByText("Refonte du rail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^Hermes/ }));

    expect(screen.getByText("Refonte du rail")).toBeInTheDocument();
    expect(screen.getByText("Revue des cartes")).toBeInTheDocument();
    expect(screen.queryByText("Audit des dépendances")).not.toBeInTheDocument();
  });
});
