# AGENTS.md — Hermes Cockpit

Instructions pour tout agent (Hermes, Codex, OpenCode…) qui travaille dans ce dépôt.

## Contexte

Dépôt **public**. Application desktop locale de supervision d'agents : interface React
(`web/`) + service Rust (`server/`). Aucune donnée ne quitte la machine.

## Commandes

```bash
pnpm -C web install                  # dépendances web
pnpm -C web dev                      # UI sur http://127.0.0.1:5183
pnpm -C web test                     # vitest
pnpm -C web exec tsc -b              # typecheck strict
cargo run --manifest-path server/Cargo.toml     # service sur 127.0.0.1:8791
cargo test --manifest-path server/Cargo.toml
cargo fmt --manifest-path server/Cargo.toml
```

Sur Windows + bash MSYS, si `cargo` échoue avec `couldn't create a temp dir`, faire
`unset tmp` avant la commande (variable héritée pointant vers un dossier purgé).

## Règles non négociables

1. **Jamais de secret dans le dépôt.** Pas de `.env`, pas de clé, pas de token, pas de
   copie de `~/.hermes/.env`. Les identifiants se lisent au runtime.
2. **Jamais d'écriture dans `state.db`.** Ouverture `read_only(true)`. Un test le vérifie.
3. **Zéro mock en production.** Les tests peuvent stuber la couche réseau ; l'app affiche
   des données réelles ou un état vide explicite (« à venir », « source hors ligne »).
4. **Français** pour tout texte visible ; anglais pour le code et les identifiants.
5. **TDD** : test qui échoue → implémentation minimale → test qui passe → commit.
6. **Un commit par tâche**, message conventionnel (`feat:`, `fix:`, `docs:`, `chore:`).
7. Toute nouvelle vue arrive avec **un test** et **une capture d'écran** dans `docs/qa/`.

## Style

- Rust : `cargo fmt`, pas de `unwrap()` sur des entrées externes, erreurs typées (`thiserror`).
- TS : `strict`, pas de `any`, composants fonctionnels, pas de state global en V0.
- CSS : tokens de `web/src/styles/theme.css` ; ne pas réintroduire de couleurs en dur.
- UI : boutons à **une seule icône** + `aria-label` ; halos dorés réservés à « a besoin de toi ».

## Structure

```
web/      interface (React, Vite, vitest)
server/   service Rust (axum, sqlx, reqwest)
docs/     architecture, QA, captures
```
