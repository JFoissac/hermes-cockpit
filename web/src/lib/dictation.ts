/**
 * Dictée locale : enregistreur WAV pour le moteur sherpa-onnx du service Rust.
 *
 * Pourquoi pas la Web Speech API ? La WebView2 de Tauri ne l'implémente pas :
 * le bouton micro ne faisait rien dans l'application desktop. On capture donc
 * le micro nous-mêmes, on encode un WAV PCM 16 bits mono à 16 kHz — le format
 * attendu par `POST /api/dictation/transcribe` — et le service transcrit avec
 * le modèle local Parakeet.
 *
 * Aucune dépendance npm : `getUserMedia` + `AudioContext` + un encodeur WAV
 * d'une trentaine de lignes.
 *
 * Cycle de vie, un seul enregistrement à la fois (un micro, un bouton) :
 *
 *   await startRecording();           // demande le micro, démarre la capture
 *   const base64 = await stopRecording(); // rend un WAV complet, prêt à poster
 *
 * `stopRecording()` rejette si rien n'est en cours ; `cancelRecording()`
 * libère le micro sans rien produire (démontage du composant).
 */

/** Fréquence attendue par sherpa-onnx / Parakeet. */
export const TARGET_SAMPLE_RATE = 16000;

/** Pourquoi la dictée n'a pas pu aboutir, en clair pour l'UI. */
export type DictationFailure =
  | "unsupported"
  | "denied"
  | "no-device"
  | "busy"
  | "empty"
  | "failed";

const MESSAGES: Record<DictationFailure, string> = {
  unsupported: "Ce navigateur ne permet pas d'enregistrer le micro",
  denied: "Micro refusé (autorisez l'accès dans les réglages)",
  "no-device": "Aucun micro détecté",
  busy: "Un enregistrement est déjà en cours",
  empty: "Aucun son capté (micro muet ?)",
  failed: "Enregistrement impossible",
};

/** Erreur typée : l'UI affiche `message`, le code sert aux tests. */
export class DictationError extends Error {
  readonly kind: DictationFailure;

  constructor(kind: DictationFailure, detail?: string) {
    super(detail ? `${MESSAGES[kind]} — ${detail}` : MESSAGES[kind]);
    this.name = "DictationError";
    this.kind = kind;
  }
}

/** Traduit n'importe quel rejet en message lisible, sans jamais le masquer. */
export function dictationMessage(error: unknown): string {
  if (error instanceof DictationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return MESSAGES.failed;
}

interface Capture {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  chunks: Float32Array[];
  sampleRate: number;
}

let capture: Capture | null = null;

/** Le micro est-il capturable ici ? (faux dans jsdom et dans un WebView nu) */
export function isRecordingSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const media = navigator.mediaDevices;
  if (!media || typeof media.getUserMedia !== "function") return false;
  const scope = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return typeof scope.AudioContext === "function" || typeof scope.webkitAudioContext === "function";
}

/** Vrai entre `startRecording()` et `stopRecording()`/`cancelRecording()`. */
export function isRecording(): boolean {
  return capture !== null;
}

function audioContextCtor(): typeof AudioContext {
  const scope = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!ctor) throw new DictationError("unsupported");
  return ctor;
}

/** `NotAllowedError`/`NotFoundError` → message précis plutôt que « failed ». */
function mediaFailure(error: unknown): DictationError {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new DictationError("denied");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return new DictationError("no-device");
  }
  return new DictationError("failed", error instanceof Error ? error.message : undefined);
}

/**
 * Demande le micro et démarre la capture PCM. Rejette avec une `DictationError`
 * si le navigateur ne sait pas faire, si l'utilisateur refuse, s'il n'y a pas
 * de micro — ou lance une erreur explicite si un enregistrement tourne déjà.
 */
export async function startRecording(): Promise<void> {
  if (!isRecordingSupported()) throw new DictationError("unsupported");
  if (capture) throw new DictationError("busy");

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    throw mediaFailure(error);
  }

  const Ctor = audioContextCtor();
  let context: AudioContext;
  try {
    // 16 kHz directement quand la plateforme l'honore : moins de calcul ensuite.
    context = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    context = new Ctor();
  }

  try {
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    // Un gain nul vers la sortie : le graphe tourne sans réinjecter le micro
    // dans les haut-parleurs (larsen), ce que Chromium exige pour traiter.
    sink.gain.value = 0;

    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => {
      // Copie : le buffer fourni est réutilisé d'un bloc à l'autre.
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);

    capture = {
      stream,
      context,
      source,
      processor,
      sink,
      chunks,
      sampleRate: context.sampleRate,
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw new DictationError(
      "failed",
      error instanceof Error ? error.message : undefined
    );
  }
}

/** Libère micro, graphe audio et contexte. Idempotent. */
function release(): Capture | null {
  const current = capture;
  capture = null;
  if (!current) return null;
  current.processor.onaudioprocess = null;
  try {
    current.source.disconnect();
    current.processor.disconnect();
    current.sink.disconnect();
  } catch {
    // Déjà déconnecté : sans conséquence.
  }
  current.stream.getTracks().forEach((track) => track.stop());
  void current.context.close().catch(() => undefined);
  return current;
}

/** Arrête tout et jette l'audio capté (démontage du bouton). */
export function cancelRecording(): void {
  release();
}

/**
 * Arrête la capture et rend le WAV complet encodé en base64.
 * Rejette si aucun enregistrement n'est en cours, ou si rien n'a été capté.
 */
export async function stopRecording(): Promise<string> {
  const current = release();
  if (!current) throw new DictationError("failed", "aucun enregistrement en cours");

  const total = current.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (total === 0) throw new DictationError("empty");

  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of current.chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const samples = resample(merged, current.sampleRate, TARGET_SAMPLE_RATE);
  return encodeBase64(encodeWavPcm16(samples, TARGET_SAMPLE_RATE));
}

/** Rééchantillonnage linéaire — suffisant pour de la parole, sans dépendance. */
export function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    out[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return out;
}

/** WAV PCM 16 bits mono, en-tête RIFF de 44 octets. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // taille du bloc fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // octets par seconde
  view.setUint16(32, 2, true); // alignement d'un échantillon
  view.setUint16(34, 16, true); // bits par échantillon
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

/** base64 sans dépendance : `btoa` par tranches pour éviter les piles pleines. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}
