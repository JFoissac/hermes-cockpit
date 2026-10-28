import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AsciiBackground from "./components/ascii/AsciiBackground";
import Sidebar from "./components/shell/Sidebar";
import UltraOverlay from "./components/effects/UltraOverlay";
import SubagentAvatar from "./components/agents/SubagentAvatar";
import UltraRoster, { type UltraAgent } from "./components/effects/UltraRoster";
import type { EffortLevel } from "./components/chat/EffortBar";
import ChatPane, { type ChatMessage } from "./components/chat/ChatPane";
import PreviewPane from "./components/preview/PreviewPane";
import AgentsView from "./routes/AgentsView";
import Home from "./components/home/Home";
import OptionsDialog from "./components/settings/OptionsDialog";
import SkillsPanel from "./components/skills/SkillsPanel";
import { useTheme } from "./lib/theme";
import { useDismissedSubagents } from "./lib/dismissed";
import { createSession, lockModel, useChatStream, useHealth, useMessages, useModels, useSessions, useSubagents } from "./lib/api";
import type { ModelRef } from "./components/shell/ModelPicker";
import type { ChatEvent, MessageDelta } from "./types/api";

type View = "home" | "chat" | "agents";

/** Ligne /messages élargie : le serveur renvoie déjà `reasoning` et
    `tool_preview`, pas encore présents dans le contrat partagé `MessageDelta`
    (types/api.ts). On élargit localement au lieu de toucher au contrat. */
type MessageRow = MessageDelta & {
  reasoning?: string | null;
  tool_preview?: string | null;
};

/** ChatMessage + les deux champs optionnels que lit ChatPane. */
type ChatRow = ChatMessage & {
  reasoning?: string | null;
  toolPreview?: string | null;
};

const nonEmpty = (v: string | null | undefined): v is string => typeof v === "string" && v.trim().length > 0;

/** Sessions créées par le cockpit : elles seules acceptent nos envois. */
const KEY_COCKPIT_SESSIONS = "cockpit.sessions";

