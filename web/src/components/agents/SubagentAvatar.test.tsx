import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SubagentAvatar, { avatarHue } from "./SubagentAvatar";

const SEED_A = "sub-8f2c1a";
const SEED_B = "sub-3b7d90";

describe("avatarHue", () => {
  it("donne la même paire de teintes pour la même graine", () => {
    expect(avatarHue(SEED_A)).toEqual(avatarHue(SEED_A));
  });

  it("ignore la casse et les espaces de bord de la graine", () => {
    expect(avatarHue("  Sub-8F2C1A ")).toEqual(avatarHue(SEED_A));
  });

  it("donne des teintes différentes pour deux graines différentes", () => {
    expect(avatarHue(SEED_A).from).not.toBe(avatarHue(SEED_B).from);
  });

  it("reste dans la plage de teintes et espace les deux arrêts du dégradé", () => {
    const { from, to } = avatarHue(SEED_B);
    for (const hue of [from, to]) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(from).not.toBe(to);
  });
});

describe("SubagentAvatar", () => {
  it("rend le même dégradé pour deux appels avec la même graine", () => {
    const first = render(<SubagentAvatar seed={SEED_A} title="Audit du rail" />);
    const second = render(<SubagentAvatar seed={SEED_A} title="Audit du rail" />);

    const a = first.container.querySelector(".sa-avatar") as HTMLElement;
    const b = second.container.querySelector(".sa-avatar") as HTMLElement;

    expect(a.style.backgroundImage).not.toBe("");
    expect(a.style.backgroundImage).toBe(b.style.backgroundImage);
    expect(a.style.backgroundImage).toContain("linear-gradient(135deg");
    expect(a.style.borderRadius).toBe(b.style.borderRadius);
    expect(a.textContent).toBe(b.textContent);
  });

  it("change le dégradé et la forme quand la graine change", () => {
    const a = render(<SubagentAvatar seed={SEED_A} />);
    const b = render(<SubagentAvatar seed={SEED_B} />);

    const first = a.container.querySelector(".sa-avatar") as HTMLElement;
    const second = b.container.querySelector(".sa-avatar") as HTMLElement;

    expect(first.style.backgroundImage).not.toBe(second.style.backgroundImage);
    expect(first.dataset.shape).not.toBe(second.dataset.shape);
  });

  it("utilise le title comme libellé accessible", () => {
    render(<SubagentAvatar seed={SEED_A} title="Refonte de la sidebar" />);

    expect(screen.getByRole("img", { name: "Refonte de la sidebar" })).toBeInTheDocument();
  });

  it('retombe sur « sous-agent » sans title', () => {
    render(<SubagentAvatar seed={SEED_A} />);

    expect(screen.getByRole("img", { name: "sous-agent" })).toBeInTheDocument();
  });

  it("affiche les initiales du title, sinon un glyphe géométrique", () => {
    const withTitle = render(<SubagentAvatar seed={SEED_A} title="Refonte de la sidebar" />);
    expect(withTitle.container.querySelector(".sa-avatar__glyph")?.textContent).toBe("RD");

    const withoutTitle = render(<SubagentAvatar seed={SEED_A} />);
    const glyph = withoutTitle.container.querySelector(".sa-avatar__glyph")?.textContent ?? "";
    expect(glyph.length).toBe(1);
    expect(glyph).toMatch(/[◆◇▲△●◐▮✦]/u);
  });

  it("recopie l'état dans data-state et dans la classe de modificateur", () => {
    const { container, rerender } = render(<SubagentAvatar seed={SEED_A} state="running" />);
    const avatar = container.querySelector(".sa-avatar") as HTMLElement;

    expect(avatar).toHaveAttribute("data-state", "running");
    expect(avatar).toHaveClass("sa-avatar--running");

    rerender(<SubagentAvatar seed={SEED_A} state="error" />);
    expect(avatar).toHaveAttribute("data-state", "error");
    expect(avatar).toHaveClass("sa-avatar--error");
    expect(avatar).not.toHaveClass("sa-avatar--running");

    rerender(<SubagentAvatar seed={SEED_A} />);
    expect(avatar).toHaveAttribute("data-state", "done");
    expect(avatar).toHaveClass("sa-avatar--done");
  });

  it("applique la taille demandée et 22px par défaut", () => {
    const custom = render(<SubagentAvatar seed={SEED_A} size={34} />);
    const avatar = custom.container.querySelector(".sa-avatar") as HTMLElement;

    expect(avatar.style.width).toBe("34px");
    expect(avatar.style.height).toBe("34px");
    expect(avatar.style.fontSize).toBe("15.3px");

    custom.unmount();

    const fallback = render(<SubagentAvatar seed={SEED_A} />);
    const byDefault = fallback.container.querySelector(".sa-avatar") as HTMLElement;
    expect(byDefault.style.width).toBe("22px");
    expect(byDefault.style.height).toBe("22px");
    expect(byDefault.style.fontSize).toBe("9.9px");
  });

  it("conserve la classe externe passée par l'appelant", () => {
    const { container } = render(<SubagentAvatar seed={SEED_A} className="rail-avatar" />);

    const avatar = container.querySelector(".sa-avatar") as HTMLElement;
    expect(avatar).toHaveClass("sa-avatar");
    expect(avatar).toHaveClass("rail-avatar");
  });
});
