// Contrat de données partagé UI <-> serveur. NE PAS renommer sans mettre à jour
// crates observatory (Rust) et les composants.
export type SessionOrigin = "Hermes" | "OpenCode";

export interface AgentSession {
  id: string;
  title: string | null;
  source: string;
  model: string | null;
  parent_session_id: string | null;
  running: boolean;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  last_activity_at: number | null;
  cwd: string | null;
  git_branch: string | null;
  origin: SessionOrigin;
  preview: string | null;
}

export interface Subagent {
  id: string;
  parent_id: string;
  goal: string;
  state: string;
  dispatched_at: number;
  completed_at: number | null;
}

export interface MessageDelta {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  /** Thinking du modèle (null si absent). */
  reasoning?: string | null;
  /** Aperçu lisible des arguments de l'outil (≤180 car.), null si vide. */
  tool_preview?: string | null;
  timestamp: number;
}

export interface Health {
  api: "ok" | "down";
  db: "ok" | "down";
  opencode: "ok" | "down" | "unknown";
  apiDetail?: string;
}

export interface ChatEvent {
  event: string;
  data: Record<string, unknown>;
}
