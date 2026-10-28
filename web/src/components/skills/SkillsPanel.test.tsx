import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SkillsPanel, {
  filterSkills,
  isoDate,
  relativeTime,
  type SkillEntry,
  type SkillUsage,
} from "./SkillsPanel";

const catalogue: SkillEntry[] = [
  {
    name: "animate",
    description: "Build an animation from scratch, deciding curve and duration.",
    category: "",
    path: "C:/hermes/skills/animate/SKILL.md",
    has_skill_md: true,
  },
  {
    name: "codex",
    description: "Delegate coding to OpenAI Codex CLI (features, PRs).",
    category: "autonomous-ai-agents",
    path: "C:/hermes/skills/autonomous-ai-agents/codex/SKILL.md",
    has_skill_md: true,
  },
  {
    name: "mediahub",
    description: "Use when working on MediaHub (Plex+*arr webapp).",
    category: "software-development",
    path: "C:/hermes/skills/software-development/mediahub/SKILL.md",
    has_skill_md: true,
  },
];

const usage: SkillUsage[] = [
  { name: "hermes-agent", count: 3, last_used_ts: 1_700_000_000 },
  { name: "mediahub", count: 1, last_used_ts: 1_700_000_120 },
];

let usagePayload: SkillUsage[] = usage;

function stubFetch() {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/skills?") || url.endsWith("/api/observatory/skills")) {
      return new Response(JSON.stringify(catalogue), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/observatory/sessions/")) {
      return new Response(JSON.stringify(usagePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("[]", { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("SkillsPanel", () => {
  beforeEach(() => {
    usagePayload = usage;
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rend les deux zones : usage de la session et catalogue complet", async () => {
    render(<SkillsPanel sessionId="20260812_181052_75448578" />);

    expect(screen.getByText("Utilisés dans cette session")).toBeInTheDocument();
    const toggle = await screen.findByRole("button", { name: /Tous les skills \(3\)/ });
    expect(toggle).toBeInTheDocument();
    // Replié par défaut (226 lignes ne doivent pas s'imposer) : on ouvre pour la suite.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    // Zone session : nom + badge de count + heure relative.
    const zoneSession = document.querySelector('[data-zone="session"]') as HTMLElement;
    await waitFor(() => expect(within(zoneSession).getByText("hermes-agent")).toBeInTheDocument());
    expect(within(zoneSession).getByText("3×")).toBeInTheDocument();
    expect(within(zoneSession).getByText("1×")).toBeInTheDocument();
    expect(within(zoneSession).getAllByText(/il y a \d+ (min|h|j)/).length).toBeGreaterThan(0);

    // Zone catalogue : une entrée par skill, catégorie en mono.
    const zoneCatalogue = document.querySelector('[data-zone="catalogue"]') as HTMLElement;
    await waitFor(() => expect(within(zoneCatalogue).getAllByRole("listitem")).toHaveLength(3));
    expect(within(zoneCatalogue).getByText("autonomous-ai-agents")).toBeInTheDocument();
    expect(within(zoneCatalogue).getByText("racine")).toBeInTheDocument();
  });

  it("affiche l'état vide quand la session n'a utilisé aucun skill", async () => {
    usagePayload = [];
    render(<SkillsPanel sessionId="session_sans_skill" />);

    await waitFor(() =>
      expect(screen.getByText("Aucun skill utilisé dans cette session")).toBeInTheDocument()
    );
    // Le catalogue reste affiché.
    expect(await screen.findByRole("button", { name: /Tous les skills \(3\)/ })).toBeInTheDocument();
  });

  it("ne demande l'usage que si une session est sélectionnée", async () => {
    const mock = stubFetch();
    render(<SkillsPanel sessionId={null} />);

    expect(screen.getByText("Aucune session sélectionnée.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Tous les skills \(3\)/ })).toBeInTheDocument()
    );
    const urls = mock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/sessions/"))).toBe(false);
  });

  it("filtre le catalogue en local sur le nom et la description", async () => {
    render(<SkillsPanel sessionId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: /Tous les skills \(3\)/ }));
    const search = screen.getByLabelText("Filtrer les skills");
    await waitFor(() => expect(screen.getByText("animate")).toBeInTheDocument());

    fireEvent.change(search, { target: { value: "OPENAI" } });
    const list = document.querySelector('[data-zone="catalogue"]') as HTMLElement;
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(within(list).getByText("codex")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzz" } });
    await waitFor(() =>
      expect(screen.getByText("Aucun skill ne correspond à « zzz ».")).toBeInTheDocument()
    );
  });

  it("replie le catalogue et le déplie sans le recharger", async () => {
    const mock = stubFetch();
    render(<SkillsPanel sessionId="s1" />);
    const toggle = await screen.findByRole("button", { name: /Tous les skills \(3\)/ });
    // Replié au départ : le filtre n'est pas monté.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Filtrer les skills")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Filtrer les skills")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Filtrer les skills")).not.toBeInTheDocument();

    // Le catalogue n'a été chargé qu'une fois.
    const catalogueCalls = mock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith("/api/observatory/skills"));
    expect(catalogueCalls).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("filterSkills ignore la casse et les espaces", () => {
    expect(filterSkills(catalogue, "  ANIM ").map((s) => s.name)).toEqual(["animate"]);
    expect(filterSkills(catalogue, "")).toHaveLength(3);
    expect(filterSkills(catalogue, "plex")).toHaveLength(1);
  });

  it("relativeTime formate minutes / heures / jours", () => {
    const now = 1_700_000_000_000;
    expect(relativeTime(1_700_000_000 - 0, now)).toBe("à l'instant");
    expect(relativeTime(1_700_000_000 - 180, now)).toBe("il y a 3 min");
    expect(relativeTime(1_700_000_000 - 2 * 3600, now)).toBe("il y a 2 h");
    expect(relativeTime(1_700_000_000 - 3 * 86_400, now)).toBe("il y a 3 j");
    expect(relativeTime(0, now)).toBe("date inconnue");
    expect(relativeTime(Number.NaN, now)).toBe("date inconnue");
  });

  it("isoDate ne jette pas sur un timestamp inexploitable", () => {
    expect(isoDate(1_700_000_000)).toBe(new Date(1_700_000_000_000).toISOString());
    expect(isoDate(0)).toBeUndefined();
    expect(isoDate(Number.NaN)).toBeUndefined();
  });
});
