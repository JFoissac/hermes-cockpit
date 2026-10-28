import type { CSSProperties } from "react";
import "./UltraRoster.css";

export type UltraAgentState = "running" | "done" | "error";

export interface UltraAgent {
  id: string;
  label: string;
  state: UltraAgentState;
  detail?: string;
}

export interface UltraRosterProps {
  agents: UltraAgent[];
  onOpen?: (id: string) => void;
}

/** Libellé d'état lu par les lecteurs d'écran (français, comme le reste de l'UI). */
const STATE_LABEL: Record<UltraAgentState, string> = {
  running: "en cours",
  done: "terminé",
  error: "en erreur",
};

/** Initiale de l'agent : première lettre utile du libellé, « ? » si vide. */
function initialOf(label: string): string {
  const first = label.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

/** Décalage d'apparition en cascade, exposé au CSS via une variable. */
function chipStyle(index: number): CSSProperties {
  return { "--ultra-i": index } as CSSProperties;
}

export default function UltraRoster({ agents, onOpen }: UltraRosterProps): JSX.Element | null {
  if (agents.length === 0) return null;

  return (
    <ul className="ultra-roster" aria-label="Agents Ultracode">
      {agents.map((agent, index) => {
        const state = STATE_LABEL[agent.state] ?? agent.state;
        const detail = agent.detail?.trim();

        return (
          <li key={agent.id} className="ultra-roster__item">
            <button
              type="button"
              className="ultra-roster__chip"
              data-state={agent.state}
              style={chipStyle(index)}
              aria-label={`${agent.label} — ${state}`}
              title={detail ? `${agent.label} — ${state} · ${detail}` : `${agent.label} — ${state}`}
              onClick={() => onOpen?.(agent.id)}
            >
              <span className="ultra-roster__glyph" aria-hidden="true">
                {initialOf(agent.label)}
              </span>

              <span className="ultra-roster__body">
                <span className="ultra-roster__label">{agent.label}</span>
                {detail && <span className="ultra-roster__detail mono">{detail}</span>}
              </span>

              <span className="ultra-roster__dot" data-state={agent.state} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
