# Utilisation

## Accueil

L'accueil propose un champ unique : on tape sa demande, **Entrée** envoie,
**Maj+Entrée** passe à la ligne. « Vue complète » ouvre le cockpit (sessions, agents,
aperçu). L'engrenage des options se trouve à côté du nom de l'application, dans la barre
latérale, et l'entrée « Accueil » ramène au lagon.

## Envoyer un message

1. Choisir une conversation à gauche, ou « Nouvelle session ».
2. Taper le message ; **Entrée** envoie.

À savoir :

- Si un tour est **déjà en cours** sur cette conversation, le message est mis en file et
  part dès la fin du tour courant (l'indice s'affiche au-dessus du champ).
- Une conversation **du CLI** (origine `local`) est pilotée par son propre transport
  (`hermes --resume`). Le message arrive **dans cette conversation**, jamais dans une
  nouvelle ; la réponse peut prendre du temps, le CLI rechargeant tout le contexte.
- Une réponse qui n'arrive pas au bout de 6 s (API) ou 5 min (CLI) affiche une erreur
  explicite au lieu de tourner dans le vide.

## Barre d'effort

À droite du champ : un curseur à cinq crans (Rapide, Standard, Approfondi, Intense,
Ultra). Le niveau est écrit à côté de la piste, qui s'épaissit au survol ; des points
scintillent d'autant plus que le niveau est haut.

Le réglage part de deux façons : `model_options.reasoning.effort` (exploité par les
fournisseurs qui le gèrent) **et** une consigne système adaptée, pour que l'effet soit
visible partout. Mesure sur la même question : 239 caractères en « Rapide » contre 305 en
« Ultra ».

## Modèle

Le sélecteur de modèle est à droite du champ. Il liste les fournisseurs et modèles
réellement disponibles (plusieurs centaines) avec une recherche. Le choix s'applique au
tour suivant. Le panneau s'ouvre **vers le haut** pour ne jamais sortir de la fenêtre.

## Coller une image

**Ctrl+V** dans le champ : les images deviennent des vignettes, puis partent avec le
message. Le bouton × retire une vignette. Les sessions du CLI ne transmettent pas les
images — l'application le signale.

## Menu « / »

Taper `/` ouvre la liste : commandes intégrées (`/new`, `/plan`, `/goal`, `/loop`,
`/model`, `/skill`, `/skills`, `/save`, `/history`, `/help`) puis les skills installés.
Filtrer en continuant à taper, naviguer avec ↑/↓, insérer avec **Entrée** ou **Tab**,
fermer avec **Échap**.

## Dictée

Le micro est à droite du champ. Premier clic : écoute ; second clic : transcription
**locale** (sherpa-onnx + Parakeet) et insertion dans le champ. Aucune connexion sortante.
Micro refusé ou moteur absent : le bouton passe en erreur avec l'explication en infobulle.

## Sous-agents

Dans la barre latérale, les sous-agents apparaissent **sous leur conversation**. Chacun a
un avatar déterministe, un anneau pulsé tant qu'il tourne, et une croix pour le masquer.
Un sous-agent terminé disparaît seul au bout de 10 minutes. Ouvrir la conversation d'un
sous-agent affiche un bouton **←** qui ramène à la conversation principale.

## Ultracode

Le bouton ⚡ lance **trois conversations en parallèle** sur le texte en cours de saisie :
implémentation, revue, vérification. Une animation plein écran accompagne le travail et
trois pastilles montrent l'état réel de chaque agent. **Arrêter** coupe les trois tours et
éteint l'animation ; changer de conversation aussi.

## Aperçu web

Le panneau de droite affiche le serveur de développement **du projet dont parle la
conversation** : l'application reconnaît le nom du projet dans les messages, demande au
service quels ports sont écoutés **depuis ce dossier**, et charge cette URL. Sans serveur
trouvé, elle l'écrit au lieu de montrer le projet d'à côté.

Cadres : Desktop (1280×800), iPhone 15 (390×844), Pixel 8 (412×915), iPad mini (744×1133).
Le bouton ⟳ recharge réellement le cadre.

## Panneaux redimensionnables

Poignée sur le bord droit de la barre latérale, poignée sur le bord gauche de l'aperçu :
glisser pour ajuster, double-clic pour revenir à la largeur par défaut. La largeur est
mémorisée.

## Thème

Clair, sombre ou système, dans les options. Le choix est mémorisé et appliqué au démarrage.

## Raccourcis

| Touche | Effet |
|---|---|
| Entrée | envoyer |
| Maj+Entrée | nouvelle ligne |
| `/` | menu des commandes et skills |
| ↑ / ↓ | naviguer dans le menu `/` |
| Entrée / Tab | insérer l'entrée du menu |
| Échap | fermer le menu |
