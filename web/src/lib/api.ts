import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSession, ChatEvent, Health, MessageDelta, Subagent } from "../types/api";
import { apiUrl } from "./base";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Polling simple : pas de websocket en V0, 2 s suffisent pour l'observatoire. */
export function usePolling<T>(path: string, intervalMs: number, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    const tick = async () => {
      try {
        const next = await getJson<T>(path, ctrl.signal);
        if (alive) { setData(next); setError(null); }
      } catch (e) {
        if (alive && !ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = window.setInterval(tick, intervalMs);
    return () => { alive = false; ctrl.abort(); window.clearInterval(id); };
  }, [path, intervalMs]);

  return { data, error };
}

export const useHealth = () => usePolling<Health>("/api/health", 5000, { api: "down", db: "down", opencode: "unknown" });
export const useSessions = (limit = 60) =>
  usePolling<AgentSession[]>(`/api/observatory/sessions?limit=${limit}`, 2000, []);
export const useSubagents = () => usePolling<Subagent[]>("/api/observatory/subagents", 2500, []);
export const useMessages = (sessionId: string | null) =>
  usePolling<MessageDelta[]>(
    sessionId ? `/api/observatory/sessions/${encodeURIComponent(sessionId)}/messages?after_id=0&limit=200&kinds=all` : "/api/observatory/noop",
    1500,
    []
  );

/**
 * Envoie un message et consomme le flux SSE renvoyé par le serveur.
 * Le serveur relaie celui de l'API Hermes (/api/sessions/{id}/chat/stream).
 */
export function useChatStream(
  onDelta: (text: string) => void,
  onEvent?: (e: ChatEvent) => void,
  onReasoning?: (text: string) => void
) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Ultracode lance plusieurs tours à la fois : « Arrêter » doit tous les couper.
  const controllersRef = useRef<Set<AbortController>>(new Set());

  const send = useCallback(
    async (
      sessionId: string,
      message: string,
      images: string[] = [],
      transport: "api" | "cli" = "api",
      options: { provider?: string; model?: string; effort?: string } = {}
    ) => {
      // On n'annule plus le tour précédent ici : c'est `stop()` qui le fait.
      // (L'annuler à l'entrée tuait la file d'attente et remontait « BodyStreamBuffer
      // was aborted » côté navigateur.)
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      controllersRef.current.add(ctrl);
      setStreaming(true);
      let timedOut = false;
      let watchdog: number | undefined;
      try {
        // Une session du CLI n'accepte pas les tours de l'API
        // (`permission_denied`) : on la pilote par son propre transport.
        const path = transport === "cli" ? "/api/cli/stream" : "/api/chat/stream";
        const res = await fetch(apiUrl(path), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            message,
            images,
            provider: options.provider,
            model: options.model,
            effort: options.effort,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // Le corps d'erreur amont est du JSON lisible : on le remonte tel quel.
          let detail = "";
          try {
            const text = await res.text();
            const parsed = JSON.parse(text) as { error?: { message?: string } | string };
            detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? text;
          } catch {
            /* corps vide */
          }
          const err = new Error(`${res.status} · ${detail.slice(0, 300)}`);
          (err as Error & { status?: number }).status = res.status;
          throw err;
        }
        if (!res.body) throw new Error("flux vide");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        // Chien de garde : un flux ouvert mais muet (session non pilotable par
        // l'API) laissait l'écran sans aucune activité. Au bout de 6 s sans un
        // octet, on remonte une erreur claire au lieu de tourner dans le vide.
        let gotByte = false;
        watchdog = window.setTimeout(() => {
          if (gotByte) return;
          timedOut = true;
          ctrl.abort();
        }, transport === "cli" ? 300_000 : 6_000);

        for (;;) {
          const { done, value } = await reader.read();
          if (value && value.length > 0 && !gotByte) {
            gotByte = true;
            window.clearTimeout(watchdog);
          }
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let eventName = "message";
            let dataLine = "";
            for (const line of frame.split("\n")) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataLine += line.slice(6);
            }
            if (!dataLine) continue;
            let parsed: Record<string, unknown> = {};
            try { parsed = JSON.parse(dataLine) as Record<string, unknown>; } catch { continue; }
            onEvent?.({ event: eventName, data: parsed });
            // Le thinking arrive sous forme de `tool.progress` avec le pseudo-outil
            // `_thinking` : on le sépare du texte de réponse.
            if (eventName === "tool.progress") {
              const name = String((parsed.tool_name as string) ?? "");
              const delta = String((parsed.delta as string) ?? "");
              if (name === "_thinking" && delta) onReasoning?.(delta);
            }
            // Commentaire d'étape (Codex) : s'il n'a pas déjà été streamé, on
            // l'affiche comme du texte d'assistant plutôt que de le perdre.
            if (eventName === "assistant.commentary" && parsed.already_streamed !== true) {
              const text = String((parsed.text as string) ?? "");
              if (text) onDelta(text);
            }
            if (eventName === "assistant.delta") {
              const t = (parsed.text ?? parsed.delta ?? "") as string;
              if (t) onDelta(t);
            }
          }
        }
      } catch (e) {
        if (timedOut) {
          throw new Error(
            transport === "cli"
              ? "le CLI n'a rien renvoyé en 5 min — la conversation est peut-être occupée ailleurs"
              : "le serveur n'a rien renvoyé en 6 s — vérifie que le service Hermes tourne"
          );
        }
        throw e;
      } finally {
        if (watchdog !== undefined) window.clearTimeout(watchdog);
        controllersRef.current.delete(ctrl);
        if (abortRef.current === ctrl) abortRef.current = null;
        // `streaming` ne retombe que si plus aucun tour ne tourne (Ultracode = 3).
        setStreaming(controllersRef.current.size > 0);
      }
    },
    [onDelta, onEvent]
  );

  /** Coupe TOUS les tours en cours (un seul normalement, trois en Ultracode). */
  const stop = useCallback(() => {
    for (const ctrl of controllersRef.current) ctrl.abort();
    controllersRef.current.clear();
    abortRef.current = null;
    setStreaming(false);
  }, []);
  return { send, stop, streaming };
}

