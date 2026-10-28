import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import PreviewPane, { lastLocalUrl } from "./PreviewPane";

const STORAGE_KEY = "cockpit.preview.url";

/* ── lastLocalUrl ────────────────────────────────────────────────────────
 * La fonction sert à repérer le serveur de dev cité par l'agent dans le fil.
 * Seules les URLs locales comptent : une doc externe ne doit jamais être
 * chargée dans l'iframe.
 */
describe("lastLocalUrl", () => {
  it("renvoie la dernière URL locale d'un texte qui en cite plusieurs", () => {
    const text = [
      "Le serveur tourne sur http://127.0.0.1:3000.",
      "Après le redémarrage : http://localhost:5173 — ouvre-la.",
    ].join(" ");

    expect(lastLocalUrl(text)).toBe("http://localhost:5173");
  });

  it("garde le port, le chemin et la requête de l'URL retenue", () => {
    expect(lastLocalUrl("voir http://127.0.0.1:5173/app?mode=dev et rien d'autre")).toBe(
      "http://127.0.0.1:5173/app?mode=dev"
    );
  });

  it("ignore les URLs externes", () => {
    const text = "La doc est sur https://example.com/docs et sur https://notlocalhost.io:8080/x";

    expect(lastLocalUrl(text)).toBeNull();
  });

  it("renvoie null quand le texte ne cite aucune URL locale", () => {
    expect(lastLocalUrl("")).toBeNull();
    expect(lastLocalUrl("aucun serveur mentionné ici")).toBeNull();
    expect(lastLocalUrl("http://10.0.0.1:5173")).toBeNull();
  });

  it("accepte une URL locale sans port ni chemin", () => {
    expect(lastLocalUrl("ouvre http://localhost maintenant")).toBe("http://localhost");
  });
});

/* ── Rendu ───────────────────────────────────────────────────────────────
 * jsdom n'a ni ResizeObserver ni pile réseau : on fournit un stub de mesure
 * et on mocke fetch pour contrôler la détection de serveur.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

/** jsdom/localStorage ne sont pas fiables ici : stockage mémoire minimal. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
  } as Storage;
}

function urlInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector(".preview__url");
  if (!(input instanceof HTMLInputElement)) throw new Error("champ .preview__url attendu");
  return input;
}

describe("PreviewPane — aperçu automatique", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("charge l'URL locale citée dans le chat et monte l'iframe", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <PreviewPane sessionId="s-1" chatText="J'ai lancé le serveur sur http://127.0.0.1:5173, regarde." />
    );

    await waitFor(() => expect(urlInput(container)).toHaveValue("http://127.0.0.1:5173"));

    const frame = screen.getByTitle("Aperçu de la webapp");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:5173");
    // L'origine de l'URL est affichée à côté du titre.
    expect(screen.getByText("chat")).toHaveClass("mono");
    expect(screen.queryByText(/Aucun serveur détecté/)).toBeNull();
    // L'URL retenue est mémorisée pour la prochaine ouverture de l'aperçu.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("http://127.0.0.1:5173");
  });

  it("affiche le message d'absence de serveur quand la détection ne renvoie rien", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: null }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<PreviewPane sessionId="s-2" />);

    expect(await screen.findByText(/Aucun serveur détecté/)).toHaveClass("preview__empty");
    expect(container.querySelector("iframe")).toBeNull();
    expect(urlInput(container)).toHaveValue("");

    // L'URL dépend de l'origine : chemin relatif en dev, absolue dans le bundle
    // packagé (base.ts). On vérifie la route, pas le préfixe.
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/preview/detect?session_id=s-2"));
    // Rien ne doit être persisté à la place d'une URL valide.
    await act(async () => {
      await Promise.resolve();
    });
    expect(urlInput(container)).toHaveValue("");
  });
});
