# Architecture

## Vue d'ensemble

Deux processus, un seul dépôt :

```
web/      interface React 18 + Vite (TypeScript strict) — aucune donnée inventée
server/   service Rust (axum) — seule couche qui touche au disque et à l'API Hermes
```

Le service écoute sur `127.0.0.1:8791`. En développement, Vite relaie `/api` vers ce port ;
en production, il sert lui-même `web/dist` — et la fenêtre Tauri charge cette URL, donc
l'origine de la page et celle de l'API sont identiques (ni CORS, ni base d'URL à deviner).

## Modules du service

### `hermes_db.rs` — la seule porte vers `state.db`

Base ouverte en `read_only(true)`, `busy_timeout` court (300 ms) : elle est en WAL et
partagée avec le gateway Hermes, qui en est le seul écrivain.

| Fonction | Table | Usage |
|---|---|---|
| `sessions(limit)` | `sessions` | liste triée par activité (`archived=0`, `hidden=0`) |
| `messages_since(...)` | `messages` | fenêtre calée sur les 12 derniers messages utilisateur |
| `subagents(limit)` | `async_delegations` | objectif, état, durées |
| `session_cwd(id)` | `sessions` | dossier de travail (aperçu) |
| `session_skill_usage(id)` | `messages` | skills réellement utilisés |

**Invariant :** aucun `INSERT`/`UPDATE`/`DELETE` dans ce module. Le test
`server/tests/db_readonly.rs` vérifie qu'une écriture échoue.

### `hermes_api.rs` — client de l'API Hermes

Authentifié par `API_SERVER_KEY`, lue dans `<hermes_home>/.env` au démarrage — jamais
journalisée, jamais exposée au front.

- `capabilities()` → `GET /v1/capabilities` (sonde de `/api/health`)
- `create_session(title)` → `POST /api/sessions`
- `chat_stream_with_images(...)` → `POST /api/sessions/{id}/chat/stream`, relais SSE
  octet pour octet ; porte aussi `provider`, `model`, `model_options.reasoning.effort` et
  `system_message` (consigne d'effort)

### `routes/`

| Route | Rôle |
|---|---|
| `GET /api/health` | `{api, db, opencode, apiDetail?}` |
| `GET /api/observatory/sessions` | sessions |
| `GET /api/observatory/sessions/:id/messages` | messages (fenêtre par échanges) |
| `GET /api/observatory/subagents` | délégations |
| `GET /api/observatory/skills` | catalogue |
| `POST /api/sessions` | création (relais) |
| `POST /api/chat/stream` | tour via l'API, SSE |
| `POST /api/cli/stream` | tour via le CLI (`hermes --resume`), SSE |
| `GET /api/preview/detect` | serveur de dev du projet cité |
| `GET/POST /api/dictation/*` | état et transcription locale |

## Interface

```
App.tsx                         assemblage : sidebar, vue active, rail droit
lib/api.ts                      polling, parsing SSE, hooks (useSessions, useSubagents…)
lib/base.ts                     base des appels (relative en dev, absolue dans le bundle)
types/api.ts                    contrat partagé (source de vérité des champs)
components/ascii/               fond animé (canvas 2D, déterministe)
components/shell/               sidebar, sélecteur de modèle
components/chat/                transcript, composer, barre d'effort, menu « / »
components/agents/              cartes, arbre des sous-agents, avatars
components/effects/             overlay Ultracode, pastilles d'agents
components/preview/             cadres d'appareil et iframe
styles/theme.css                tokens (couleurs, verre, grille, typographie)
```

## Flux d'une conversation

```
ChatPane.onSend
  └─► POST /api/chat/stream                  (notre service)
        └─► POST /api/sessions/{id}/chat/stream      (API Hermes, sessions api_server)
            ou hermes -z … --resume …                (CLI, sessions local)
  ◄── SSE recopié ────────────────────────────────────────────────────────────┘
App.tsx agrège les deltas, puis s'efface : la base fait foi dès que le tour est écrit.
```

## Fenêtre de messages

Sur une grosse session, les dernières lignes sont presque toutes des appels d'outils. La
requête cale le début de fenêtre sur le **12e dernier message utilisateur** et renvoie tout
ce qui suit (borné à 800 lignes) : conversation lisible, fin jamais tronquée.

## Choix assumés

- **Polling plutôt que WebSocket** : 2 s sur la liste des sessions, 1,5 s sur le transcript
  actif. Simple, sans état de connexion à maintenir ; le flux d'événements du gateway est
  une évolution possible, pas un prérequis.
- **Aperçu = cadre d'appareil + iframe** : une webapp responsive se valide là. Les
  émulateurs natifs s'ouvrent depuis l'app hôte.
- **Chemins résolus à l'exécution** : profil utilisateur, `LOCALAPPDATA`, variables
  `COCKPIT_*`. Aucun chemin personnel dans le code, donc aucun dans le dépôt.
- **Index HTML en `no-store`**, assets hachés cachable à vie : une mise à jour ne peut pas
  laisser une webview tourner sur une ancienne feuille de style.

## Invariants du projet

1. `state.db` est en lecture seule. Toujours.
2. Aucune clé, aucun token, aucun `.env` dans le dépôt.
3. Aucune donnée fictive en production : une source absente s'affiche vide ou explique
   pourquoi.
4. Chaque comportement corrigé arrive avec son test.
