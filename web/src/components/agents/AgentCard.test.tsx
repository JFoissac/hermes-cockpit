import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import AgentCard from "./AgentCard";
import type { AgentSession } from "../../types/api";

function makeSession(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "local-8f2c1a",
    title: "Refonte du rail d'aperçu",
    source: "hermes",
    model: "deepseek-v4.1",
    parent_session_id: null,
    running: false,
    message_count: 12,
    tool_call_count: 3,
    input_tokens: 9000,
    output_tokens: 3400,
    cost_usd: 0.042,
    last_activity_at: 1_760_000_000,
    cwd: "C:/Bureau/Dev/hermes-cockpit",
    git_branch: "feat/agents-view",
    origin: "Hermes",
    preview: "On reprend le composant de prévisualisation pour le tenir en deux lignes.",
    ...patch,
  };
}

describe("AgentCard", () => {
  it("affiche le titre, le modèle et la ligne de statistiques", () => {
    render(<AgentCard session={makeSession()} />);

    expect(
      screen.getByRole("heading", { level: 3, name: "Refonte du rail d'aperçu" })
    ).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4.1")).toBeInTheDocument();
    expect(screen.getByText("12 msg")).toBeInTheDocument();
    expect(screen.getByText("3 tools")).toBeInTheDocument();
    expect(screen.getByText("12.4k ctx")).toBeInTheDocument();
    expect(screen.getByText("$0.042")).toBeInTheDocument();
    expect(screen.getByText(/prévisualisation/)).toBeInTheDocument();
  });

  it("expose data-state=running et le halo quand un outil tourne", () => {
    render(<AgentCard session={makeSession({ running: true, tool_call_count: 4 })} />);

    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("data-state", "running");
    expect(card).toHaveClass("agent-card--attention");
  });

  it("reste sans halo quand la session tourne sans appel d'outil", () => {
    render(<AgentCard session={makeSession({ running: true, tool_call_count: 0 })} />);

    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("data-state", "running");
    expect(card).not.toHaveClass("agent-card--attention");
  });

  it("rend trois boutons à icône unique avec un aria-label français", () => {
    render(<AgentCard session={makeSession()} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAccessibleName(/Reprendre la session/);
    expect(buttons[1]).toHaveAccessibleName(/Arrêter la session/);
    expect(buttons[2]).toHaveAccessibleName(/Ouvrir le dossier/);
    for (const button of buttons) {
      expect(button.textContent?.trim()).not.toBe("");
    }
  });

  it("tronque visuellement un titre long mais conserve le titre complet", () => {
    const long =
      "Refonte complète du rail d'aperçu et des indicateurs de santé du cockpit Hermes en mode compact";
    render(<AgentCard session={makeSession({ title: long })} />);

    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading).toHaveTextContent(long);
    expect(heading).toHaveAttribute("title", long);
    expect(heading).toHaveClass("agent-card__title");
  });
});
