import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SlashMenu, { filterSlashItems, HERMES_COMMANDS } from "./SlashMenu";

describe("filterSlashItems", () => {
  it("propose /goal quand on tape « go »", () => {
    const items = filterSlashItems([], "go");
    expect(items.map((i) => i.name)).toEqual(["goal"]);
  });

  it("liste les commandes intégrées quand rien n'est tapé", () => {
    const items = filterSlashItems([], "");
    expect(items.length).toBe(HERMES_COMMANDS.length);
    expect(items[0].group).toBe("Commande");
  });

  it("ajoute les skills installés après les commandes", () => {
    const items = filterSlashItems([{ name: "gif-search" }, { name: "github" }], "");
    expect(items[items.length - 1].group).toBe("Skill");
    expect(items.map((i) => i.name)).toContain("gif-search");
  });

  it("ne propose pas un skill dont le nom est déjà pris par une commande", () => {
    const items = filterSlashItems([{ name: "plan" }], "plan");
    expect(items.filter((i) => i.name === "plan")).toHaveLength(1);
    expect(items[0].group).toBe("Commande");
  });
});

describe("SlashMenu", () => {
  const items = filterSlashItems([{ name: "gif-search" }], "");

  it("affiche les deux groupes", () => {
    render(<SlashMenu items={items} active={0} onPick={() => {}} onHover={() => {}} />);
    expect(screen.getByText("Commande")).toBeTruthy();
    expect(screen.getByText("Skill")).toBeTruthy();
    expect(screen.getByText("/gif-search")).toBeTruthy();
  });

  it("rend l'entrée active et remonte le clic", () => {
    const onPick = vi.fn();
    render(<SlashMenu items={items} active={1} onPick={onPick} onHover={() => {}} />);
    const options = screen.getAllByRole("option");
    expect(options[1].getAttribute("data-active")).toBe("true");
    fireEvent.mouseDown(options[1]);
    expect(onPick).toHaveBeenCalledWith(items[1]);
  });
});
