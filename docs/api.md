# API du service

Base : `http://127.0.0.1:8791/api`. Réponses JSON ; erreurs sous la forme
`{ "error": "message lisible" }`. Les tours de conversation sont en `text/event-stream`.

## Santé

`GET /health`

```json
{ "api": "ok", "db": "ok", "opencode": "ok" }
```

`api` reflète l'API Hermes, `db` la base d'état, `opencode` le service OpenCode.

## Sessions

`GET /observatory/sessions?limit=60`

```json
[{
  "id": "api_...",
  "title": "Refonte de la page d'accueil",
  "source": "api_server",
  "origin": "Hermes",
  "running": false,
  "message_count": 12,
  "tool_call_count": 3,
  "parent_session_id": null,
  "last_activity_at": 1793217603.0
}]
```

`GET /observatory/sessions/{id}/messages?after_id=0&limit=200&kinds=all`

- `after_id=0` : renvoie la **fin** de la conversation (fenêtre calée sur les derniers
  échanges) ; `after_id>0` : les messages plus récents que cet identifiant.
- `kinds=chat` : uniquement `user`/`assistant` ; `kinds=all` : inclut les outils.

Chaque message peut porter `reasoning` (raisonnement) et `tool_preview` (résumé des
arguments de l'outil), reconstruits depuis les colonnes correspondantes.

`POST /sessions` — corps `{ "title": "..." }`. Le titre doit être **unique** ; le front
ajoute un horodatage en cas de collision, plutôt que d'échouer en silence.

`POST /sessions/{id}/model` — `{ "provider": "...", "model": "..." }` verrouille le modèle
de la session.

## Conversation

`POST /chat/stream` — `{ session_id, message, images?, provider?, model?, effort? }`

Événements SSE : `run.started`, `message.started`, `assistant.delta` (texte),
`tool.progress` (dont `tool_name: "_thinking"` pour le raisonnement),
`assistant.commentary`, `tool.started|completed|failed`, `run.completed|failed`, `done`.

`effort` (`low` | `medium` | `high` | `xhigh` | `ultra`) est transmis en
`model_options.reasoning.effort` **et** traduit en consigne système, pour que l'effet soit
visible même sur un fournisseur qui ignore l'option.

`POST /cli/stream` — `{ session_id, message }` : même format de sortie, mais le tour est
exécuté par `hermes -z <message> --resume <session>` et la sortie du CLI est relayée ligne
par ligne. Utilisé pour les sessions dont l'origine n'est pas `api_server`.

## Sous-agents et skills

`GET /observatory/subagents` — délégations :
`{ id, parent_id, goal, state, dispatched_at, completed_at }`.

`GET /observatory/skills` — catalogue installé.
`GET /observatory/sessions/{id}/skills` — skills réellement utilisés par la session.

## Aperçu

`GET /preview/detect?session_id=...&hint=...`

```json
{
  "url": "http://127.0.0.1:8082",
  "port": 8082,
  "project": "C:/Dev/MonProjet",
  "source": "project",
  "cwd": null
}
```

`source` vaut `project` (serveur du projet reconnu), `cache`, ou `aucun` (`url` est alors
`null`). `hint` est le texte de la conversation, tronqué aux 4000 derniers caractères par
le front.

## Dictée

`GET /dictation/status`

```json
{
  "available": true,
  "engine": "local",
  "language": "fr-FR",
  "detail": "transcription locale via sherpa-onnx / Parakeet"
}
```

`POST /dictation/transcribe` — `{ audio_base64, format }` (`format` doit valoir `wav`).

```json
{ "text": "Bonjour, ceci est un test.", "engine": "local", "language": "fr-FR" }
```

Erreurs : `400` contenu ou encodage invalide, `415` conteneur non WAV, `502` aucune parole
reconnue, `503` aucun moteur disponible, `504` délai dépassé. Aucune transcription n'est
jamais inventée.
