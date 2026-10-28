import { useCallback, useEffect, useRef, useState } from "react";

import {
  DictationError,
  cancelRecording,
  dictationMessage,
  isRecording,
  isRecordingSupported,
  startRecording,
  stopRecording,
} from "../../lib/dictation";
import { apiUrl } from "../../lib/base";

/* ── Web Speech API (repli navigateur) ──────────────────────────────────
 * `lib.dom` of our TypeScript version does not ship SpeechRecognition yet, so
 * the slice we actually use is typed here instead of relying on `any`.
 *
 * Ce repli ne sert QUE dans un vrai navigateur : la WebView2 de Tauri
 * n'expose pas `webkitSpeechRecognition`, et c'est précisément pourquoi la
 * dictée passe par le moteur local (voir `lib/dictation.ts`).
 */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechErrorEvent {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Chrome/Safari expose the API under a prefix; Firefox has none. */
export function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Codes from the spec, in French, without inventing detail. */
const ERRORS: Record<string, string> = {
  "not-allowed": "Micro refusé par le navigateur",
  "service-not-allowed": "Dictée bloquée par le navigateur",
  "audio-capture": "Aucun micro détecté",
  "no-speech": "Aucune parole détectée",
  network: "Réseau indisponible pour la dictée",
  aborted: "Dictée interrompue",
  "language-not-supported": "Langue non prise en charge",
  "bad-grammar": "Grammaire refusée par le moteur",
  "start-failed": "Le micro n'a pas pu démarrer",
};

function frenchError(code: string): string {
  return ERRORS[code] ?? `Dictée impossible (${code})`;
}

/** Keeps the transcript readable when finals and interims meet. */
function joinWords(head: string, tail: string): string {
  return `${head} ${tail}`.replace(/\s+/g, " ").trim();
}

const STYLE = `
.cockpit-mic[data-state="listening"] { animation: cockpit-mic-pulse 1.1s ease-in-out infinite; }
.cockpit-mic[data-state="transcribing"] { opacity: 0.6; cursor: progress; }
@keyframes cockpit-mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .cockpit-mic[data-state="listening"] { animation: none; } }
`;

export type MicState = "idle" | "listening" | "transcribing" | "error";

export interface MicButtonProps {
  /**
   * Called with the transcript. `final` is false for interim results of the
   * browser engine (replace the draft) and true once a chunk is frozen — the
   * local engine only ever emits a final, whole-utterance result.
   */
  onTranscript: (text: string, final: boolean) => void;
  /** Language for the browser fallback; the local engine is multilingual. */
  language?: string;
  className?: string;
}

/**
 * Dictation button for the composer. Controlled: it owns the microphone and
 * emits text, the parent owns the textarea.
 *
 * Two engines, in this order:
 *
 * 1. the local one (`POST /api/dictation/transcribe` → sherpa-onnx Parakeet):
 *    click records, second click stops, uploads a 16 kHz mono WAV and emits the
 *    transcript. This is the only path that works in the Tauri webview;
 * 2. the browser's Web Speech API, when capturing audio is impossible but the
 *    recognizer exists (plain Chrome/Safari).
 *
 * With neither, the button is disabled and says so — it never simulates text.
 */
export default function MicButton({
  onTranscript,
  language = "fr-FR",
  className,
}: MicButtonProps) {
  const localSupported = isRecordingSupported();
  const Ctor = localSupported ? null : getRecognitionCtor();
  const supported = localSupported || Ctor !== null;

  const [state, setState] = useState<MicState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const erroredRef = useRef(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const callbackRef = useRef(onTranscript);

  useEffect(() => {
    callbackRef.current = onTranscript;
  }, [onTranscript]);

  const fail = useCallback((detail: string) => {
    if (!mountedRef.current) return;
    setMessage(detail);
    setState("error");
  }, []);

  /* ── moteur local ─────────────────────────────────────────────────── */

  const stopAndTranscribe = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState("transcribing");
    try {
      const audioBase64 = await stopRecording();
      const response = await fetch(apiUrl("/api/dictation/transcribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audio_base64: audioBase64, format: "wav" }),
      });

      // A failed request must never look like an empty transcript.
      const payload: unknown = await response.json().catch(() => null);
      const body = (payload ?? {}) as { text?: unknown; error?: unknown };
      if (!response.ok) {
        const detail =
          typeof body.error === "string" && body.error
            ? body.error
            : `Le service a répondu ${response.status}`;
        throw new Error(detail);
      }

      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new DictationError("empty");

      if (!mountedRef.current) return;
      setMessage(null);
      setState("idle");
      callbackRef.current(text, true);
    } catch (error) {
      fail(dictationMessage(error));
    } finally {
      busyRef.current = false;
    }
  }, [fail]);

  const startLocal = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await startRecording();
      if (!mountedRef.current) {
        cancelRecording();
        return;
      }
      setMessage(null);
      setState("listening");
    } catch (error) {
      fail(dictationMessage(error));
    } finally {
      busyRef.current = false;
    }
  }, [fail]);

  /* ── repli Web Speech ─────────────────────────────────────────────── */

  const stopListening = useCallback(() => {
    // `stop()` lets the engine flush its final result; `onend` returns to idle.
    recognitionRef.current?.stop();
  }, []);

  const startListening = useCallback(
    (Recognizer: SpeechRecognitionCtor) => {
      const recognition = new Recognizer();
      recognition.lang = language;
      recognition.continuous = true;
      recognition.interimResults = true;
      finalRef.current = "";
      erroredRef.current = false;
      setMessage(null);

      recognition.onresult = (event) => {
        let finalChunk = "";
        let interimChunk = "";
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result) continue;
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) finalChunk += transcript;
          else interimChunk += transcript;
        }

        if (finalChunk) {
          finalRef.current = joinWords(finalRef.current, finalChunk);
          callbackRef.current(finalRef.current, true);
        }
        if (interimChunk) {
          callbackRef.current(joinWords(finalRef.current, interimChunk), false);
        }
      };

      recognition.onerror = (event) => {
        erroredRef.current = true;
        setMessage(frenchError(event.error));
        setState("error");
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        // An error stays visible until the next attempt: `onend` always follows
        // `onerror`, and clearing it here would hide the reason one tick later.
        setState(erroredRef.current ? "error" : "idle");
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setState("listening");
      } catch {
        recognitionRef.current = null;
        erroredRef.current = true;
        setMessage(frenchError("start-failed"));
        setState("error");
      }
    },
    [language]
  );

  /* ── clic ─────────────────────────────────────────────────────────── */

  const toggle = useCallback(() => {
    if (!supported) return;

    if (localSupported) {
      if (state === "listening") {
        void stopAndTranscribe();
      } else if (state !== "transcribing") {
        void startLocal();
      }
      return;
    }

    if (state === "listening") {
      stopListening();
      return;
    }
    const Recognizer = getRecognitionCtor();
    if (Recognizer) startListening(Recognizer);
  }, [
    supported,
    localSupported,
    state,
    startLocal,
    stopAndTranscribe,
    stopListening,
    startListening,
  ]);

  // Unmount: free the microphone, then drop the browser recognizer's handlers
  // so a late callback cannot set state on a dead component.
  useEffect(() => {
    // Re-armed on mount: StrictMode runs cleanup once before the real mount.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (isRecording()) cancelRecording();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    };
  }, []);

  const unsupported = "Dictée non supportée par ce navigateur";
  const listening = state === "listening";
  const busy = state === "transcribing";
  const label = !supported
    ? unsupported
    : listening
      ? "Arrêter la dictée"
      : busy
        ? "Transcription en cours"
        : "Dicter";
  const title =
    !supported
      ? unsupported
      : state === "error"
        ? message ?? "Dictée impossible"
        : busy
          ? "Transcription en cours…"
          : label;

  return (
    <>
      <style>{STYLE}</style>
      <button
        type="button"
        className={`icon-btn cockpit-mic${className ? ` ${className}` : ""}`}
        data-state={state}
        data-tone={listening || state === "error" ? "red" : undefined}
        aria-label={label}
        aria-pressed={listening}
        title={title}
        disabled={!supported || busy}
        onClick={toggle}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2.5" width="6" height="11" rx="3" fill={listening ? "currentColor" : "none"} />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
          <path d="M12 18v3.5" />
        </svg>
      </button>
    </>
  );
}
