import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import UltraRoster from "./UltraRoster";
import type { UltraAgent } from "./UltraRoster";

function roster(): UltraAgent[] {
  return [
    { id: "impl", label: "Implémentation", state: "running", detail: "ultra/impl · 12 fichiers" },
    { id: "review", label: "Revue", state: "done", detail: "ultra/review · 0 bloquant" },
    { id: "verify", label: "Vérification", state: "error", detail: "tsc -b : 2 erreurs" },
  ];
}

describe("UltraRoster", () => {
  it("ne rend rien quand la liste d'agents est vide", () => {
    const { container } = render(<UltraRoster agents={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("rend une pastille par agent, avec les trois états", () => {
    render(<UltraRoster agents={roster()} />);

    const chips = screen.getAllByRole("button");
    expect(chips).toHaveLength(3);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Implémentation")).toBeInTheDocument();
    expect(screen.getByText("Revue")).toBeInTheDocument();
    expect(screen.getByText("Vérification")).toBeInTheDocument();
  });

  it("expose un aria-label explicite : libellé + état", () => {
    render(<UltraRoster agents={roster()} />);

    expect(
      screen.getByRole("button", { name: "Implémentation — en cours" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revue — terminé" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vérification — en erreur" })
    ).toBeInTheDocument();
  });

  it("appelle onOpen avec l'identifiant de la pastille cliquée", () => {
    const onOpen = vi.fn();
    render(<UltraRoster agents={roster()} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Revue — terminé" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("review");
  });

  it("reste cliquable sans onOpen (prop facultative)", () => {
    render(<UltraRoster agents={roster()} />);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Implémentation — en cours" }))
    ).not.toThrow();
  });

  it("reflète l'état dans data-state sur la pastille et le point", () => {
    render(<UltraRoster agents={roster()} />);

    const running = screen.getByRole("button", { name: "Implémentation — en cours" });
    const done = screen.getByRole("button", { name: "Revue — terminé" });
    const error = screen.getByRole("button", { name: "Vérification — en erreur" });

    expect(running).toHaveAttribute("data-state", "running");
    expect(done).toHaveAttribute("data-state", "done");
    expect(error).toHaveAttribute("data-state", "error");

    const dots = document.querySelectorAll<HTMLElement>(".ultra-roster__dot");
    expect(dots).toHaveLength(3);
    expect(Array.from(dots).map((dot) => dot.getAttribute("data-state"))).toEqual([
      "running",
      "done",
      "error",
    ]);
  });

  it("affiche le détail en monospace uniquement quand il est fourni", () => {
    const agents: UltraAgent[] = [
      { id: "impl", label: "Implémentation", state: "running", detail: "ultra/impl · 12 fichiers" },
      { id: "review", label: "Revue", state: "done" },
    ];
    render(<UltraRoster agents={agents} />);

    const detail = screen.getByText("ultra/impl · 12 fichiers");
    expect(detail).toHaveClass("mono", "ultra-roster__detail");
    expect(document.querySelectorAll(".ultra-roster__detail")).toHaveLength(1);
  });
});
