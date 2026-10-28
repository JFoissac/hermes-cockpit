import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import OptionsDialog from "./OptionsDialog";
import type { ModelRef, ProviderModels } from "../shell/ModelPicker";
import type { ThemeMode } from "../../lib/theme";

const providers: ProviderModels[] = [
  { slug: "anthropic", name: "Anthropic", models: ["claude-3.5-sonnet"], is_current: false },
  {
    slug: "opencode-go",
    name: "OpenCode Go",
    models: ["deepseek-v4.1-flash", "qwen3-coder"],
    is_current: true,
  },
];

interface Spies {
  onClose?: () => void;
  onThemeChange?: (theme: ThemeMode) => void;
  onModelChange?: (model: ModelRef) => void;
  onFolderChange?: (folder: string) => void;
}

function Harness({ spies = {} }: { spies?: Spies }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [model, setModel] = useState<ModelRef | null>({
    provider: "opencode-go",
    model: "deepseek-v4.1-flash",
  });
  const [folder, setFolder] = useState("C:/Bureau/Dev/hermes-cockpit");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        ouvrir les options
      </button>
      <OptionsDialog
        open={open}
        onClose={() => {
          spies.onClose?.();
          setOpen(false);
        }}
        theme={theme}
        onThemeChange={(next) => {
          setTheme(next);
          spies.onThemeChange?.(next);
        }}
        providers={providers}
        model={model}
        onModelChange={(next) => {
          setModel(next);
          spies.onModelChange?.(next);
        }}
        folder={folder}
        onFolderChange={(next) => {
          setFolder(next);
          spies.onFolderChange?.(next);
        }}
        recentFolders={["C:/Bureau/Dev/hermes-cockpit", "C:/Bureau/Dev/LifeHub"]}
      />
    </>
  );
}

const openDialog = () => {
  const opener = screen.getByRole("button", { name: "ouvrir les options" });
  opener.focus();
  fireEvent.click(opener);
};
const dialog = () => screen.getByRole("dialog", { name: "Options" });

describe("OptionsDialog", () => {
  it("ne rend rien quand elle est fermée", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("s'ouvre en modale et prend le focus à l'intérieur", () => {
    render(<Harness />);
    openDialog();

    const box = dialog();
    expect(box).toHaveAttribute("aria-modal", "true");
    expect(within(box).getByRole("tab", { name: "Apparence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(box.contains(document.activeElement)).toBe(true);
    expect(within(box).getByRole("radiogroup", { name: "Thème" })).toBeInTheDocument();
    expect(within(box).getByRole("radio", { name: /^Système/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("change de section au clic et au clavier", () => {
    render(<Harness />);
    openDialog();

    fireEvent.click(screen.getByRole("tab", { name: "Dossier de travail" }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAccessibleName("Dossier de travail");
    expect(within(panel).getByLabelText("Dossier de travail")).toHaveValue(
      "C:/Bureau/Dev/hermes-cockpit",
    );
    expect(screen.getByRole("tab", { name: "Dossier de travail" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Navigation clavier dans la colonne d'onglets.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Dossier de travail" }), {
      key: "ArrowDown",
    });
    expect(screen.getByRole("tab", { name: "Raccourcis" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Raccourcis" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "Apparence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("Échap ferme la modale et rend le focus au déclencheur", () => {
    const spies: Spies = { onClose: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.keyDown(dialog(), { key: "Escape" });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ouvrir les options" })).toHaveFocus();
  });

  it("se ferme au clic sur l'overlay mais pas dans le contenu", () => {
    const spies: Spies = { onClose: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.click(screen.getByRole("tabpanel"));
    expect(spies.onClose).not.toHaveBeenCalled();

    const overlay = dialog().parentElement as HTMLElement;
    fireEvent.click(overlay);

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("se ferme avec le bouton ×", () => {
    const spies: Spies = { onClose: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Fermer les options" }));

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("remonte le thème choisi", () => {
    const spies: Spies = { onThemeChange: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.click(screen.getByRole("radio", { name: /^Sombre/ }));

    expect(spies.onThemeChange).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("radio", { name: /^Sombre/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^Système/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("expose le sélecteur de modèle et remonte le choix", () => {
    const spies: Spies = { onModelChange: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.click(screen.getByRole("tab", { name: "Modèle" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(/3 modèles · 2 fournisseurs/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: /^Modèle :/ }));
    fireEvent.click(within(panel).getByRole("option", { name: "claude-3.5-sonnet" }));

    expect(spies.onModelChange).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-3.5-sonnet",
    });
  });

  it("Échap dans le sélecteur de modèle ne ferme que le sélecteur", () => {
    const spies: Spies = { onClose: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();

    fireEvent.click(screen.getByRole("tab", { name: "Modèle" }));
    const panel = screen.getByRole("tabpanel");
    fireEvent.click(within(panel).getByRole("button", { name: /^Modèle :/ }));
    expect(within(panel).getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(within(panel).getByRole("combobox"), { key: "Escape" });

    expect(within(panel).queryByRole("listbox")).not.toBeInTheDocument();
    expect(spies.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Options" })).toBeInTheDocument();
  });

  it("permet de changer de dossier via le champ et les récents", () => {
    const spies: Spies = { onFolderChange: vi.fn() };
    render(<Harness spies={spies} />);
    openDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Dossier de travail" }));

    fireEvent.change(screen.getByLabelText("Dossier de travail"), {
      target: { value: "C:/Bureau/Dev/autre" },
    });
    expect(spies.onFolderChange).toHaveBeenLastCalledWith("C:/Bureau/Dev/autre");

    fireEvent.click(screen.getByRole("button", { name: /LifeHub/ }));
    expect(spies.onFolderChange).toHaveBeenLastCalledWith("C:/Bureau/Dev/LifeHub");
  });

  it("affiche les raccourcis en lecture seule", () => {
    render(<Harness />);
    openDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Raccourcis" }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Envoyer le message")).toBeInTheDocument();
    expect(within(panel).getByText("Maj + Entrée")).toBeInTheDocument();
    expect(within(panel).getByText("Fermer le panneau ou la fenêtre")).toBeInTheDocument();
    expect(within(panel).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("décrit la version et les sources de données", () => {
    render(<Harness />);
    openDialog();
    fireEvent.click(screen.getByRole("tab", { name: "À propos" }));

    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("v0.1.0")).toBeInTheDocument();
    expect(within(panel).getByText(/state\.db · lecture seule/)).toBeInTheDocument();
    expect(within(panel).getByText(/127\.0\.0\.1:8642/)).toBeInTheDocument();
    expect(within(panel).getByText(/CLI/)).toBeInTheDocument();
  });

  it("garde le focus dans la modale (Tab / Maj+Tab)", () => {
    render(<Harness />);
    openDialog();

    const box = dialog();
    const nodes = [
      ...box.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.getAttribute("aria-hidden") !== "true" && el.tabIndex >= 0);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];

    last.focus();
    fireEvent.keyDown(box, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(box, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
