import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  THEME_STORAGE_KEY,
  applyTheme,
  resolveTheme,
  systemTheme,
  useTheme,
  type ThemeMode,
} from "./theme";

/* ── Stub matchMedia ──────────────────────────────────────────────────── */

type Listener = (event: MediaQueryListEvent) => void;

function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();

  const mql = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_: string, cb: Listener) => void listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => void listeners.delete(cb),
    addListener: (cb: Listener) => void listeners.add(cb),
    removeListener: (cb: Listener) => void listeners.delete(cb),
    dispatchEvent: () => true,
  };

  vi.stubGlobal("matchMedia", vi.fn(() => mql));

  return {
    set(next: boolean) {
      dark = next;
      const event = { matches: dark, media: mql.media } as MediaQueryListEvent;
      act(() => {
        listeners.forEach((cb) => cb(event));
      });
    },
    listenerCount: () => listeners.size,
  };
}

/** Composant sonde : expose l'état du hook et deux boutons de pilotage. */
function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return createElement(
    "div",
    null,
    createElement("span", { "data-testid": "state" }, `${theme}|${resolved}`),
    createElement("button", { onClick: () => setTheme("dark") }, "sombre"),
    createElement("button", { onClick: () => setTheme("system") }, "système"),
  );
}

const dataTheme = () => document.documentElement.getAttribute("data-theme");

/** Stockage mémoire : le localStorage de jsdom n'est pas exploitable ici. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setThemeStorage(value: ThemeMode) {
  window.localStorage.setItem(THEME_STORAGE_KEY, value);
}

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("thème", () => {
  it("démarre en « system » et suit matchMedia (sombre)", () => {
    installMatchMedia(true);
    render(createElement(Probe));

    expect(screen.getByTestId("state")).toHaveTextContent("system|dark");
    expect(dataTheme()).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("démarre en « system » et résout clair quand le système est clair", () => {
    installMatchMedia(false);
    render(createElement(Probe));

    expect(screen.getByTestId("state")).toHaveTextContent("system|light");
    expect(dataTheme()).toBe("light");
  });

  it("setTheme('dark') applique l'attribut et persiste le choix", () => {
    const mm = installMatchMedia(false);
    render(createElement(Probe));

    fireEvent.click(screen.getByRole("button", { name: "sombre" }));

    expect(screen.getByTestId("state")).toHaveTextContent("dark|dark");
    expect(dataTheme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // Le mode explicite ignore les changements système.
    mm.set(false);
    expect(screen.getByTestId("state")).toHaveTextContent("dark|dark");
    expect(dataTheme()).toBe("dark");
  });

  it("revient à « system » et suit de nouveau matchMedia", () => {
    const mm = installMatchMedia(true);
    render(createElement(Probe));

    fireEvent.click(screen.getByRole("button", { name: "sombre" }));
    fireEvent.click(screen.getByRole("button", { name: "système" }));

    expect(screen.getByTestId("state")).toHaveTextContent("system|dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");

    mm.set(false);
    expect(screen.getByTestId("state")).toHaveTextContent("system|light");
    expect(dataTheme()).toBe("light");

    mm.set(true);
    expect(screen.getByTestId("state")).toHaveTextContent("system|dark");
    expect(dataTheme()).toBe("dark");
  });

  it("relit le mode persisté au montage", () => {
    installMatchMedia(false);
    setThemeStorage("dark");
    render(createElement(Probe));

    expect(screen.getByTestId("state")).toHaveTextContent("dark|dark");
    expect(dataTheme()).toBe("dark");
  });

  it("ignore une valeur persistée invalide", () => {
    installMatchMedia(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    render(createElement(Probe));

    expect(screen.getByTestId("state")).toHaveTextContent("system|light");
  });

  it("applyTheme / resolveTheme / systemTheme restent purs et testables", () => {
    installMatchMedia(true);
    expect(systemTheme()).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");

    applyTheme("light");
    expect(dataTheme()).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });
});
