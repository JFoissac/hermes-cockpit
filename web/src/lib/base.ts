/**
 * Base des appels à l'API locale.
 *
 * En développement, l'UI est servie par Vite, qui relaie `/api` vers le service
 * Rust : les chemins relatifs suffisent.
 *
 * Dans l'application packagée, la page vit sur `tauri://localhost` (ou
 * `http://tauri.localhost` sous Windows) : un `/api/...` relatif partirait dans
 * le protocole d'assets et ne joindrait jamais le service. On cible donc
 * explicitement le service local, qui autorise cette origine en CORS.
 */
const TAURI_ORIGINS = ["tauri:", "http://tauri.localhost", "https://tauri.localhost"];

/** Ports des serveurs qui servent l'UI et relaient déjà `/api`. */
const DEV_PORTS = new Set(["5183", "8791"]);

export const IS_TAURI =
  typeof window !== "undefined" &&
  (TAURI_ORIGINS.includes(window.location.protocol) ||
    TAURI_ORIGINS.includes(window.location.origin));

/**
 * La décision se prend sur le PORT plutôt que sur le protocole : les deux
 * serveurs (Vite 5183, service local 8791) en ont un, la webview Tauri non.
 * C'est ce qui rend le bundle packagé capable de joindre l'API locale.
 */
export const API_BASE =
  typeof window !== "undefined" && DEV_PORTS.has(window.location.port)
    ? ""
    : "http://127.0.0.1:8791";

/** URL absolue d'une route du service local (`/api/...`). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
