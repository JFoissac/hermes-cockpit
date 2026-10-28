# Installation

## Prérequis

| Élément | Version | Pourquoi |
|---|---|---|
| Node.js | 20 ou plus | front React/Vite |
| pnpm | 10 ou plus | gestion des dépendances web |
| Rust | stable (MSVC sous Windows) | service local et coque Tauri |
| Hermes | installé et configuré | source des sessions et des tours |

Sous Linux, Tauri a besoin de `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`,
`librsvg2-dev` et `patchelf`.

## Le service local (obligatoire)

Sans lui, l'application affiche l'accueil mais **aucune session** : c'est lui qui lit
`state.db` et qui parle à Hermes.

```bash
cargo run --release --manifest-path server/Cargo.toml
```

Il écoute sur `127.0.0.1:8791` (loopback uniquement) et journalise son démarrage :

```
hermes-cockpit-server prêt addr=127.0.0.1:8791 db=.../state.db api_base=http://127.0.0.1:8642 api_key_present=true
```

## L'interface

### Dans un navigateur

```bash
pnpm -C web install
pnpm -C web dev          # http://127.0.0.1:5183
```

Vite relaie `/api` vers le service : aucun CORS, aucune clé dans la page.

### En application desktop

```bash
cd web
pnpm install
pnpm tauri dev           # fenêtre native, rechargement à chaud
pnpm tauri build         # installeur : MSI + NSIS (Windows), DMG (macOS), deb/AppImage (Linux)
```

L'exécutable charge l'interface **depuis le service local** (`http://127.0.0.1:8791/`) dès
qu'il répond : même origine que l'API, donc pas de CORS ni de base d'URL à configurer. Si
le service est absent, il retombe sur le bundle embarqué.

## Côté Hermes

Deux sources, toutes deux locales :

1. `state.db` — `HERMES_HOME/state.db` ou `%LOCALAPPDATA%/hermes/state.db`.
   Ouverte en **lecture seule** ; le service refuse toute écriture.
2. L'API server Hermes, activée dans `~/.hermes/.env` :

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=<une-clé-locale>
```

La clé est lue **au runtime** par le service. Elle n'est jamais copiée dans le dépôt,
jamais journalisée, jamais renvoyée au navigateur.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `HERMES_HOME` | `%LOCALAPPDATA%/hermes` | emplacement de `state.db` et `.env` |
| `HERMES_API_BASE` | `http://127.0.0.1:8642` | base de l'API Hermes |
| `PORT` | `8791` | port d'écoute du service |
| `HERMES_CLI` | binaire `hermes.exe` du profil | CLI utilisé pour les sessions `local` |
| `COCKPIT_WEB_DIST` | `web/dist` | dossier de l'interface à servir |
| `COCKPIT_PROJECT_ROOTS` | `<profil>/Dev` | racines des projets (aperçu), séparées par `;` |
| `COCKPIT_SPEECH_MODEL` | dossier de modèles d'OpenChamber | modèle de dictée Parakeet |
| `COCKPIT_SHERPA_ADDON` | addon sherpa-onnx d'OpenChamber | moteur de transcription |
| `COCKPIT_NODE_BIN` | `node` du `PATH` | interpréteur du script de transcription |
| `COCKPIT_DICTATION_SCRIPT` | `server/scripts/transcribe.mjs` | script de transcription |
| `CROQ_WHISPER_BIN` | — | force un binaire whisper au lieu de sherpa |

## Désinstallation

Rien n'est installé hors du dépôt et de `state.db`. Supprimer le dossier du projet suffit ;
le service ne crée aucun fichier persistant (hors fichier temporaire de dictée, effacé
après usage).