function loadCockpitSessions(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY_COCKPIT_SESSIONS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

const STATE_LABEL: Record<string, string> = {
  completed: "terminé",
  succeeded: "terminé",
  SUCCEEDED: "terminé",
  running: "en cours",
  RUNNING: "en cours",
  STARTING: "démarrage",
  PENDING: "en attente",
  failed: "échec",
  FAILED: "échec",
  cancelled: "annulé",
  CANCELLED: "annulé",
  INTERRUPTED: "interrompu",
  CANCEL_REQUESTED: "arrêt demandé",
  unknown: "état inconnu",
  UNKNOWN: "état inconnu",
};

const stateLabel = (state: string) => STATE_LABEL[state] ?? state;

function formatDuration(from: number, to: number | null): string {
  if (!to) return "en cours";
  const s = Math.max(0, Math.round(to - from));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export default function App() {
  const { data: health } = useHealth();
  const { data: sessions } = useSessions(60);
  const { data: subagents } = useSubagents();

  const [view, setView] = useState<View>("home");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [ownSessions, setOwnSessions] = useState<string[]>(loadCockpitSessions);
  // Message optimiste : `seen` = nombre de lignes déjà en base au moment de l'envoi.
  // Dès que la base en contient une de plus, l'optimiste disparaît (pas de doublon).
  const [notice, setNotice] = useState<string | null>(null);
  // Les trois tours Ultracode : état réel, affiché en pastilles + overlay.
  const [ultraAgents, setUltraAgents] = useState<UltraAgent[]>([]);
  // Largeur du panneau de droite (aperçu), réglable à la souris et mémorisée.
  // Largeur de la barre latérale, réglable à la souris et mémorisée.
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    Math.min(420, Math.max(200, Number(localStorage.getItem("cockpit.sidebarWidth")) || 264))
  );
  const sidebarDrag = useRef<{ startX: number; startW: number } | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const onSidebarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarDrag.current = { startX: event.clientX, startW: sidebarWidth };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture indisponible : le glissement marche quand même */
    }
  }, [sidebarWidth]);
  const onSidebarPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = sidebarDrag.current;
    if (!drag) return;
    setSidebarWidth(Math.min(420, Math.max(200, drag.startW + (event.clientX - drag.startX))));
  }, []);
  const onSidebarPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarDrag.current) return;
    sidebarDrag.current = null;
    localStorage.setItem("cockpit.sidebarWidth", String(sidebarWidthRef.current));
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
  }, []);

  const [railWidth, setRailWidth] = useState<number>(() =>
    Math.min(760, Math.max(280, Number(localStorage.getItem("cockpit.railWidth")) || 380))
  );
  const railDrag = useRef<{ startX: number; startW: number } | null>(null);
  const railWidthRef = useRef(railWidth);
  railWidthRef.current = railWidth;
  const onRailPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    railDrag.current = { startX: event.clientX, startW: railWidth };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture indisponible : le glissement marche quand même */
    }
  }, [railWidth]);
  const onRailPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = railDrag.current;
    if (!drag) return;
    const next = Math.min(760, Math.max(280, drag.startW + (drag.startX - event.clientX)));
    setRailWidth(next);
  }, []);
  const onRailPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!railDrag.current) return;
    railDrag.current = null;
    // On écrit d'abord, puis on libère la capture : releasePointerCapture peut
    // lever si le pointeur n'est plus capturé, et interromprait la sauvegarde.
    localStorage.setItem("cockpit.railWidth", String(railWidthRef.current));
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
  }, []);
  const ultraRunning = ultraAgents.some((a) => a.state === "running");
  const [liveUser, setLiveUser] = useState<{ text: string; seen: number; sessionId: string | null } | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveThinking, setLiveThinking] = useState("");
  const [liveAssistantSeen, setLiveAssistantSeen] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Thème (clair / sombre / système), popup d'options, modèle courant.
  const { theme, setTheme } = useTheme();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const providers = useModels();
  const [model, setModel] = useState<ModelRef | null>(null);
  // Effort de raisonnement envoyé avec chaque tour (l'API accepte
  // model_options.reasoning.effort : low…ultra).
  const [effort, setEffort] = useState<EffortLevel["id"]>(
    () => (localStorage.getItem("cockpit.effort") as EffortLevel["id"]) ?? "medium"
  );
  const changeEffort = useCallback((next: string) => {
    setEffort(next as EffortLevel["id"]);
    localStorage.setItem("cockpit.effort", next);
  }, []);

  useEffect(() => {
    if (model || providers.length === 0) return;
    const current = providers.find((p) => p.is_current) ?? providers[0];
    setModel({ provider: current.slug, model: current.models[0] ?? "" });
  }, [providers, model]);

  // Sélection par défaut : la session Hermes la plus récente (hors sous-agent).
  useEffect(() => {
    if (activeId || sessions.length === 0) return;
    const first =
      sessions.find((s) => s.origin === "Hermes" && !s.parent_session_id) ?? sessions[0];
    setActiveId(first.id);
  }, [sessions, activeId]);

  const { data: dbMessages } = useMessages(activeId);

  const active = useMemo(() => sessions.find((s) => s.id === activeId) ?? null, [sessions, activeId]);
  // Titre de la conversation dont dépend le sous-agent affiché (pour le retour).
  const parentTitle = useMemo(
    () =>
      active?.parent_session_id
        ? sessions.find((s) => s.id === active.parent_session_id)?.title ?? null
        : null,
    [active, sessions]
  );

  const onDelta = useCallback((text: string) => setLiveText((t) => t + text), []);
  const onReasoning = useCallback((text: string) => setLiveThinking((t) => t + text), []);
  const onEvent = useCallback((e: ChatEvent) => {
    if (e.event === "run.failed" || e.event === "run.cancelled") {
      setError(e.event === "run.cancelled" ? null : "le tour a échoué");
    }
  }, []);
  const { send, stop, streaming } = useChatStream(onDelta, onEvent, onReasoning);

  const history: ChatMessage[] = useMemo(() => {
    const rows = dbMessages as MessageRow[];
    return rows
      .filter((m) => {
        if (m.role !== "user" && m.role !== "assistant" && m.role !== "tool") return false;
        // Une ligne `tool` reste utile sans texte si le serveur fournit un
        // aperçu : c'est tout ce que la bulle affiche.
        if (m.role === "tool") return nonEmpty(m.content) || nonEmpty(m.tool_preview);
        // Une réponse peut ne porter que du raisonnement (tour d'outils) :
        // sans elle, le bloc d'activité resterait vide et le thinking invisible.
        return nonEmpty(m.content) || nonEmpty(m.reasoning);
      })
      .map((m): ChatRow => ({
        id: `db-${m.id}`,
        role: m.role as ChatMessage["role"],
        content: m.content ?? "",
        toolName: m.tool_name,
        reasoning: nonEmpty(m.reasoning) ? m.reasoning : null,
        toolPreview: nonEmpty(m.tool_preview) ? m.tool_preview : null,
      }));
  }, [dbMessages]);

  const counts = useMemo(
    () => ({
      user: history.filter((m) => m.role === "user").length,
      assistant: history.filter((m) => m.role === "assistant").length,
    }),
    [history]
  );

  const messages: ChatMessage[] = useMemo(() => {
    const out = [...history];
    // L'optimiste s'affiche dans la session visée tant que la base ne contient
    // pas la ligne. On compare le TEXTE, pas un compteur : une session neuve
    // repart de zéro et un compteur global ne veut plus rien dire.
    const inScope = liveUser !== null && (liveUser.sessionId === null || liveUser.sessionId === activeId);
    const landed =
      liveUser !== null &&
      history.some(
        (m) => m.role === "user" && (m.content ?? "").trim() === liveUser.text.trim()
      );
    if (liveUser !== null && inScope && !landed) {
      out.push({ id: "live-user", role: "user", content: liveUser.text });
    }
    if (liveText && counts.assistant <= liveAssistantSeen) {
      // Le thinking du tour en cours est rendu comme un bloc repliable au-dessus
      // de la réponse en train de s'écrire.
      out.push({
        id: "live-assistant",
        role: "assistant",
        content: liveText,
        reasoning: liveThinking || null,
      });
    } else if (liveThinking) {
      out.push({ id: "live-assistant", role: "assistant", content: "", reasoning: liveThinking });
    }
    return out;
  }, [history, liveUser, liveText, liveThinking, counts, liveAssistantSeen, activeId]);

  // La bulle optimiste n'est retirée que lorsque la ligne existe vraiment dans
  // la session visée (jamais sur un minuteur).
  useEffect(() => {
    if (!liveUser) return;
    if (liveUser.sessionId && liveUser.sessionId !== activeId) return;
    const landed = history.some(
      (m) => m.role === "user" && (m.content ?? "").trim() === liveUser.text.trim()
    );
    if (landed) {
      setLiveUser(null);
      setLiveText("");
    }
  }, [history, liveUser, activeId]);

  // Les messages d'information s'effacent d'eux-mêmes.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 9000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const rememberSession = useCallback((id: string) => {
    setOwnSessions((prev) => {
      const next = Array.from(new Set([id, ...prev])).slice(0, 50);
      localStorage.setItem(KEY_COCKPIT_SESSIONS, JSON.stringify(next));
      return next;
    });
  }, []);

  const newCockpitSession = useCallback(
    async (text: string) => {
      const created = await createSession(text.slice(0, 60) || "Nouvelle conversation");
      rememberSession(created.id);
      setActiveId(created.id);
      return created.id;
    },
    [rememberSession]
  );

  // La bulle optimiste disparaît quand la base a réellement enregistré le
  // message (le compteur d'utilisateur augmente), jamais sur un minuteur : un
  // tour lent la faisait disparaître au bout de 1,8 s sans que rien ne partît.
  useEffect(() => {
    if (liveUser && counts.user > liveUser.seen) {
      setLiveUser(null);
      setLiveText("");
    }
  }, [counts.user, liveUser]);

  // Un seul tour à la fois ; le texte tapé pendant que l'agent travaille est
  // mis en file et part dès la fin du tour courant.
  const queuedRef = useRef<string | null>(null);
  // Garde d'idempotence : une même soumission (Entrée + clic, double événement)
  // ne doit pas partir deux fois dans la même seconde.
  const lastSentRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const runTurn = useCallback(
    async (text: string, images: string[] = []) => {
      setError(null);
      setLiveUser({ text, seen: counts.user, sessionId: null });
      setLiveAssistantSeen(counts.assistant);
      setLiveText("");
      setLiveThinking("");
      try {
        // On écrit d'abord dans la conversation OUVERTE : c'est ce que le porteur
        // attend. Une session occupée par un autre tour refuse (400/409) : dans ce
        // seul cas on bascule sur une session neuve, avec un message explicite.
        // Une session du CLI n'accepte pas les tours de l'API (permission_denied) :
        // on la pilote par son propre transport (`hermes -z … --resume …`), donc
        // DANS la conversation ouverte, jamais dans une nouvelle.
        const activeSession = sessions.find((x) => x.id === activeId) ?? null;
        const transport = activeSession && activeSession.source !== "api_server" ? "cli" : "api";
        const target = activeId ?? (await newCockpitSession(text));
        if (transport === "cli") {
          setNotice("conversation du CLI · réponse via le CLI, quelques secondes");
        }
        setLiveUser({ text, seen: counts.user, sessionId: target });
        try {
          // Les images ne passent pas par le CLI : on le dit plutôt que de les perdre.
          if (transport === "cli" && images.length > 0) {
            setNotice("cette conversation passe par le CLI : image non transmise");
          }
          await send(target, text, images, transport, {
            provider: model?.provider,
            model: model?.model,
            effort,
          });
        } catch (e) {
          const status = (e as Error & { status?: number }).status;
          if (status === 400 || status === 409) {
            const fresh = await newCockpitSession(text);
            setError("conversation occupée : le message est parti dans une nouvelle session");
            await send(fresh, text, images, "api");
          } else {
            throw e;
          }
        }
      } catch (e) {
        const err = e as Error;
        // Un arrêt volontaire (bouton ■) n'est pas une erreur à afficher.
        if (err.name !== "AbortError" && !/aborted/i.test(err.message)) {
          setError(err.message);
        }
        setLiveUser(null);
        setLiveText("");
      }
    },
    [activeId, sessions, newCockpitSession, send, counts]
  );

  const handleSend = useCallback(
    async (text: string, images: string[] = []) => {
      const now = Date.now();
      if (lastSentRef.current.text === text && now - lastSentRef.current.at < 1500) {
        return; // double soumission du même message : on ignore
      }
      lastSentRef.current = { text, at: now };
      if (streaming) {
        queuedRef.current = text;
        return;
      }
      await runTurn(text, images);
    },
    [streaming, runTurn]
  );

  // File d'attente : dès que le tour en cours se termine, le message saisi
  // pendant ce temps part automatiquement.
  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;
  useEffect(() => {
    if (streaming) return;
    const next = queuedRef.current;
    if (!next) return;
    queuedRef.current = null;
    void runTurnRef.current(next);
  }, [streaming]);

  const handleStart = useCallback(
    async (text: string, chosenFolder: string | null) => {
      setError(null);
      setFolder(chosenFolder);
      setLiveUser({ text, seen: counts.user, sessionId: null });
      setLiveAssistantSeen(counts.assistant);
      setLiveText("");
      try {
        const id = await newCockpitSession(text);
        setLiveUser({ text, seen: 0, sessionId: id });
        setView("chat");
        await send(id, text);
      } catch (e) {
        setError((e as Error).message);
        setLiveUser(null);
        setLiveText("");
      }
    },
    [newCockpitSession, send, counts]
  );

  const handleNew = useCallback(async () => {
    setError(null);
    setLiveUser(null);
    setLiveText("");
    try {
      await newCockpitSession("Nouvelle conversation");
      setView("chat");
    } catch (e) {
      // Sans ce filet, un refus de l'API laissait le bouton sans effet visible.
      setError((e as Error).message);
    }
  }, [newCockpitSession]);

  // « Arrêter » coupe tous les tours en cours et éteint Ultracode : l'overlay ne
  // doit jamais survivre au travail qu'il illustre.
  const handleStop = useCallback(() => {
    stop();
    setUltraAgents([]);
    setNotice(null);
  }, [stop]);

  // Changer de conversation annule aussi Ultracode : les tours et l'animation
  // appartiennent à la conversation qu'on quitte.
  const previousActive = useRef<string | null>(null);
  useEffect(() => {
    if (previousActive.current && previousActive.current !== activeId) {
      stop();
      setUltraAgents([]);
    }
    previousActive.current = activeId;
  }, [activeId, stop]);

  // Ultracode : trois conversations en parallèle sur la même demande, avec des
  // rôles distincts — c'est réellement trois tours Hermes, pas une simulation.
  const handleUltracode = useCallback(
    async (text: string) => {
      const task = text.trim();
      if (!task) return;
      setNotice("Ultracode : 3 agents lancés en parallèle");
      const roles = [
        { suffix: "implémentation", prompt: "Tu es l'agent IMPLÉMENTATION. Produis la solution directement." },
        { suffix: "revue", prompt: "Tu es l'agent REVUE. Cherche les risques, les oublis et les erreurs de la solution." },
        { suffix: "vérification", prompt: "Tu es l'agent VÉRIFICATION. Propose les tests et les preuves d'exécution." },
      ];

      // Les identifiants sont calculés UNE fois : recalculer `Date.now()` dans la
      // boucle des envois produisait un autre horodatage quand la milliseconde
      // changeait entre les deux, et les pastilles restaient bloquées sur
      // « running » faute de retrouver leur entrée.
      const startedAt = Date.now();
      const agents = roles.map((role, index) => ({
        id: `ultra-${startedAt}-${index}`,
        label: role.suffix,
        state: "running" as const,
      }));

      // Chaque agent apparaît immédiatement en « running » : l'overlay et les
      // pastilles reflètent l'état réel des trois tours, pas une animation.
      setUltraAgents(agents);

      await Promise.all(
        roles.map(async (role, index) => {
          const id = agents[index].id;
          try {
            const created = await createSession(`${task.slice(0, 40)} · ${role.suffix}`);
            await send(created.id, `${role.prompt}\n\nTâche : ${task}`, [], "api", {
              provider: model?.provider,
              model: model?.model,
              effort,
            });
            setUltraAgents((prev) =>
              prev.map((a) => (a.id === id ? { ...a, state: "done" as const } : a))
            );
          } catch (e) {
            setUltraAgents((prev) =>
              prev.map((a) => (a.id === id ? { ...a, state: "error" as const, detail: "échec" } : a))
            );
            setError((e as Error).message);
          }
        })
      );
      setNotice(null);
    },
    [createSession, send, model, effort]
  );

  const handleModelChange = useCallback(
    async (next: ModelRef) => {
      setModel(next);
      if (activeId && ownSessions.includes(activeId)) {
        const ok = await lockModel(activeId, next.provider, next.model);
        if (!ok) setError("le modèle n'a pas pu être verrouillé sur cette session");
      }
    },
    [activeId, ownSessions]
  );

  const recentFolders = useMemo(() => {
    const seen = new Set<string>();
    for (const s of sessions) if (s.cwd) seen.add(s.cwd);
    return Array.from(seen).slice(0, 8);
  }, [sessions]);

  // Sous-agents DÉDIÉS à la conversation ouverte : ce sont les sessions enfants
  // (parent_session_id = session active), enrichies par la délégation correspondante.
  const [dismissedSubs, dismissSub] = useDismissedSubagents();

  const childSessions = useMemo(() => {
    if (!activeId) return [];
    return sessions
      .filter((s) => s.parent_session_id === activeId && !dismissedSubs.has(s.id))
      .sort((a, b) => Number(b.running) - Number(a.running) || (b.last_activity_at ?? 0) - (a.last_activity_at ?? 0));
  }, [sessions, activeId, dismissedSubs]);

  const delegationByParent = useMemo(() => {
    const m = new Map<string, (typeof subagents)[number]>();
    for (const d of subagents) if (!m.has(d.parent_id)) m.set(d.parent_id, d);
    return m;
  }, [subagents]);

  // Texte des 25 derniers messages : l'aperçu y cherche une URL locale à charger.
  const chatText = useMemo(
    () => messages.slice(-25).map((m) => m.content ?? "").join("\n"),
    [messages]
  );

  const toolCount = useMemo(() => {
    const idx = [...dbMessages].reverse().findIndex((m) => m.role === "user");
    if (idx < 0) return 0;
    return dbMessages.slice(dbMessages.length - idx).filter((m) => m.role === "tool").length;
  }, [dbMessages]);

  if (view === "home") {
    return (
      <>
        <AsciiBackground variant="lagoon" fit="cover" />
        <Home
          folders={recentFolders}
          health={health}
          busy={streaming}
          error={error}
          onStart={handleStart}
          onFullView={() => setView("chat")}
          onOpenOptions={() => setOptionsOpen(true)}
        />
        <OptionsDialog
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
          providers={providers}
          model={model}
          onModelChange={handleModelChange}
          folder={folder ?? ""}
          onFolderChange={setFolder}
          recentFolders={recentFolders}
        />
      </>
    );
  }

  return (
    <>
      <AsciiBackground variant="marine" fit="cover" />
      <div
        className="cockpit"
        data-rail="open"
        data-dim={view === "agents" ? "soft" : messages.length > 0 ? "full" : "none"}
        style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr) ${railWidth}px` }}
      >
        <Sidebar
          sessions={sessions}
          activeId={activeId}
          health={health}
          view={view}
          onSelect={(id) => { setActiveId(id); setView("chat"); }}
          onNew={handleNew}
          onView={setView}
          onHome={() => { setView("home"); setError(null); }}
          onOpenOptions={() => setOptionsOpen(true)}
        />

        <div
          className="sidebar__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la barre latérale"
          title="Glisser pour élargir les conversations · double-clic pour revenir"
          onPointerDown={onSidebarPointerDown}
          onPointerMove={onSidebarPointerMove}
          onPointerUp={onSidebarPointerUp}
          onPointerCancel={onSidebarPointerUp}
          onDoubleClick={() => {
            setSidebarWidth(264);
            localStorage.setItem("cockpit.sidebarWidth", "264");
          }}
        />
        <div
          className="sidebar__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la barre latérale"
          title="Glisser pour élargir les conversations · double-clic pour revenir"
          onPointerDown={onSidebarPointerDown}
          onPointerMove={onSidebarPointerMove}
          onPointerUp={onSidebarPointerUp}
          onPointerCancel={onSidebarPointerUp}
          onDoubleClick={() => {
            setSidebarWidth(264);
            localStorage.setItem("cockpit.sidebarWidth", "264");
          }}
        />
        {view === "chat" ? (
          <ChatPane
            title={active?.title ?? null}
            model={model?.model ?? active?.model ?? null}
            folder={folder ?? active?.cwd ?? null}
            messages={messages}
            toolCount={toolCount}
            streaming={streaming}
            sessionBusy={Boolean(active?.running)}
            notice={notice}
            error={error}
            onSend={handleSend}
            providers={providers}
            modelRef={model}
            onModelChange={handleModelChange}
            effort={effort}
            onEffortChange={changeEffort}
            onUltracode={(text) => void handleUltracode(text)}
            onStop={handleStop}
            onBackToParent={
              active?.parent_session_id
                ? () => setActiveId(active.parent_session_id as string)
                : undefined
            }
            parentTitle={parentTitle}
          />
        ) : (
          <AgentsView />
        )}

        <UltraOverlay active={ultraRunning} label="Ultracode · 3 agents en parallèle" />
        {ultraAgents.length > 0 && (
          <div className="ultra-roster-slot">
            <UltraRoster
              agents={ultraAgents}
              onOpen={() => {
                setUltraAgents([]);
                setView("chat");
              }}
            />
          </div>
        )}
        <div
          className="rail__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner le panneau"
          title="Glisser pour élargir l'aperçu · double-clic pour revenir"
          onPointerDown={onRailPointerDown}
          onPointerMove={onRailPointerMove}
          onPointerUp={onRailPointerUp}
          onPointerCancel={onRailPointerUp}
          onDoubleClick={() => {
            setRailWidth(380);
            localStorage.setItem("cockpit.railWidth", "380");
          }}
        />
        <aside className="rail">
          <section className="rail__section rail__section--agents">
            <div className="rail__title">
              <span>Agents de cette conversation</span>
              <span className="mono">{childSessions.length}</span>
            </div>
            {childSessions.length === 0 ? (
              <p className="empty">
                Aucun sous-agent pour cette conversation.
                <br />
                Les agents lancés ici apparaîtront en dessous, en direct.
              </p>
            ) : (
              childSessions.slice(0, 10).map((child) => {
                const delegation = delegationByParent.get(child.id);
                const goal = delegation?.goal ?? child.title ?? child.id.slice(0, 12);
                return (
                  <div className="sub-wrap" key={child.id}>
                  <button
                    className="sub"
                    title={`${goal}\n${child.message_count} messages · ${child.tool_call_count} outils`}
                    onClick={() => { setActiveId(child.id); setView("chat"); }}
                  >
                    <span className="sub__head">
                      <SubagentAvatar
                        seed={child.id}
                        title={goal}
                        state={child.running ? "running" : "done"}
                        size={18}
                      />
                      <span className="sub__goal">{goal}</span>
                    </span>
                    <span className="sub__meta">
                      <span className="badge" data-state={delegation?.state ?? (child.running ? "running" : "completed")}>
                        {stateLabel(delegation?.state ?? (child.running ? "running" : "completed"))}
                      </span>
                      <span className="mono">
                        {delegation
                          ? formatDuration(delegation.dispatched_at, delegation.completed_at)
                          : `${child.message_count} msg`}
                      </span>
                    </span>
                  </button>
                  <button
                    className="sub__dismiss"
                    title="Masquer ce sous-agent"
                    aria-label={`Masquer ${goal}`}
                    onClick={(e) => { e.stopPropagation(); dismissSub(child.id); }}
                  >
                    ×
                  </button>
                  </div>
                );
              })
            )}
          </section>

          <section className="rail__section rail__section--grow">
            <PreviewPane sessionId={activeId} chatText={chatText} />
          </section>

          <section className="rail__section rail__section--skills">
            <SkillsPanel sessionId={activeId} />
          </section>

          {error && (
            <section className="rail__section">
              <p className="empty" style={{ color: "var(--err)" }}>{error}</p>
            </section>
          )}
        </aside>

        <OptionsDialog
          open={optionsOpen}
          onClose={() => setOptionsOpen(false)}
          theme={theme}
          onThemeChange={setTheme}
          providers={providers}
          model={model}
          onModelChange={handleModelChange}
          folder={folder ?? ""}
          onFolderChange={setFolder}
          recentFolders={recentFolders}
        />
      </div>
    </>
  );
}
