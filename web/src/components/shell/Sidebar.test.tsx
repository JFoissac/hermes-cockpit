import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { AgentSession } from "../../types/api";

const mk = (over: Partial<AgentSession>): AgentSession =>
  ({
    id: "s1",
    title: "Racine",
    origin: "Hermes",
    source: "local",
    message_count: 12,
    tool_call_count: 3,
    running: false,
    parent_session_id: null,
    last_activity_at: Date.now() / 1000,
    ...over,
  }) as AgentSession;

const parent = mk({ id: "p1", title: "Conversation" });
const child = mk({ id: "c1", title: "Sous-agent actif", parent_session_id: "p1" });

const renderSidebar = () =>
  render(
    <Sidebar
      sessions={[parent, child]}
      activeId={null}
      health={{ api: "ok", db: "ok", opencode: "ok" }}
      view="chat"
      onSelect={() => {}}
      onNew={() => {}}
      onView={() => {}}
      onHome={() => {}}
      onOpenOptions={() => {}}
    />
  );

describe("Sidebar — sous-agents", () => {
  it("affiche le sous-agent sous sa conversation", () => {
    renderSidebar();
    expect(screen.getByText("Sous-agent actif")).toBeTruthy();
  });

  it("le ferme au clic sur ×", () => {
    try {
      window.localStorage.removeItem("cockpit.dismissed-subagents");
    } catch {
      /* pas de stockage en test : sans importance */
    }
    renderSidebar();
    fireEvent.click(screen.getByLabelText("Masquer Sous-agent actif"));
    expect(screen.queryByText("Sous-agent actif")).toBeNull();
    expect(screen.getByText("Conversation")).toBeTruthy();
  });
});
