# Aperçu web

## Objectif

Voir l'application **du projet dont on parle**, dans un cadre d'appareil, sans quitter le
cockpit — et sans jamais afficher l'application d'un autre projet.

## Comment le projet est reconnu

1. Le front envoie le texte des derniers messages (`hint`, 4000 caractères).
2. Le service compare ce texte aux **noms de dossiers** présents sous les racines de
   projets (`COCKPIT_PROJECT_ROOTS`, sinon `<profil>/Dev`). Les projets cités le plus
   récemment sont essayés en premier.
3. Pour chaque projet candidat, il demande à Windows quels ports sont écoutés par des
   processus dont la ligne de commande contient ce dossier
   (`Win32_Process` + `Get-NetTCPConnection`), puis vérifie que le port répond.
4. Le premier port valide est renvoyé avec le nom du projet.

Résultat mis en cache 10 secondes par projet.

## Ce qui n'est plus fait

Il existait un repli « premier port usuel qui répond » (3000, 5173, 8080…). Il est
**supprimé** : c'est exactement ce qui affichait l'application d'un autre projet. Sans
correspondance, la réponse est `source: "aucun"` et l'aperçu reste vide avec un message
qui explique quoi faire.

## Cadres d'appareil

| Cadre | Taille | Densité |
|---|---|---|
| Desktop | 1280 × 800 | 1x |
| iPhone 15 | 390 × 844 | 3x |
| Pixel 8 | 412 × 915 | 2.6x |
| iPad mini | 744 × 1133 | 2x |

Le cadre s'adapte à la largeur du panneau (jusqu'à 55 % de l'échelle) et suit le
redimensionnement du rail.

## Utilisation

- L'URL se remplit seule dès qu'un serveur du projet est détecté.
- Le bouton ⟳ recharge réellement le cadre.
- Une URL saisie à la main n'est jamais écrasée par la détection.
- Sans serveur lancé : démarrer `pnpm dev` (ou équivalent) dans le projet, puis rouvrir la
  conversation — la détection se rafraîchit toutes les 15 s.

## Limites

- Un serveur lancé depuis un autre dossier (proxy global, conteneur) n'est pas reconnu :
  l'aperçu ne devine pas, il se tait.
- Le sondage ne voit que les processus dont la ligne de commande contient le chemin du
  projet.
