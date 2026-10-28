import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatPane, { buildThread, type ChatMessage, type ChatPaneProps } from "./ChatPane";

/* ── Jeux de messages ────────────────────────────────────────────────────
 * Les messages d'outil arrivent avec un `toolPreview` lisible : c'est lui que
 * le bloc d'activité doit afficher, jamais le JSON brut.
 */
function userMessage(id: string, content: string): ChatMessage {
  return { id, role: "user", content };
}

function assistantMessage(id: string, content: string, reasoning?: string): ChatMessage {
  return { id, role: "assistant", content, reasoning: reasoning ?? null };
}

function toolMessage(id: string, toolName: string, preview: string): ChatMessage {
  return {
    id,
    role: "tool",
    content: JSON.stringify({ command: preview }),
    toolName,
    toolPreview: preview,
  };
}

function renderPane(overrides: Partial<ChatPaneProps> = {}) {
  const onSend = vi.fn();
  const props: ChatPaneProps = {
    title: "Refonte du fil",
    model: "deepseek-v4",
    folder: "C:/Bureau/Dev/hermes-cockpit",
    messages: [],
    toolCount: 0,
    streaming: false,
    error: null,
    onSend,
    onStop: vi.fn(),
    ...overrides,
  };
  const view = render(<ChatPane {...props} />);
  return { ...view, props, onSend };
}

