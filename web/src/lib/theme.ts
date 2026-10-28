import { useCallback, useEffect, useMemo, useState } from "react";

/** Mode choisi par l'utilisateur : explicite, ou délégué au système. */
export type ThemeMode = "light" | "dark" | "system";
/** Thème effectivement appliqué au document. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "cockpit.theme";
export const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

function isMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(SYSTEM_QUERY);
  } catch {
    return null;
  }
}

/** Préférence système courante ; clair si l'API est indisponible (SSR, jsdom nu). */
export function systemTheme(): ResolvedTheme {
  return mediaQuery()?.matches ? "dark" : "light";
}

/** Résout un mode en thème concret, sans effet de bord. */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? systemTheme() : mode;
}

/** Applique le thème résolu sur <html> (attribut lu par theme.css). */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

/** Mode persisté, « system » par défaut (localStorage absent ou corrompu). */
export function readStoredTheme(): ThemeMode {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export interface UseThemeResult {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
}

/**
 * Thème du cockpit. Persiste le mode choisi dans localStorage et suit
 * prefers-color-scheme tant que le mode reste « system ».
 */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());
  const [system, setSystem] = useState<ResolvedTheme>(() => systemTheme());

  useEffect(() => {
    const mq = mediaQuery();
    if (!mq) return;
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    // Safari < 14
    if (typeof mq.addListener === "function") {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
    return;
  }, []);

  const resolved: ResolvedTheme = theme === "system" ? system : theme;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* stockage plein ou bloqué : le thème reste valable pour la session */
    }
  }, []);

  return useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
}
