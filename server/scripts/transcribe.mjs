#!/usr/bin/env node
/**
 * Transcription locale d'un WAV via l'addon Node sherpa-onnx (modèle NeMo
 * Parakeet TDT, offline transducer).
 *
 * Usage :
 *   node transcribe.mjs <cheminWav> <dossierModele> [cheminAddon]
 *
 * Contrat, et il est strict :
 *   - stdout ne contient QUE le texte transcrit (une ligne, sans ornement) ;
 *   - stderr reçoit diagnostics et erreurs ;
 *   - code de sortie non nul dès qu'un élément manque ou qu'un appel échoue.
 * Un stdout vide avec un code 0 veut dire « le moteur n'a reconnu aucune
 * parole » : ce n'est pas une transcription, et l'appelant doit le traiter
 * comme tel (le service Rust répond alors une erreur explicite).
 *
 * Aucune dépendance npm : le WAV est décodé à la main et l'addon est chargé
 * par son chemin absolu (il est livré avec l'application OpenChamber).
 *
 * API de l'addon (sherpa-onnx 1.13.8, style fonctionnel, pas de méthodes sur
 * les handles — ce sont des `External`) :
 *   createOfflineRecognizer({ featConfig, modelConfig }) -> handle
 *   createLinearResampler(inRate, outRate) / resampleLinear(handle, samples, flush)
 *   createOfflineStream(recognizer) / acceptWaveformOffline(stream, {sampleRate, samples})
 *   decodeOfflineStream(recognizer, stream) / getOfflineStreamResultAsJson(stream)
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SAMPLE_RATE = 16000;
const DEFAULT_ADDON = process.env.COCKPIT_SHERPA_ADDON
  ?? `${process.env.LOCALAPPDATA ?? ""}/Programs/@openchamberelectron/resources/app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node`;

/** Message d'échec sur stderr + code de sortie 1 : jamais de texte inventé. */
function fail(message) {
  process.stderr.write(`transcribe: ${message}\n`);
  process.exit(1);
}

function note(message) {
  process.stderr.write(`transcribe: ${message}\n`);
}

/* ── WAV ───────────────────────────────────────────────────────────────── */

/**
 * Décode un WAV RIFF en Float32 mono. Accepte PCM 16/24/32 bits et float32,
 * mono ou multicanal (les canaux sont moyennés), et ignore les chunks
 * annexes (LIST, fact…) que les encodeurs ajoutent volontiers.
 */
export function decodeWav(buffer) {
  if (buffer.length < 12) throw new Error("fichier trop court pour un WAV");
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("ce n'est pas un fichier RIFF/WAVE");
  }

  let fmt = null;
  let data = null;
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= buffer.length) {
      let format = buffer.readUInt16LE(body);
      const channels = buffer.readUInt16LE(body + 2);
      const sampleRate = buffer.readUInt32LE(body + 4);
      const bits = buffer.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE : le vrai format est dans le sous-format GUID.
      if (format === 0xfffe && body + 26 <= buffer.length) {
        format = buffer.readUInt16LE(body + 24);
      }
      fmt = { format, channels, sampleRate, bits };
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, Math.max(0, buffer.length - body)) };
    }
    // Les chunks sont alignés sur un nombre pair d'octets.
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new Error("chunk 'fmt ' absent");
  if (!data || data.size === 0) throw new Error("chunk 'data' absent ou vide");
  if (fmt.channels < 1) throw new Error(`nombre de canaux invalide (${fmt.channels})`);
  if (fmt.sampleRate < 1000) throw new Error(`fréquence d'échantillonnage invalide (${fmt.sampleRate})`);

  const bytesPerSample = fmt.bits / 8;
  if (![2, 3, 4].includes(bytesPerSample)) {
    throw new Error(`profondeur ${fmt.bits} bits non gérée (PCM 16/24/32 ou float32 attendu)`);
  }
  if (fmt.format !== 1 && fmt.format !== 3) {
    throw new Error(`format WAV ${fmt.format} non géré (PCM ou float attendu)`);
  }

  const frames = Math.floor(data.size / (bytesPerSample * fmt.channels));
  const samples = new Float32Array(frames);

  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < fmt.channels; channel += 1) {
      const at = data.start + (frame * fmt.channels + channel) * bytesPerSample;
      let value;
      if (fmt.format === 3 && bytesPerSample === 4) {
        value = buffer.readFloatLE(at);
      } else if (bytesPerSample === 2) {
        value = buffer.readInt16LE(at) / 32768;
      } else if (bytesPerSample === 3) {
        // PCM 24 bits signé, little-endian.
        const raw = buffer[at] | (buffer[at + 1] << 8) | (buffer[at + 2] << 16);
        value = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608;
      } else {
        value = buffer.readInt32LE(at) / 2147483648;
      }
      sum += value;
    }
    samples[frame] = sum / fmt.channels;
  }

  return { sampleRate: fmt.sampleRate, samples, channels: fmt.channels };
}

