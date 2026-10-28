<div align="center">

# Hermes Cockpit

**Un seul écran pour voir tourner tous tes agents.**

Sessions Hermes, subagents, agents OpenCode, dictée locale et aperçu de tes webapps —
dans une interface calme, claire, avec un requin ASCII qui nage derrière.

`Rust` · `Tauri-ready` · `React 18` · `local-first` · `zéro télémétrie`

</div>

---

## Pourquoi

Quand on fait tourner plusieurs agents en parallèle, on finit par perdre le fil :
trois terminaux, deux sessions Telegram, un OpenCode à moitié oublié, et aucune idée
de quel subagent est bloqué sur quelle tâche.

Hermes Cockpit lit ce que Hermes écrit déjà sur la machine — sans rien réécrire — et
l'affiche en direct : qui tourne, sur quoi, avec quel coût, et ce que fait chaque
subagent, outil par outil.

## Ce que fait la V0

| | |
|---|---|
| 🛰 **Observatoire** | Toutes les sessions Hermes lues depuis `state.db` en **lecture seule**, avec état `running` réel (baux de tour), coût, tokens, branche git. |
| 🌿 **Subagents** | Arbre des délégations (`async_delegations`) : objectif, état, durée — et le transcript de chaque session enfant. |
| 💬 **Chat** | Conversation avec Hermes via son API locale (`/api/sessions/{id}/chat/stream`), streaming SSE, bouton stop. |
| 🔌 **OpenCode** | Les sessions OpenCode à côté des sessions Hermes, via `opencode api`. |
| 🖥 **Aperçu** | Ta webapp dans un cadre d'appareil (Desktop / iPhone 15 / Pixel 8 / iPad mini), sans quitter l'app. |
| 〰 **Scène marine** | Eau profonde en dégradé, rayons, plancton, bulles, deux bancs de poissons jaunes et un requin en demi-teinte derrière l'UI — 30 fps, ~1,2 ms/frame, figé si `prefers-reduced-motion`. |
| 🌗 **Thème** | Clair, sombre ou système, palette marine dédiée à chaque thème. |
| 🎙 **Dictée** | Bouton micro (Web Speech, fr-FR) : les partiels s'affichent, le final s'ancre dans le composer. |
| 🧩 **Skills** | Catalogue des skills installés et ceux réellement utilisés par la session ouverte. |
| ⚙ **Options** | Modale : apparence, modèle, dossier de travail, raccourcis, à propos. |
| 🖥 **Desktop** | Coque Tauri v2 (`pnpm desktop`), fenêtre native, icône, bundle MSI à venir. |

> **Statut : V0 en construction.** Le chat, l'observatoire et l'aperçu fonctionnent ;
> la dictée locale et l'ouverture d'émulateur natif arrivent ensuite. Rien n'est simulé :
> si une source est absente, l'écran le dit.

## Captures

| Accueil (clair) | Accueil (sombre) | Options |
|---|---|---|
| ![Accueil clair](docs/qa/scene-light.png) | ![Accueil sombre](docs/qa/scene-dark.png) | ![Options](docs/qa/options.png) |

| Chat | Vue Agents |
|---|---|
| ![Chat](docs/qa/chat-view.png) | ![Agents](docs/qa/agents-view.png) |

Raccourcis : **Entrée** envoie, **Maj+Entrée** passe à la ligne (Windows et macOS).

## Architecture

```
┌──────────────────────────── web/ (React 18 + Vite) ────────────────────────────┐
│  Sidebar sessions   ·   Chat (SSE)   ·   Agents   ·   Aperçu (cadre appareil)   │
│  AsciiBackground (canvas 2D, 30 fps, seeded PRNG)                               │
└───────────────────────────────────┬────────────────────────────────────────────┘
                                    │  /api/*  (proxy Vite en dev)
┌───────────────────────────────────▼────────────────────────────────────────────┐
│                        server/ (Rust · axum · 127.0.0.1:8791)                   │
│  hermes_db   → state.db  (SQLite, READ-ONLY, jamais d'écriture)                 │
│  hermes_api  → http://127.0.0.1:8642  (API server Hermes, bearer local)         │
│  opencode    → `opencode api` (CLI officiel)                                    │
└────────────────────────────────────────────────────────────────────────────────┘
```

Détail des modules, contrats de données et invariants : [`docs/architecture.md`](docs/architecture.md).

## Application desktop

```bash
pnpm -C web desktop        # fenêtre native (serveur Rust + Vite requis)
pnpm -C web desktop:build  # installeur MSI
```

## Démarrage

Prérequis : **Rust stable**, **Node ≥ 20 + pnpm**, et un Hermes local avec son API server activé.

```bash
git clone https://github.com/<toi>/hermes-cockpit.git
cd hermes-cockpit

# 1. dépendances web
pnpm -C web install

# 2. serveur Rust (terminal 1)
cargo run --manifest-path server/Cargo.toml

# 3. interface (terminal 2)
pnpm -C web dev
```

Ouvre <http://127.0.0.1:5183>.

### Côté Hermes

L'app lit deux choses, toutes deux locales :

- `%LOCALAPPDATA%/hermes/state.db` (ou `$HERMES_HOME/state.db`) — **ouverte en lecture seule** ;
- l'API server Hermes, activée dans `~/.hermes/.env` :

```env
API_SERVER_ENABLED=true
API_SERVER_KEY=<une-clé-locale>
```

Hermes Cockpit récupère cette clé **au runtime**, depuis ton fichier `.env`. Elle n'est
jamais copiée dans le repo, jamais loggée, jamais renvoyée au navigateur.

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `HERMES_HOME` | `%LOCALAPPDATA%/hermes` | Emplacement de `state.db` et `.env` |
| `HERMES_API_BASE` | `http://127.0.0.1:8642` | Base de l'API server Hermes |
| `PORT` | `8791` | Port du serveur cockpit |

## Développement

```bash
pnpm -C web test          # tests UI (vitest + testing-library)
pnpm -C web exec tsc -b   # typecheck strict
cargo test --manifest-path server/Cargo.toml
cargo fmt --manifest-path server/Cargo.toml
```

Le projet suit trois règles :

1. **Zéro mock** dans le code de production — les données affichées viennent de la machine.
2. **Zéro écriture** dans `state.db`, quel que soit le chemin de code.
3. **Zéro secret** dans le dépôt — `.env` est ignoré, les clés restent locales.

## Feuille de route

- [x] Observatoire des sessions Hermes (lecture seule)
- [x] Arbre des subagents et délégations
- [x] Chat streaming via l'API Hermes
- [x] Aperçu webapp avec cadres d'appareil
- [x] Fond ASCII animé (requin, canvas, 30 fps)
- [ ] Dictée locale (whisper.cpp, push-to-talk, 100 % offline)
- [ ] Vue Agents détaillée (timeline d'outils par subagent)
- [ ] Coque Tauri v2 + installeur MSI
- [ ] Ouverture de l'émulateur natif (Android ; iOS sur macOS)
- [ ] Recherche plein texte dans l'historique (FTS5 déjà présent dans `state.db`)

## Crédits

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) — l'agent, ses protocoles et sa base d'état.
- [OpenCode](https://opencode.ai) — les sessions agent suivies via son API.
- La direction visuelle (requin ASCII en demi-teinte, composer en verre) s'inspire de
  l'écran « shark ascii animation » référencé sur [inspora.design](https://www.inspora.design/posts/shark-ascii-animation).
- Typographies : Inter, JetBrains Mono.

## Licence

À définir par l'auteur du dépôt (placeholder — voir `LICENSE` une fois choisie).
