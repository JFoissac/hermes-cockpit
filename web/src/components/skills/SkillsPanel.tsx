import { useEffect, useMemo, useState } from "react";
import "./skills.css";

/**
 * Skills vus par l'observatoire.
 *
 * Deux sources distinctes, deux budgets distincts :
 *  - « utilisés dans cette session » → `messages` de la session, re-pollé (10 s) ;
 *  - catalogue sur disque → chargé UNE fois (205 fichiers, ~40 ms côté serveur).
 */

export interface SkillEntry {
  name: string;
  description: string;
  category: string;
  path: string;
  has_skill_md: boolean;
}

export interface SkillUsage {
  name: string;
  count: number;
  last_used_ts: number;
}

const SESSION_POLL_MS = 10_000;

/** Filtre local du catalogue : nom + description, insensible à la casse. */
export function filterSkills(skills: SkillEntry[], q: string): SkillEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(needle) ||
      skill.description.toLowerCase().includes(needle)
  );
}

/** « il y a 3 min » depuis un timestamp unix en secondes. */
export function relativeTime(tsSeconds: number, nowMs: number = Date.now()): string {
  if (!tsSeconds || !Number.isFinite(tsSeconds)) return "date inconnue";
  const minutes = Math.floor(Math.max(0, nowMs - tsSeconds * 1000) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hier" : `il y a ${days} j`;
}

/** `datetime` ISO, ou `undefined` si le timestamp est inexploitable. */
export function isoDate(tsSeconds: number): string | undefined {
  if (!tsSeconds || !Number.isFinite(tsSeconds)) return undefined;
  const date = new Date(tsSeconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

/** Usage réel de la session courante ; re-pollé, jamais bloquant. */
function useSessionSkills(sessionId: string | null) {
  const [usage, setUsage] = useState<SkillUsage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setUsage([]);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;

    const tick = async () => {
      try {
        const data = await getJson<SkillUsage[]>(
          `/api/observatory/sessions/${encodeURIComponent(sessionId)}/skills`,
          ctrl.signal
        );
        if (!alive) return;
        setUsage(Array.isArray(data) ? data : []);
        setError(null);
      } catch (e) {
        if (alive && !ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void tick();
    const id = window.setInterval(tick, SESSION_POLL_MS);
    return () => {
      alive = false;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [sessionId]);

  return { usage, error };
}

/** Catalogue : une seule requête pour la durée de vie du panneau. */
function useSkillCatalogue() {
  const [catalogue, setCatalogue] = useState<SkillEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;

    (async () => {
      try {
        const data = await getJson<SkillEntry[]>("/api/observatory/skills", ctrl.signal);
        if (!alive) return;
        setCatalogue(Array.isArray(data) ? data : []);
        setError(null);
      } catch (e) {
        if (alive && !ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, []);

  return { catalogue, error, loading };
}

interface Props {
  sessionId: string | null;
}

export default function SkillsPanel({ sessionId }: Props) {
  const { usage, error: sessionError } = useSessionSkills(sessionId);
  const { catalogue, error: catalogueError, loading } = useSkillCatalogue();
  const [q, setQ] = useState("");
  // Le catalogue complet est replié par défaut : 226 lignes affichées en
  // permanence rendaient la colonne illisible. On ne montre que l'usage réel.
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => filterSkills(catalogue, q), [catalogue, q]);
  const now = Date.now();

  return (
    <section className="skills" aria-label="Skills">
      <div className="skills__zone" data-zone="session">
        <h3 className="skills__title">Utilisés dans cette session</h3>

        {!sessionId ? (
          <p className="empty">Aucune session sélectionnée.</p>
        ) : sessionError && usage.length === 0 ? (
          <p className="empty">Usage des skills illisible ({sessionError}).</p>
        ) : usage.length === 0 ? (
          <p className="empty">Aucun skill utilisé dans cette session</p>
        ) : (
          <ul className="skills-usage" aria-label="Skills utilisés dans cette session">
            {usage.map((skill) => (
              <li key={skill.name} className="skills-usage__item">
                <span className="skills-usage__name">{skill.name}</span>
                <span
                  className="badge skills-usage__count"
                  title={`${skill.count} appel(s) skill_view`}
                >
                  {skill.count}×
                </span>
                <time
                  className="skills-usage__time"
                  dateTime={isoDate(skill.last_used_ts)}
                >
                  {relativeTime(skill.last_used_ts, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="skills__zone" data-zone="catalogue">
        <button
          type="button"
          className="skills__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="skills__chev" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span>{`Tous les skills (${catalogue.length})`}</span>
        </button>

        {open && (
          <>
            <input
              className="skills__search"
              type="search"
              value={q}
              placeholder="Filtrer un skill…"
              aria-label="Filtrer les skills"
              onChange={(event) => setQ(event.target.value)}
            />

            {catalogueError ? (
              <p className="empty">Catalogue illisible ({catalogueError}).</p>
            ) : loading ? (
              <p className="empty">Lecture du catalogue…</p>
            ) : filtered.length === 0 ? (
              <p className="empty">Aucun skill ne correspond à « {q.trim()} ».</p>
            ) : (
              <ul className="skills-list" aria-label="Catalogue des skills">
                {filtered.map((skill) => (
                  <li key={skill.path} className="skills-list__item">
                    <span className="skills-list__name">{skill.name}</span>
                    <span className="skills-list__category">
                      {skill.category || "racine"}
                    </span>
                    {skill.description && (
                      <span className="skills-list__desc">{skill.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
