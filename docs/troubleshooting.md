# Dépannage

## L'application affiche l'accueil mais aucune session

Le service local n'est pas lancé, ou il ne trouve pas `state.db`.

```bash
curl -s http://127.0.0.1:8791/api/health
```

- `db: "down"` → chemin incorrect : vérifier `HERMES_HOME` (le service journalise le chemin
  utilisé au démarrage).
- Rien ne répond → lancer `cargo run --release --manifest-path server/Cargo.toml`.

Les pastilles de l'accueil résument l'état : `● api · ● base · ● opencode`.

## « le serveur n'a rien renvoyé en 6 s »

Le service répond mais l'API Hermes ne démarre pas de tour. Vérifier que l'API server
Hermes est active (`API_SERVER_ENABLED=true`) et que `HERMES_API_BASE` pointe au bon port.

## Un message dans une conversation du CLI ne répond pas tout de suite

C'est normal : ces conversations sont pilotées par `hermes --resume`, qui recharge tout le
contexte. Sur une conversation de plusieurs milliers de messages, cela peut prendre
plusieurs minutes. L'écran l'indique, et un délai de 5 minutes affiche une erreur claire.

## La dictée ne fait rien

```bash
curl -s http://127.0.0.1:8791/api/dictation/status
```

- `engine: "browser"` → aucun moteur local : vérifier `COCKPIT_SHERPA_ADDON` et
  `COCKPIT_SPEECH_MODEL`, et que `node` est dans le `PATH`.
- `engine: "local"` mais erreur au clic → autoriser le micro dans l'application et lire
  l'infobulle du bouton.

## L'aperçu reste vide

Aucun serveur n'a été reconnu **pour ce projet**. Lancer le serveur de développement du
projet, puis rouvrir la conversation. On peut aussi saisir l'URL à la main.

## Les modifications ne s'affichent pas dans l'application desktop

L'interface est servie par le service local : reconstruire le front
(`pnpm -C web build`) puis recharger. L'index HTML est en `no-store`, donc un simple
rechargement suffit.

## Le port 8791 est déjà utilisé

```bash
netstat -ano | grep :8791
```

Arrêter l'ancien processus, ou lancer le service ailleurs (`PORT=8801`).

## Windows : `cargo` échoue avec « couldn't create a temp dir »

La variable `TMP`/`TEMP` pointe vers un dossier inaccessible. Dans le terminal utilisé :

```bash
unset tmp
```

## Les tests UI échouent par intermittence

`src/components/ascii/perf.test.ts` mesure un budget de rendu (4 ms/frame) et peut échouer
si la machine est chargée (build en parallèle). Le relancer seul suffit :

```bash
pnpm -C web test -- src/components/ascii/perf.test.ts
```

## Le sélecteur de modèle sort de l'écran

Corrigé : il s'ouvre vers le haut. Si un ancien bundle est encore chargé, reconstruire le
front et recharger.

## Les barres de défilement sont épaisses

Corrigé : barres fines, transparentes au repos, sans flèches. Même remarque : reconstruire
le front.