describe("ChatPane — navigation", () => {
  it("n'affiche pas de retour quand on est sur une conversation principale", () => {
    const { container } = renderPane({});
    expect(container.querySelector(".chat__back")).toBeNull();
  });

  it("affiche un retour vers la conversation parente pour un sous-agent", () => {
    const onBackToParent = vi.fn();
    const { container } = renderPane({ onBackToParent, parentTitle: "Plan GUI" });
    const back = container.querySelector(".chat__back");
    expect(back).not.toBeNull();
    // Le titre du parent sert d'infobulle.
    expect(back?.getAttribute("title")).toContain("Plan GUI");
    fireEvent.click(back as Element);
    expect(onBackToParent).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPane — contrôles du composer", () => {
  it("garde la barre d'effort compacte dans la barre du bas, à côté d'Ultracode", () => {
    const { container } = renderPane({ effort: "high", onEffortChange: vi.fn() });

    const effort = container.querySelector(".composer__effort");
    expect(effort).not.toBeNull();
    // Le porteur veut la barre PETITE à côté du bouton Ultracode (elle grossit
    // au survol via le CSS), pas sur une ligne à part.
    const bar = container.querySelector(".composer__bar");
    expect(bar?.querySelector(".composer__effort")).not.toBeNull();
    expect(bar?.querySelector(".ultracode")).not.toBeNull();
    // C'est toujours un curseur accessible.
    expect(container.querySelector('.composer__effort [role="slider"]')).not.toBeNull();
  });

  it("expose le niveau courant pour l'animation de scintillement", () => {
    const { container } = renderPane({ effort: "ultra", onEffortChange: vi.fn() });
    expect(container.querySelector('.composer__effort')?.getAttribute("data-level")).toBe("ultra");
  });
});

describe("ChatPane — bulles", () => {
  it("aligne le message utilisateur à droite avec data-role=user", () => {
    renderPane({ messages: [userMessage("u1", "Bonjour Hermes")] });

    const bubble = screen.getByText("Bonjour Hermes").closest("article");
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute("data-role", "user");
    expect(bubble).toHaveClass("bubble", "bubble--right");
    expect(bubble?.closest(".messages")).not.toBeNull();
  });

  it("aligne la réponse de l'assistant à gauche", () => {
    renderPane({ messages: [assistantMessage("a1", "Voilà le plan.")] });

    const bubble = screen.getByText("Voilà le plan.").closest("article");
    expect(bubble).toHaveAttribute("data-role", "assistant");
    expect(bubble).toHaveClass("bubble", "bubble--left");
  });

  it("n'affiche pas le thinking en clair dans la bulle de réponse", () => {
    renderPane({
      messages: [userMessage("u1", "Explique"), assistantMessage("a1", "Réponse", "je pèse les options")],
    });

    const bubble = screen.getByText("Réponse").closest("article");
    expect(bubble).not.toBeNull();
    // Le thinking vit dans le bloc d'activité, jamais dans la bulle de réponse.
    expect(bubble?.textContent ?? "").not.toContain("je pèse les options");
    // Le bloc de thinking le plus récent est ouvert d'office : le texte est lisible.
    const thinking = document.querySelector(".activity__thinking");
    expect(thinking?.textContent).toContain("je pèse les options");
  });
});

describe("ChatPane — bloc d'activité", () => {
  const tour: ChatMessage[] = [
    userMessage("u1", "Refonds le fil"),
    toolMessage("t1", "read_file", "src/App.tsx"),
    toolMessage("t2", "search_files", "ChatPane"),
    toolMessage("t3", "apply_patch", "web/src/components/chat"),
    assistantMessage("a1", "C'est fait.", "je commence par lire les fichiers existants"),
  ];

  it("ouvre d'office le thinking le plus récent et annonce les outils", () => {
    renderPane({ messages: tour });

    const summary = screen.getByRole("button", { name: "3 outils · thinking" });
    // Ouvert d'office : le porteur doit voir ce que l'agent pense sans cliquer.
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(summary).toHaveTextContent("▾");

    expect(screen.getByText("je commence par lire les fichiers existants")).toHaveClass("activity__thinking");
    // La réponse reste visible, elle.
    expect(screen.getByText("C'est fait.")).toBeInTheDocument();
  });

  it("liste les outils et le thinking dans le bloc ouvert", () => {
    renderPane({ messages: tour });

    // Le bloc s'ouvre d'office pour montrer le thinking ; les outils y figurent.
    const summary = screen.getByRole("button", { name: "3 outils · thinking" });
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(summary).toHaveTextContent("▾");

    expect(screen.getByText("read file · src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("search files · ChatPane")).toBeInTheDocument();
    expect(screen.getByText("apply patch · web/src/components/chat")).toBeInTheDocument();
    expect(screen.getByText("je commence par lire les fichiers existants")).toHaveClass("activity__thinking");
  });

  it("se referme au clic même quand il est ouvert d'office", () => {
    renderPane({ messages: tour });

    const summary = screen.getByRole("button", { name: "3 outils · thinking" });
    // Un bloc ouvert d'office doit pouvoir être refermé : un clic suffit.
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".activity__thinking")).toBeNull();
    expect(screen.getByText("je commence par lire les fichiers existants")).toHaveClass("activity__peek");

    // Et se rouvrir au clic suivant.
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".activity__thinking")).not.toBeNull();
  });

  it("garde le singulier et ne compte que les outils du tour", () => {
    const messages: ChatMessage[] = [
      userMessage("u1", "Go"),
      toolMessage("t1", "ls", "web"),
      assistantMessage("a1", "ok", "lecture du dossier"),
    ];

    const activity = buildThread(messages).find((node) => node.kind === "activity");
    if (activity?.kind !== "activity") throw new Error("bloc d'activité attendu");
    expect(activity.tools).toEqual([{ id: "t1", label: "ls · web" }]);
    expect(activity.thinking).toBe("lecture du dossier");

    renderPane({ messages });
    expect(screen.getByRole("button", { name: "1 outil · thinking" })).toBeInTheDocument();
  });

  it("rattache le thinking seul à son propre tour, sans bulle vide", () => {
    const messages: ChatMessage[] = [
      userMessage("u1", "Question A"),
      assistantMessage("a1", "", "je réfléchis sans parler"),
      userMessage("u2", "Question B"),
      assistantMessage("a2", "Réponse B"),
    ];
    renderPane({ messages });

    const summaries = screen.getAllByRole("button", { name: /thinking/ });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveAccessibleName("thinking");
  });
});

