# Développement

## Structure

```
web/                    React 18 + Vite + TypeScript strict
  src/components/chat/       composer, transcript, barre d'effort, menu « / »
  src/components/agents/     cartes, arbre des sous-agents, avatars
  src/components/effects/    overlay Ultracode, pastilles d'agents
  src/components/ascii/      fond animé (canvas)
  src/lib/                   client API/SSE, thème, dictée, masquage des sous-agents
  src-tauri/                 coque desktop Tauri 2
server/                 Rust (axum, sqlx, tokio)
  src/routes/                observatory, chat, cli, preview, dictation, models
  src/hermes_db.rs           lectures state.db (read_only)
  src/hermes_api.rs          client de l'API Hermes
  tests/                     tests d'intégration (axum + SQLite temporaire)
  scripts/transcribe.mjs     transcription locale
```

## Boucle de travail

```bash
# service
cargo run --manifest-path server/Cargo.toml

# interface avec rechargement à chaud
pnpm -C web dev

# tests
pnpm -C web test
cargo test --manifest-path server/Cargo.toml

# types + build
pnpm -C web exec tsc -b
pnpm -C web build
```

## Conventions

- **Zéro mock en production** : les données viennent de la machine ; si une source manque,
  l'écran l'écrit.
- **Aucune écriture dans `state.db`** : un besoin d'écriture passe par l'API Hermes, jamais
  par SQL.
- **Aucun secret dans le dépôt** : `.env` est ignoré, la clé reste dans le service.
- **Aucun chemin personnel en dur** : variable d'environnement ou profil utilisateur.
- **Tests d'abord** pour une correction de comportement : un test qui échoue, le correctif,
  puis la suite complète.
- **Animations** : toujours respecter `prefers-reduced-motion`.

## Ajouter une route

1. Fonction dans `server/src/routes/<domaine>.rs` (`Result<Json<_>, ApiError>`).
2. Déclaration dans `routes/mod.rs` (`pub mod` + `.route(...)`).
3. Test dans `server/tests/<domaine>.rs` en réutilisant `tests/common/mod.rs`.
4. Contrat documenté dans `docs/api.md`.

## Ajouter un composant

1. Composant + CSS dans le dossier du domaine, test à côté (`*.test.tsx`).
2. Pas de style en ligne pour ce qui doit suivre le thème : variables de
   `styles/theme.css`.
3. Accessibilité : `role`, `aria-*` et navigation clavier quand l'élément est interactif.

## Vérifications avant de livrer

```bash
pnpm -C web exec tsc -b
pnpm -C web test
pnpm -C web build
cargo test --manifest-path server/Cargo.toml
git status --short      # aucun fichier oublié, aucun secret
git grep -nIE "(gho_|ghp_|sk-[A-Za-z0-9]{20,}|PRIVATE KEY)" -- .
```

## Release

`.github/workflows/release.yml` construit, sur tag `v*` :

- Windows (MSI + NSIS), macOS arm64 et x64 (DMG), Linux (deb + AppImage) ;
- le binaire du service local pour chaque plateforme ;
- puis publie le tout dans une release GitHub avec les notes générées.

macOS ne peut pas être compilé depuis Windows : c'est le runner GitHub qui s'en charge.

```bash
git tag v0.1.0 && git push origin v0.1.0
```
