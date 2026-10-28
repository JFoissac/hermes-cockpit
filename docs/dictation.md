# Dictée vocale

## Principe

La dictée est **entièrement locale**. La page enregistre l'audio, l'encode en WAV, et le
service le transcrit avec sherpa-onnx et un modèle Parakeet.

Pourquoi pas l'API Web Speech du navigateur ? Elle n'existe pas dans la WebView2 qui fait
tourner l'application desktop — le bouton n'aurait aucun effet. Le moteur local marche
partout, hors ligne, sans clé.

## Chaîne complète

1. `getUserMedia({ audio: true })` dans la page.
2. `AudioContext` à 16 kHz, mono, PCM 16 bits.
3. Encodage WAV en mémoire, puis base64.
4. `POST /api/dictation/transcribe` avec `{ audio_base64, format: "wav" }`.
5. Le service écrit un WAV temporaire, lance
   `node server/scripts/transcribe.mjs <wav> <modele>` et lit sa sortie.
6. Le texte est renvoyé, puis inséré dans le champ de saisie.

## Modèle et addon

Par défaut, le service cherche :

- l'addon : `%LOCALAPPDATA%/Programs/@openchamberelectron/resources/app.asar.unpacked/node_modules/sherpa-onnx-win-x64/sherpa-onnx.node`
- le modèle : `<profil>/.config/openchamber/speech-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`

Surchargeables :

```bash
export COCKPIT_SHERPA_ADDON=/chemin/vers/sherpa-onnx.node
export COCKPIT_SPEECH_MODEL=/chemin/vers/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8
```

Le modèle doit contenir `encoder*.onnx`, `decoder*.onnx`, `joiner*.onnx` et `tokens.txt`
(transducer NeMo). Un modèle incomplet fait échouer la détection — et l'application
l'annonce au lieu de renvoyer un texte vide.

## Coût et latence

Le script charge le modèle à chaque requête : environ **7 s** pour un court message, dont
la majorité en chargement. Un processus Node persistant serait la prochaine optimisation.

## Vérifier le moteur

```bash
curl -s http://127.0.0.1:8791/api/dictation/status
```

- `engine: "local"` → sherpa détecté, la dictée fonctionne.
- `engine: "browser"` → aucun moteur local trouvé ; la page retombe sur l'API Web Speech
  si elle existe (c'est-à-dire dans un vrai navigateur).

## Ce que fait l'interface

| État | Signification |
|---|---|
| `data-state="idle"` | prêt |
| `data-state="listening"` | enregistrement en cours |
| `data-state="transcribing"` | audio envoyé, transcription en cours |
| `data-state="error"` | micro refusé ou erreur serveur (explication en infobulle) |

## Ce qui n'est jamais fait

Aucune transcription inventée. Silence ou bruit incompréhensible → `502` « aucune parole
reconnue », et le champ reste inchangé.
