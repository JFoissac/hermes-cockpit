import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import EffortBar, { EFFORT_LEVELS } from "./EffortBar";

/* jsdom n'implémente pas PointerEvent (ni setPointerCapture). React route les
 * événements sur le type natif : un MouseEvent nommé "pointerdown" déclenche
 * bien onPointerDown et porte clientX, ce dont le composant a besoin. */
function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number
): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
}

function railRect(width = 200, left = 0): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 28,
    width,
    height: 28,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Fige la géométrie de la piste : sans ça getBoundingClientRect rend 0. */
function stubRailGeometry(width = 200, left = 0): HTMLElement {
  const rail = screen.getByRole("slider");
  vi.spyOn(rail, "getBoundingClientRect").mockReturnValue(railRect(width, left));
  return rail;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EffortBar", () => {
  it("rend les cinq crans, du plus rapide au plus profond", () => {
    const { container } = render(<EffortBar value="low" onChange={() => {}} />);

    expect(container.querySelectorAll(".effort__notch")).toHaveLength(5);
    expect(EFFORT_LEVELS.map((level) => level.label)).toEqual([
      "Rapide",
      "Standard",
      "Approfondi",
      "Intense",
      "Ultra",
    ]);
    expect(screen.getByText("Rapide")).toBeInTheDocument();
    // Quatre crans allumés au minimum : le premier est toujours actif.
    const lit = container.querySelectorAll('.effort__notch[data-on="true"]');
    expect(lit).toHaveLength(1);
  });

  it("annonce le niveau actif par aria-valuenow et aria-valuetext", () => {
    const { rerender } = render(<EffortBar value="low" onChange={() => {}} />);
    const rail = screen.getByRole("slider");

    expect(rail).toHaveAttribute("role", "slider");
    expect(rail).toHaveAttribute("aria-valuemin", "0");
    expect(rail).toHaveAttribute("aria-valuemax", "4");
    expect(rail).toHaveAttribute("aria-valuenow", "0");
    expect(rail.getAttribute("aria-valuetext")).toContain("Rapide");

    rerender(<EffortBar value="ultra" onChange={() => {}} />);

    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByText("Ultra")).toBeInTheDocument();
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toContain("Ultra");
  });

  it("fait suivre le remplissage à l'index du niveau", () => {
    const { container, rerender } = render(<EffortBar value="low" onChange={() => {}} />);
    const root = () => container.querySelector(".effort") as HTMLElement;

    expect(root().style.getPropertyValue("--effort-ratio")).toBe("0");

    rerender(<EffortBar value="high" onChange={() => {}} />);
    expect(root().style.getPropertyValue("--effort-ratio")).toBe("0.5");

    rerender(<EffortBar value="ultra" onChange={() => {}} />);
    expect(root().style.getPropertyValue("--effort-ratio")).toBe("1");
  });

  it("choisit le quatrième cran quand on clique à 80 % de la piste", () => {
    const onChange = vi.fn();
    render(<EffortBar value="low" onChange={onChange} />);
    const rail = stubRailGeometry();

    fireEvent(rail, pointer("pointerdown", 160));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("xhigh");
  });

  it("suit le curseur pendant un glissement jusqu'au dernier cran", () => {
    const onChange = vi.fn();
    render(<EffortBar value="low" onChange={onChange} />);
    const rail = stubRailGeometry();

    // Un mouvement sans appui préalable est ignoré.
    fireEvent(rail, pointer("pointermove", 200));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent(rail, pointer("pointerdown", 50)); // 25 % → Standard
    fireEvent(rail, pointer("pointermove", 120)); // 60 % → Approfondi
    fireEvent(rail, pointer("pointermove", 200)); // 100 % → Ultra
    fireEvent(rail, pointer("pointerup", 200));

    expect(onChange).toHaveBeenNthCalledWith(1, "medium");
    expect(onChange).toHaveBeenNthCalledWith(2, "high");
    expect(onChange).toHaveBeenLastCalledWith("ultra");
  });

  it("avance et recule d'un cran avec les flèches", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EffortBar value="low" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("medium");

    rerender(<EffortBar value="medium" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("low");
  });

  it("revient à Rapide avec Home et va à Ultra avec End", () => {
    const onChange = vi.fn();
    const { rerender } = render(<EffortBar value="high" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("low");

    rerender(<EffortBar value="high" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("ultra");
  });

  it("n'émet rien quand le cran demandé est déjà atteint", () => {
    const onChange = vi.fn();
    render(<EffortBar value="ultra" onChange={onChange} />);
    const rail = screen.getByRole("slider");

    fireEvent.keyDown(rail, { key: "ArrowRight" });
    fireEvent.keyDown(rail, { key: "End" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("expose l'état occupé pour l'animation du dégradé", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<EffortBar value="medium" onChange={onChange} />);
    const root = () => container.querySelector(".effort") as HTMLElement;

    expect(root()).toHaveAttribute("data-busy", "false");
    expect(root()).not.toHaveClass("effort--busy");
    expect(root()).toHaveAttribute("aria-busy", "false");

    rerender(<EffortBar value="medium" onChange={onChange} busy />);

    expect(root()).toHaveAttribute("data-busy", "true");
    expect(root()).toHaveClass("effort--busy");
    expect(root()).toHaveAttribute("aria-busy", "true");
  });

  it("accepte une classe et reste atteignable au clavier", () => {
    const { container } = render(
      <EffortBar value="low" onChange={() => {}} className="composer__effort" />
    );

    expect(container.querySelector(".effort")).toHaveClass("composer__effort");

    const rail = screen.getByRole("slider");
    expect(rail).toHaveAttribute("tabindex", "0");
    rail.focus();
    expect(rail).toHaveFocus();
  });
});