/** Rééchantillonnage linéaire, suffisant pour de la parole et sans dépendance. */
export function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
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

/* ── Modèle ────────────────────────────────────────────────────────────── */

/** Retrouve encoder/decoder/joiner/tokens dans un dossier de modèle Parakeet. */
export function resolveModel(modelDir) {
  const entries = readdirSync(modelDir);
  const pick = (pattern) => {
    const match = entries.filter((name) => pattern.test(name)).sort()[0];
    return match ? path.join(modelDir, match) : null;
  };

  const tokens = pick(/^tokens\.txt$/i);
  // `encoder.int8.onnx` (int8) comme `encoder.onnx` (fp32) doivent marcher.
  const encoder = pick(/^encoder.*\.onnx$/i);
  const decoder = pick(/^decoder.*\.onnx$/i);
  const joiner = pick(/^joiner.*\.onnx$/i);

  const missing = [
    ["encoder", encoder],
    ["decoder", decoder],
    ["joiner", joiner],
    ["tokens.txt", tokens],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `modèle incomplet dans ${modelDir} : ${missing.map(([name]) => name).join(", ")} introuvable(s)`
    );
  }

  return { encoder, decoder, joiner, tokens };
}

function loadAddon(addonPath) {
  if (!existsSync(addonPath)) {
    throw new Error(`addon sherpa-onnx introuvable : ${addonPath}`);
  }
  // createRequire a besoin d'une base valide : le fichier .node lui-même.
  const requireFrom = createRequire(addonPath);
  const addon = requireFrom(addonPath);
  for (const name of ["createOfflineRecognizer", "createOfflineStream", "decodeOfflineStream"]) {
    if (typeof addon[name] !== "function") {
      throw new Error(`addon sans ${name}() : version de sherpa-onnx incompatible`);
    }
  }
  return addon;
}

/* ── Programme ─────────────────────────────────────────────────────────── */

function main(argv) {
  const [wavPath, modelDir, addonArg] = argv;
  if (!wavPath || !modelDir) {
    fail("usage : node transcribe.mjs <cheminWav> <dossierModele> [cheminAddon]");
  }
  if (!existsSync(wavPath) || !statSync(wavPath).isFile()) fail(`WAV introuvable : ${wavPath}`);
  if (!existsSync(modelDir) || !statSync(modelDir).isDirectory()) fail(`modèle introuvable : ${modelDir}`);

  const addonPath = path.resolve(addonArg || process.env.COCKPIT_SHERPA_ADDON || DEFAULT_ADDON);

  let wave;
  try {
    wave = decodeWav(readFileSync(wavPath));
  } catch (error) {
    fail(`WAV illisible (${wavPath}) : ${error.message}`);
  }
  if (wave.samples.length === 0) fail("WAV sans échantillon");

  let model;
  try {
    model = resolveModel(modelDir);
  } catch (error) {
    fail(error.message);
  }

  let sherpa;
  try {
    sherpa = loadAddon(addonPath);
  } catch (error) {
    fail(error.message);
  }

  const startedAt = Date.now();
  let recognizer;
  try {
    recognizer = sherpa.createOfflineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
        tokens: model.tokens,
        numThreads: Math.max(1, Math.min(4, Number(process.env.COCKPIT_SHERPA_THREADS) || 2)),
        provider: "cpu",
        debug: 0,
        modelType: "nemo_transducer",
      },
    });
  } catch (error) {
    fail(`création du recognizer impossible : ${error.message}`);
  }
  if (!recognizer) fail("création du recognizer impossible (config refusée)");
  note(`modèle chargé en ${Date.now() - startedAt} ms`);

  let samples = wave.samples;
  if (wave.sampleRate !== SAMPLE_RATE) {
    try {
      const resampler = sherpa.createLinearResampler(wave.sampleRate, SAMPLE_RATE);
      samples = sherpa.resampleLinear(resampler, samples, 1);
      note(`rééchantillonné ${wave.sampleRate} -> ${SAMPLE_RATE} Hz (addon)`);
    } catch {
      samples = resampleLinear(samples, wave.sampleRate, SAMPLE_RATE);
      note(`rééchantillonné ${wave.sampleRate} -> ${SAMPLE_RATE} Hz (JS)`);
    }
  }

  let text;
  try {
    const stream = sherpa.createOfflineStream(recognizer);
    sherpa.acceptWaveformOffline(stream, { sampleRate: SAMPLE_RATE, samples });
    sherpa.decodeOfflineStream(recognizer, stream);
    const json = sherpa.getOfflineStreamResultAsJson(stream);
    text = (JSON.parse(json).text ?? "").trim();
  } catch (error) {
    fail(`décodage impossible : ${error.message}`);
  }

  note(`décodé en ${Date.now() - startedAt} ms (${wave.samples.length} échantillons)`);

  // Une seule ligne sur stdout : le texte, ou rien du tout.
  process.stdout.write(text.replace(/\s+/g, " "));
  process.exit(0);
}

// Importé par un test ? Alors on n'exécute pas le programme.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2));
}

export { main };
