import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../lib/base";

export interface DevicePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: "desktop", label: "Desktop", width: 1280, height: 800, dpr: 1 },
  { id: "iphone15", label: "iPhone 15", width: 390, height: 844, dpr: 3 },
  { id: "pixel8", label: "Pixel 8", width: 412, height: 915, dpr: 2.6 },
  { id: "ipadmini", label: "iPad mini", width: 744, height: 1133, dpr: 2 },
];

const STORAGE_KEY = "cockpit.preview.url";

/** Dernière URL locale citée dans un texte (localhost / 127.0.0.1).
 *
 * La frontière de host est explicite : « http://localhost.evil.io » est un
 * domaine externe et ne doit jamais être chargé dans l'aperçu.
 */
export function lastLocalUrl(text: string): string | null {
  const matches = text.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?![\w.-])(?:\/[^\s"'`)]*)?/gi
  );
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1].replace(/[.,;:]+$/, "");
  // Garde-fou supplémentaire : le host doit être exactement local, pas un préfixe.
  try {
    const host = new URL(last).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return last;
}

interface Props {
  sessionId: string | null;
  /** Texte de la conversation : une URL locale citée est chargée automatiquement. */
  chatText?: string;
}

/**
 * Aperçu d'une webapp dans un cadre d'appareil. Sert aussi de « vue mobile » :
 * une webapp responsive se valide ici, sans émulateur.
 *
 * L'URL se remplit toute seule : d'abord une URL locale citée dans le chat,
 * sinon le serveur de développement détecté par le service Rust (sondage des
 * ports usuels), pour que l'aperçu s'ouvre dès que le serveur de l'app tourne.
 */
export default function PreviewPane({ sessionId, chatText = "" }: Props) {
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [preset, setPreset] = useState<DevicePreset>(DEVICE_PRESETS[0]);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<"auto" | "manuel" | "chat" | "detecte">("auto");
  // Compteur de rechargement : la clé de l'iframe force un vrai rechargement
  // (setUrl avec la même valeur ne redessine pas le cadre).
  const [reloadKey, setReloadKey] = useState(0);
  // Incrémenté quand la conversation change : relance la détection.
  const [tick, setTick] = useState(0);
  // Projet reconnu dans la conversation : affiché pour qu'on sache quelle app
  // on regarde (et pas celle d'un autre projet).
  const [project, setProject] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(320);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, url);
    setLoaded(false);
  }, [url]);

  // Le cadre occupe toute la largeur disponible du rail.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageWidth(el.clientWidth || 320));
    ro.observe(el);
    setStageWidth(el.clientWidth || 320);
    return () => ro.disconnect();
  }, []);

  // 1. Une URL locale citée dans la conversation est chargée d'office.
  useEffect(() => {
    const found = lastLocalUrl(chatText);
    if (!found) return;
    setUrl((prev) => (prev === found ? prev : found));
    setSource("chat");
  }, [chatText]);

  // 2. Sinon on demande au service Rust quel serveur de dev répond.
  useEffect(() => {
    let alive = true;
    const probe = async () => {
      try {
        // On transmet le texte de la conversation : le service y reconnaît le
        // projet dont on parle et ne renvoie que SON serveur, pas celui d'un
        // autre projet qui écoute sur un port usuel.
        const params = new URLSearchParams();
        if (sessionId) params.set("session_id", sessionId);
        if (chatText) params.set("hint", chatText.slice(-4000));
        const qs = params.toString();
        const res = await fetch(apiUrl(`/api/preview/detect${qs ? `?${qs}` : ""}`));
        if (!res.ok) return;
        const data = (await res.json()) as { url: string | null; source?: string; project?: string | null };
        if (!alive) return;
        if (data.project) {
          setProject(data.project.split(/[\\/]/).filter(Boolean).pop() ?? null);
        }
        if (!data.url) return;
        // Une URL saisie à la main n'est jamais écrasée. En revanche, la
        // détection PAR PROJET prime sur une URL citée dans le chat : celle-ci
        // peut venir d'un autre projet discuté plus tôt.
        if (source === "manuel") return;
        const next = data.url;
        setUrl((prev) => (prev === next ? prev : next));
        setSource((prev) => (prev === "manuel" ? prev : data.source === "fallback" ? "manuel" : "detecte"));
      } catch {
        /* pas de serveur détecté : on garde l'URL courante */
      }
    };
    void probe();
    const timer = window.setInterval(probe, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId, source, tick]);

  // Une nouvelle réplique peut citer un autre projet : on relance la sonde, avec
  // un court délai pour ne pas lancer PowerShell à chaque message.
  const firstChat = useRef(true);
  useEffect(() => {
    if (firstChat.current) {
      firstChat.current = false;
      return;
    }
    const t = window.setTimeout(() => setTick((n) => n + 1), 2500);
    return () => window.clearTimeout(t);
  }, [chatText]);

  // Le cadre tient dans la largeur du rail, sans dépasser 55 %.
  const scale = Math.min(0.55, Math.max(0.18, (stageWidth - 4) / preset.width));

  return (
    <div className="preview">
      <div className="rail__title">
        <span>Aperçu</span>
        <span className="mono preview__origin" title={project ? `projet : ${project}` : undefined}>
          {project ?? (source === "chat" ? "chat" : source === "manuel" ? "manuel" : source === "detecte" ? "auto" : "—")}
        </span>
      </div>

      <input
        className="mono preview__url"
        placeholder="URL de la webapp — ex. http://127.0.0.1:3000"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setSource("manuel");
        }}
        spellCheck={false}
      />

      <div className="preview__tabs" role="tablist" aria-label="Appareil">
        {DEVICE_PRESETS.map((p) => (
          <button
            key={p.id}
            role="tab"
            className="preview__tab"
            aria-selected={p.id === preset.id}
            onClick={() => setPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="preview__stage" ref={stageRef}>
        {url ? (
          <div
            className="preview__frame"
            style={{
              width: Math.round(preset.width * scale),
              height: Math.round(preset.height * scale),
              position: "relative",
            }}
          >
            <iframe
              key={reloadKey}
              title="Aperçu de la webapp"
              src={url}
              style={{
                width: preset.width,
                height: preset.height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              onLoad={() => setLoaded(true)}
            />
            {!loaded && <p className="preview__empty">chargement…</p>}
          </div>
        ) : (
          <p className="preview__empty">
            Aucun serveur détecté. Lance le serveur de ton app ou cite une URL locale dans le chat.
          </p>
        )}
      </div>

      <div className="composer__bar">
        <span className="composer__hint mono">
          {preset.width}×{preset.height} @{preset.dpr}x · {Math.round(scale * 100)}%
        </span>
        <button
          className="icon-btn"
          title="Recharger l'aperçu"
          aria-label="Recharger l'aperçu"
          onClick={() => {
            setLoaded(false);
            setReloadKey((k) => k + 1);
          }}
        >
          ⟳
        </button>
      </div>
    </div>
  );
}
