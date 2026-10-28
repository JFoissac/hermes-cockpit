# hermes-cockpit-server

Serveur local (axum) du Cockpit : lecture **read-only** de `state.db` Hermes +
proxy de l'API Hermes. Le front (`web/`) appelle `/api/*` et ne voit jamais la
clé API.

## Lancer

```bash
cd server
cargo run          # http://127.0.0.1:8791
cargo test         # tests d'intégration sur la vraie base (lecture seule)
```

Variables d'environnement :

| Variable          | Défaut                          | Rôle                                   |
| ----------------- | ------------------------------- | -------------------------------------- |
| `HERMES_HOME`     | `%LOCALAPPDATA%/hermes`         | racine Hermes (`state.db`, `.env`)     |
| `HERMES_API_BASE` | `http://127.0.0.1:8642`         | API Hermes                             |
| `PORT`            | `8791`                          | port d'écoute (bind 127.0.0.1)         |
| `COCKPIT_WEB_DIST`| `web/dist` si présent           | front statique                         |
| `RUST_LOG`        | `info,tower_http=warn`          | logs                                   |

`API_SERVER_KEY` est lue dans `<HERMES_HOME>/.env`, jamais loggée, jamais
renvoyée au client.

## Endpoints

- `GET /api/health` → `{api, db, opencode, apiDetail?}`
- `GET /api/observatory/sessions?limit=60`
- `GET /api/observatory/sessions/{id}/messages?after_id=0&limit=200`
- `GET /api/observatory/subagents?limit=50`
- `GET /api/observatory/noop` → `[]`
- `POST /api/sessions {title?}` → réponse Hermes telle quelle
- `POST /api/chat/stream {session_id, message}` → SSE passthrough octet par octet

## Rôle des modules

- `state.rs` — `AppState` (pool read-only, home, client API) + lecture `.env`
- `hermes_db.rs` — SQL read-only (`sessions`, `messages`, `async_delegations`, leases)
- `hermes_api.rs` — capabilities, création de session, flux SSE, `opencode` sur le PATH
- `routes/` — surface HTTP + service du front compilé
- `model.rs` — structures sérialisées, noms de champs = contrat `web/src/types/api.ts`

Notes de mapping :

- `running` = lease `session_turn_leases` non expiré.
- `origin` = `OpenCode` pour les sessions ACP / mentionnant opencode, sinon `Hermes`.
- `preview` = premier message utilisateur, aplati et tronqué à 140 caractères.
- `goal` d'un subagent = `task_json.goal`, sinon `(objectif indisponible)`.
