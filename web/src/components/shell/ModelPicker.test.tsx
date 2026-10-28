import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ModelPicker, {
  filterOptions,
  shortModel,
  type ModelRef,
  type ProviderModels,
} from "./ModelPicker";

const providers: ProviderModels[] = [
  {
    slug: "anthropic",
    name: "Anthropic",
    models: ["claude-3.5-sonnet", "claude-3-haiku"],
    is_current: false,
  },
  {
    slug: "opencode-go",
    name: "OpenCode Go",
    models: ["deepseek-v4.1-flash", "qwen3-coder"],
    is_current: true,
  },
];

function Harness({ onChange }: { onChange?: (model: ModelRef) => void }) {
  const [value, setValue] = useState<ModelRef | null>({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
  });
  return (
    <ModelPicker
      providers={providers}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: /^Modèle :/ });
const search = () => screen.getByRole("combobox", { name: "Rechercher un modèle" });

describe("ModelPicker", () => {
  it("affiche le nom court du modèle courant sur un bouton compact", () => {
    render(<Harness />);

    expect(trigger()).toHaveTextContent("deepseek-v4.1-flash");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ouvre un panneau groupé par fournisseur avec l'option courante marquée", () => {
    render(<Harness />);
    fireEvent.click(trigger());

    const list = screen.getByRole("listbox", { name: "Modèles disponibles" });
    expect(list).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Anthropic" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "OpenCode Go" })).toBeInTheDocument();

    const current = screen.getByRole("option", { name: "deepseek-v4.1-flash" });
    expect(current).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "qwen3-coder" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("filtre la liste avec le champ de recherche", () => {
    render(<Harness />);
    fireEvent.click(trigger());

    fireEvent.change(search(), { target: { value: "claude" } });

    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "claude-3.5-sonnet" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "deepseek-v4.1-flash" })).not.toBeInTheDocument();

    // La recherche porte aussi sur le nom du fournisseur.
    fireEvent.change(search(), { target: { value: "opencode" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.change(search(), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("Aucun modèle ne correspond.")).toBeInTheDocument();
  });

  it("remonte { provider, model } à la sélection et referme le panneau", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole("option", { name: "qwen3-coder" }));

    expect(onChange).toHaveBeenCalledWith({ provider: "opencode-go", model: "qwen3-coder" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("qwen3-coder");
    expect(trigger()).toHaveFocus();
  });

  it("se pilote au clavier : ↑ ↓ puis Entrée", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());

    // Le premier élément actif est le modèle courant (deepseek), puis ↓ vers qwen3-coder.
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith({ provider: "opencode-go", model: "qwen3-coder" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ferme sur Échap et rend le focus au bouton", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(search()).toHaveFocus();

    fireEvent.keyDown(search(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it("ne s'ouvre pas quand il est désactivé", () => {
    render(<ModelPicker providers={providers} value={null} onChange={() => {}} disabled />);

    const button = screen.getByRole("button", { name: /^Modèle :/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button).toHaveTextContent("modèle du profil");
  });

  it("expose des utilitaires purs testables", () => {
    expect(shortModel("anthropic/claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
    expect(shortModel("a".repeat(40))).toHaveLength(26);
    expect(shortModel("a".repeat(40)).endsWith("…")).toBe(true);

    const all = filterOptions(providers, "");
    expect(all.map((o) => o.id)).toEqual([
      "mp-anthropic-claude-3-5-sonnet",
      "mp-anthropic-claude-3-haiku",
      "mp-opencode-go-deepseek-v4-1-flash",
      "mp-opencode-go-qwen3-coder",
    ]);
    expect(filterOptions(providers, "haiku")).toHaveLength(1);
  });
});
