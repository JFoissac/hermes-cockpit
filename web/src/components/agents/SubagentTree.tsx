import type { ReactNode } from "react";
import type { Subagent } from "../../types/api";
import { useDismissedSubagents } from "../../lib/dismissed";
import SubagentAvatar from "./SubagentAvatar";

/** Durée lisible : 12s, 3m20s, 1h05m. "—" tant que le sous-agent n'est pas terminé. */
export function formatDuration(from: number, to: number | null): string {
  if (to === null || !Number.isFinite(to)) return "—";
  const total = Math.max(0, Math.round(to - from));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}m`;
}

interface Props {
  subagents: Subagent[];
  /** Ne rendre que les descendants de cet id (session ou sous-agent). */
  rootId?: string | null;
  /** Passer null pour ne rien rendre au lieu du message vide. */
  emptyLabel?: string | null;
}

const EMPTY_LABEL = "Aucun sous-agent actif.";

export default function SubagentTree({ subagents, rootId, emptyLabel = EMPTY_LABEL }: Props) {
  // Un sous-agent fermé à la main disparaît ici comme dans la barre latérale.
  const [dismissed, dismiss] = useDismissedSubagents();
  const visibleSubagents = subagents.filter((sub) => !dismissed.has(sub.id));

  const childrenByParent = new Map<string, Subagent[]>();
  for (const sub of visibleSubagents) {
    const siblings = childrenByParent.get(sub.parent_id);
    if (siblings) siblings.push(sub);
    else childrenByParent.set(sub.parent_id, [sub]);
  }

  const ids = new Set(visibleSubagents.map((sub) => sub.id));
  const roots =
    rootId != null
      ? childrenByParent.get(rootId) ?? []
      : visibleSubagents.filter((sub) => !ids.has(sub.parent_id));

  if (roots.length === 0) {
    return emptyLabel ? <p className="empty">{emptyLabel}</p> : null;
  }

  const renderNodes = (nodes: Subagent[], depth: number, seen: Set<string>): ReactNode =>
    nodes.map((node) => {
      if (seen.has(node.id)) return null;
      const nextSeen = new Set(seen);
      nextSeen.add(node.id);
      const children = childrenByParent.get(node.id) ?? [];
      return (
        <li
          key={node.id}
          className="subtree__node"
          data-depth={depth}
          style={depth > 0 ? { marginLeft: 14 } : undefined}
        >
          <div className="subtree__row">
            <SubagentAvatar
              seed={node.id}
              title={node.goal}
              state={node.state === "running" ? "running" : node.state === "failed" ? "error" : "done"}
              size={18}
            />
            <span className="badge" data-state={node.state}>
              {node.state}
            </span>
            <span className="subtree__goal" title={node.goal}>
              {node.goal}
            </span>
            <span className="subtree__dur mono" title="dispatched → completed">
              {formatDuration(node.dispatched_at, node.completed_at)}
            </span>
            <button
              type="button"
              className="subtree__dismiss"
              title="Masquer ce sous-agent"
              aria-label={`Masquer ${node.goal}`}
              onClick={(e) => {
                e.stopPropagation();
                dismiss(node.id);
              }}
            >
              ×
            </button>
          </div>
          {children.length > 0 && (
            <ul className="subtree">{renderNodes(children, depth + 1, nextSeen)}</ul>
          )}
        </li>
      );
    });

  return <ul className="subtree">{renderNodes(roots, 0, new Set())}</ul>;
}