/** Horodatage court : rend un titre de session unique. */
function stamp(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/**
 * Crée une session. L'API refuse un titre déjà utilisé (`invalid_title`, 400) :
 * on réessaie une fois avec un horodatage, sinon « Nouvelle session » échouait
 * en silence dès la deuxième fois et l'envoi d'un texte identique aussi.
 */
export async function createSession(title: string): Promise<AgentSession> {
  const clean = title.trim() || "Nouvelle conversation";
  const attempts = [clean, `${clean.slice(0, 48)} · ${stamp()}`];
  let last = 0;
  for (const candidate of attempts) {
    const res = await fetch(apiUrl("/api/sessions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: candidate }),
    });
    if (res.ok) {
      const json = (await res.json()) as { session: AgentSession };
      return json.session;
    }
    last = res.status;
    if (res.status !== 400) break;
  }
  throw new Error(`create session → ${last}`);
}

export interface ProviderModels {
  slug: string;
  name: string;
  models: string[];
  is_current: boolean;
}

/** Catalogue des modèles réel, servi par /api/models (relais de Hermes). */
export function useModels(): ProviderModels[] {
  const [providers, setProviders] = useState<ProviderModels[]>([]);
  useEffect(() => {
    let alive = true;
    fetch(apiUrl("/api/models"))
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data: { providers?: ProviderModels[] }) => {
        if (alive) setProviders(data.providers ?? []);
      })
      .catch(() => {
        if (alive) setProviders([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  return providers;
}

/** Verrouille le modèle d'une session côté Hermes. */
export async function lockModel(sessionId: string, provider: string, model: string): Promise<boolean> {
  const res = await fetch(apiUrl("/api/sessions/" + encodeURIComponent(sessionId) + "/model"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });
  return res.ok;
}