describe("ChatPane — états", () => {
  it("affiche la bulle d'attente quand le flux tourne", () => {
    renderPane({ messages: [userMessage("u1", "Bonjour")], streaming: true, toolCount: 2 });

    const typing = screen.getByRole("status");
    expect(typing).toHaveClass("bubble", "bubble--left", "bubble--typing");
    expect(typing).toHaveAttribute("aria-label", "Hermes écrit · 2 outils");
    expect(typing.querySelectorAll(".typing__dot")).toHaveLength(3);
    // Le bouton stop remplace l'envoi pendant le flux.
    expect(screen.getByRole("button", { name: "Arrêter" })).toBeInTheDocument();
  });

  it("montre l'accueil de conversation quand il n'y a rien, et le bandeau d'erreur", () => {
    renderPane({ messages: [], error: "session occupée" });

    expect(screen.getByRole("heading", { name: /Qu'est-ce qu'on construit/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Envoi impossible");
    expect(screen.getByRole("alert")).toHaveTextContent("session occupée");
  });

  it("garde un en-tête lisible et le composer utilisable", () => {
    renderPane({ messages: [userMessage("u1", "Bonjour")] });

    // L'accueil et les options sont dans la barre latérale, pas dans l'en-tête :
    // l'en-tête ne garde que le titre de la conversation et le modèle.
    expect(screen.getByRole("heading", { name: "Refonte du fil" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accueil" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("/ commandes · Entrée envoyer · Maj+Entrée à la ligne")).toBeInTheDocument();
  });
});

describe("ChatPane — composer", () => {
  it("envoie avec Entrée et ne fait rien avec Maj+Entrée", () => {
    const { onSend } = renderPane();
    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "  explique le fil  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("explique le fil", []);
    expect(textarea).toHaveValue("");

    fireEvent.change(textarea, { target: { value: "deuxième ligne" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(textarea).toHaveValue("deuxième ligne");
  });

  it("n'envoie pas un brouillon vide", () => {
    const { onSend } = renderPane();
    const textarea = screen.getByRole("textbox");

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "trop tard" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

/* ── Collage d'images ────────────────────────────────────────────────────
 * Une capture collée dans le champ doit apparaître en vignette (data-URL) et
 * partir avec le message. jsdom fournit FileReader : le test lit la vraie
 * data-URL produite plutôt qu'une valeur inventée.
 */
function imageFile(name = "a.png", type = "image/png"): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])], name, { type });
}

function thumbImage(): HTMLImageElement | null {
  return document.querySelector<HTMLImageElement>(".thumb img");
}

describe("ChatPane — images collées", () => {
  it("affiche une vignette après collage puis envoie la data-URL avec le texte", async () => {
    const { onSend } = renderPane();
    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "regarde la capture" } });
    fireEvent.paste(textarea, { clipboardData: { files: [imageFile("a.png", "image/png")] } });

    await waitFor(() => expect(thumbImage()).not.toBeNull());
    const thumb = thumbImage();
    if (!thumb) throw new Error("vignette attendue");
    expect(thumb).toHaveAttribute("alt", "a.png");
    const dataUrl = thumb.getAttribute("src") ?? "";
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    // La vignette vit bien dans le bloc de vignettes du composer.
    expect(thumb.closest(".composer__thumbs")).not.toBeNull();
    expect(thumb.closest(".thumb")).not.toBeNull();

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    const [text, images] = onSend.mock.calls[0] as [string, string[]];
    expect(text).toBe("regarde la capture");
    expect(images).toEqual([dataUrl]);
    // Après envoi, le brouillon et les vignettes sont vidés.
    expect(textarea).toHaveValue("");
    expect(thumbImage()).toBeNull();
  });

  it("retire la vignette au clic sur le bouton ×", async () => {
    const { onSend } = renderPane();
    const textarea = screen.getByRole("textbox");

    fireEvent.paste(textarea, { clipboardData: { files: [imageFile()] } });
    await waitFor(() => expect(thumbImage()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Retirer a.png" }));

    expect(thumbImage()).toBeNull();
    // Plus de vignette ni de texte : le composer redevient vide, sans envoi.
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignore un fichier qui n'est pas une image", async () => {
    const { onSend } = renderPane();
    const textarea = screen.getByRole("textbox");

    fireEvent.change(textarea, { target: { value: "note" } });
    fireEvent.paste(textarea, {
      clipboardData: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] },
    });

    // Laisse passer une éventuelle lecture asynchrone avant de conclure.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(thumbImage()).toBeNull();
    expect(document.querySelector(".thumb")).toBeNull();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("note", []);
  });
});
