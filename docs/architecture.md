# Architecture — Hermes Cockpit

## Vue d'ensemble

Hermes Cockpit est un **lecteur** de l'écosystème d'agents local, doublé d'un client de chat.
Deux processus, un seul dépôt :

```
web/      interface React (Vite) — aucune donnée n'est inventée côté client
server/   service Rust (axum)   — la seule couche qui touche au disque et à l'API Hermes
```

Le serveur expose une API HTTP locale sur `127.0.0.1:8791`. En développement, Vite proxifie
`/api` vers ce port ; en production, le même binaire peut servir `web/dist` (Tauri ou simple
`cargo run`).

## Modules

### `server/src/hermes_db.rs`

Unique point d'accès à `state.db`. Ouvre la base avec `read_only(true)` et un `busy_timeout`
court (300 ms) : la base est en WAL et partagée avec le gateway Hermes, qui en est le seul
écrivain.

| Fonction | Table | Usage |
|---|---|---|
| `sessions(limit)` | `sessions` | liste triée par activité, filtrée `archived=0 AND hidden=0` |
| `messages_since(session, after_id, limit)` | `messages` | deltas incrémentaux (`messages.id` est un rowid monotone) |
| `subagents(limit)` | `async_delegations` | délégations avec `goal` extrait de `task_json` |
| `running_ids()` | `session_turn_leases` | badge `running` (bail non expiré) |

**Invariant :** aucune requête `INSERT`/`UPDATE`/`DELETE` ne doit exister dans ce module.
Un test (`server/tests/db_readonly.rs`) vérifie qu'une écriture échoue.

### `server/src/hermes_api.rs`

Client de l'API server Hermes (`http://127.0.0.1:8642`), authentifié par la clé locale
`API_SERVER_KEY` lue dans `<hermes_home>/.env` au démarrage — **jamais** journalisée,
**jamais** exposée au front.

- `capabilities()` → `GET /v1/capabilities` (sert de sonde pour `/api/health`)
- `create_session(title)` → `POST /api/sessions`
- `chat_stream(session_id, message)` → `POST /api/sessions/{id}/chat/stream`, relais SSE
  octet pour octet (`event: <nom>\ndata: <json>\n\n`)

### `server/src/opencode.rs` *(prévu)*

Transport `opencode api` (le CLI officiel injecte lui-même l'authentification), endpoints
`/api/session`, `/api/session/:id/children`, `/api/session/status`. Repli polling ; SSE
`/api/event` à confirmer.

### `server/src/routes/`

| Route | Réponse |
|---|---|
| `GET /api/health` | `{api, db, opencode, apiDetail?}` |
| `GET /api/observatory/sessions` | `AgentSession[]` |
| `GET /api/observatory/sessions/:id/messages` | `MessageDelta[]` |
| `GET /api/observatory/subagents` | `Subagent[]` |
| `POST /api/sessions` | création (relais) |
| `POST /api/chat/stream` | flux SSE (relais) |

### `web/src/`

```
App.tsx                        assemblage : sidebar, vue active, rail droit
lib/api.ts                     polling + parsing SSE + hooks (useSessions, useSubagents…)
types/api.ts                   contrat partagé (source de vérité des noms de champs)
components/ascii/              moteur canvas du fond animé (déterministe)
components/shell/Sidebar.tsx   navigation + liste de sessions
components/chat/ChatPane.tsx   transcript + composer
components/agents/*            cartes de sessions, arbre des subagents, filtres d'origine
components/preview/            cadres d'appareil et aperçu iframe
styles/theme.css               tokens (couleurs, verre, grille, typographie)
```

## Flux d'une conversation

```
ChatPane.onSend
  └─► POST /api/chat/stream            (notre serveur)
        └─► POST /api/sessions/{id}/chat/stream   (API Hermes)
              └─► SSE: run.started, message.started, assistant.delta,
                        tool.started, tool.completed, assistant.completed, run.completed
  ◄── recopie SSE ─────────────────────────────────────────────────────────────┘
App.tsx agrège les deltas dans un buffer local, puis s'efface : la base d'état
fait foi dès que le tour est persisté (polling 1,5 s sur /messages).
```

## Choix assumés

- **Polling plutôt que WebSocket en V0.** 2 s sur la liste des sessions, 1,5 s sur le
  transcript actif : suffisant, sans état de connexion à maintenir. Le passage au flux
  d'événements du gateway Hermes (`/api/ws`, tickets à usage unique) est une évolution
  prévue, pas un prérequis.
- **Pas de fork de cdesktop en V0.** Le fork Rust/Tauri complet (30 crates) reste une
  option ; il n'était pas compatible avec l'objectif « voir le visuel tout de suite ».
- **L'aperçu reste un cadre d'appareil + iframe.** Une webapp responsive se valide là.
  Les émulateurs natifs (Android, iOS sur macOS) s'ouvrent depuis l'app hôte.

## Invariants du projet

1. `state.db` est en lecture seule. Toujours.
2. Aucune clé, aucun token, aucun `.env` dans le dépôt.
3. Aucune donnée fictive en production : une source absente s'affiche « à venir » ou vide.
4. Chaque nouvel écran arrive avec son test et sa capture d'écran.
