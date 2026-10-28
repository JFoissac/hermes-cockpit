import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SubagentTree from "./SubagentTree";
import type { Subagent } from "../../types/api";

const orchestrator: Subagent = {
  id: "sa-orch",
  parent_id: "local-8f2c1a",
  goal: "Orchestrer la refonte du rail",
  state: "running",
  dispatched_at: 100,
  completed_at: null,
};

const dataChild: Subagent = {
  id: "sa-data",
  parent_id: "sa-orch",
  goal: "Extraire le contrat de données",
  state: "SUCCEEDED",
  dispatched_at: 100,
  completed_at: 112,
};

const testsChild: Subagent = {
  id: "sa-tests",
  parent_id: "sa-orch",
  goal: "Écrire les tests du board",
  state: "FAILED",
  dispatched_at: 100,
  completed_at: 300,
};

const otherSession: Subagent = {
  id: "sa-oc",
  parent_id: "local-999",
  goal: "Auditer les dépendances OpenCode",
  state: "running",
  dispatched_at: 5,
  completed_at: null,
};

describe("SubagentTree", () => {
  it("ne rend que les enfants du parent demandé", () => {
    render(
      <SubagentTree
        subagents={[orchestrator, dataChild, testsChild, otherSession]}
        rootId="sa-orch"
      />
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Extraire le contrat de données")).toBeInTheDocument();
    expect(screen.getByText("Écrire les tests du board")).toBeInTheDocument();
    expect(screen.queryByText("Auditer les dépendances OpenCode")).not.toBeInTheDocument();
  });

  it("affiche le badge d'état de chaque sous-agent", () => {
    render(<SubagentTree subagents={[orchestrator, dataChild, testsChild]} rootId="sa-orch" />);

    expect(screen.getByText("SUCCEEDED")).toHaveAttribute("data-state", "SUCCEEDED");
    expect(screen.getByText("FAILED")).toHaveAttribute("data-state", "FAILED");
  });

  it("formate la durée dispatch → completion (12s, 3m20s)", () => {
    const { rerender } = render(
      <SubagentTree subagents={[orchestrator, dataChild, testsChild]} rootId="sa-orch" />
    );

    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText("3m20s")).toBeInTheDocument();

    // Un sous-agent encore en cours n'a pas de durée.
    rerender(<SubagentTree subagents={[orchestrator]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("indente les sous-agents imbriqués de 14px par niveau", () => {
    const grandchild: Subagent = {
      id: "sa-tests-unit",
      parent_id: "sa-tests",
      goal: "Couvrir le tri des cartes",
      state: "running",
      dispatched_at: 130,
      completed_at: null,
    };

    const { container } = render(
      <SubagentTree
        subagents={[orchestrator, dataChild, testsChild, grandchild]}
        rootId="sa-orch"
      />
    );

    const nested = container.querySelector('li[data-depth="1"]');
    expect(nested).not.toBeNull();
    expect(nested).toHaveTextContent("Couvrir le tri des cartes");
    expect(nested).toHaveStyle({ marginLeft: "14px" });
    expect(container.querySelectorAll('li[data-depth="0"]')).toHaveLength(2);
  });

  it("affiche l'état vide quand aucun sous-agent n'existe", () => {
    render(<SubagentTree subagents={[]} />);

    expect(screen.getByText("Aucun sous-agent actif.")).toBeInTheDocument();
  });
});
