# Démonstration client : déroulé de 15 minutes

Données fictives uniquement (ADR-016). Tout ce qui est affiché est inventé pour la démonstration : noms, chiffres, numéros. Aucun chiffre n'est une référence (pas de courbe de souche, pas de programme de vaccination, pas de SMAG).

## Avant la séance (la veille)

- Base vide, puis `pnpm db:seed` et `pnpm db:seed:demo` avec `DEMO_PHONE`, `DEMO_PASSWORD` et le même `BETTER_AUTH_SECRET` que sur Vercel (sinon les codes d'invitation affichés ne fonctionnent pas). La bande en cours vieillit d'un jour chaque jour : semer la veille.
- Connexion du propriétaire démo : le numéro `DEMO_PHONE` (par défaut `+212600000099`, soit `0600000099`) et le mot de passe `DEMO_PASSWORD`. Sans `DEMO_PASSWORD`, le script imprime un mot de passe généré, une seule fois. Relancer le script avec `DEMO_PASSWORD` change le mot de passe sans toucher aux données.
- `DEMO_MODE=1` sur le serveur : le bandeau « Démonstration — données fictives uniquement » s'affiche sur chaque page.
- Le script imprime aussi les codes d'invitation du vétérinaire (`0600000097`) et du comptable (`0600000096`). Les garder pour l'étape 9.
- Un téléphone Android avec Chrome : se connecter une fois en ligne, ouvrir « Aujourd'hui », un lot et « Stock », puis installer l'application (étape 10). L'ordinateur pour l'écran large et les PDF.

Ce que contient la démo :

- **Ferme Démo Ben Ahmed** (exploitant individuel, livre des recettes et des dépenses) :
  - une bande de chair clôturée (42 jours, vendue à trois acheteurs, nettoyage et désinfection ensuite) ;
  - une bande en cours au jour 24 (traitement en délai d'attente, visite vétérinaire, budget) ;
  - une bande planifiée dans 12 jours ;
  - un lot de 5 000 pondeuses avec trois semaines de ramassage ;
  - deux employés et la paie du mois dernier ;
  - les documents ONSSA, dont l'autorisation qui expire dans 25 jours.
- **SARL Démo Avicole** (société, comptabilité complète et états de synthèse) : une bande clôturée, une bande en cours.

La saisie du jour de la bande en cours et le ramassage du jour des pondeuses sont laissés vides exprès : ce sont eux qu'on saisit devant le client.

## Déroulé

| # | Écran | Quoi cliquer | Quoi dire | Min |
|---|---|---|---|---|
| 1 | Connexion | « Téléphone ou e-mail » : `0600000099`, le mot de passe, « Se connecter ». | Un numéro de téléphone et un mot de passe, rien d'autre à retenir. Le bandeau rappelle que tout est fictif. | 0,5 |
| 2 | Aujourd'hui (téléphone) | Montrer la frise de la bande (jour 24) et les tâches du jour. Toucher « Saisie du jour · Bâtiment 1 ». | L'éleveur ouvre l'application le matin : ce qui reste à faire est là. | 1 |
| 3 | Saisie du jour, **hors ligne** | Mettre le téléphone en mode avion. Saisir morts, aliment, eau, puis enregistrer. Ouvrir « Synchronisation » : la saisie attend. Couper le mode avion : elle part. | Au bâtiment il n'y a souvent pas de réseau. Rien n'est perdu : la saisie part toute seule au retour du réseau. Moins d'une minute par jour. | 2 |
| 4 | Lots › bande en cours | Indicateurs : mortalité, poids moyen, indice de consommation. Le traitement en délai d'attente bloque une vente. | Les chiffres se calculent seuls à partir des saisies. Le délai d'attente vient de l'ordonnance, pas d'une valeur par défaut. | 1,5 |
| 5 | Lots › bande clôturée | Coût au kilo, marge. « Rapport de bande », puis « Registre de suivi sanitaire » (PDF). | À la fin de la bande, le résultat est connu tout de suite, au kilo. Le registre de l'arrêté 2126-05 est prêt à imprimer. | 1,5 |
| 6 | Ventes et créances | Plus › Argent › « Créances » : Hamid dépasse son plafond de crédit ; le chèque de l'abattoir est à remettre en banque. | On sait qui doit combien, et qui ne doit plus acheter à crédit. | 1,5 |
| 7 | L'argent | La carte « Argent » de l'accueil, puis Trésorerie : caisse, banque, virement, dettes fournisseur (aliment à crédit), poussins à payer. Dépenses rapides (électricité, vétérinaire). Budget de la bande en cours. | Combien j'ai, combien je dois, combien on me doit. Le budget dit à quel prix au kilo la bande couvre ses coûts. | 2 |
| 8 | Conformité ONSSA | Plus › Conformité : documents (autorisation bientôt expirée, assurance expirée), visiteurs, nettoyage et désinfection, dératisation, cadavres. Ouvrir le « Dossier d'inspection ». | Le jour du contrôle, tout est dans un seul dossier, avec ce qui manque. | 1,5 |
| 9 | Comptable et vétérinaire | Plus › Compte › Membres : les deux invitations en attente. Plus › Compte › « Changer d'exploitation » : ouvrir la SARL, puis Plus › Argent › « États de synthèse ». Option : sur un 2e navigateur, « J'ai un code d'invitation » avec `0600000096` et son code, pour montrer la vue du comptable. | Le comptable lit les états sans ressaisir. Pour un exploitant individuel, c'est le livre des recettes et des dépenses. Un partenaire a un accès limité, avec une date de fin. | 1,5 |
| 10 | Arabe et installation | Changer la langue en arabe : l'écran passe de droite à gauche. Puis installer l'application (menu ⋮ de Chrome › « Installer l'application »). | Arabe et français, rien d'autre en v1. Pas de boutique d'applications : elle s'installe depuis le navigateur. | 1 |
| 11 | Pondeuses et équipe (si le temps le permet) | Lot de pondeuses : taux de ponte, stock d'œufs, vente d'œufs. Équipe : présences, tâche quotidienne, avance, paie du mois. Climat : relevés et la coupure de courant. | Le même outil pour la chair, la ponte et le personnel. | 1 |

## Questions à poser au client

Noter les réponses par parcours, mot pour mot si possible.

- **Saisie du jour** : combien de temps y passez-vous aujourd'hui, et sur quoi (cahier, WhatsApp) ? Qui saisirait : vous, le chef d'équipe, l'ouvrier ? Manque-t-il un champ ?
- **Hors ligne** : y a-t-il du réseau dans vos bâtiments ? Quel téléphone ont vos ouvriers ?
- **Indicateurs de bande** : quels chiffres regardez-vous vraiment ? Lesquels montrez-vous à votre vétérinaire ou à votre fournisseur ?
- **Ventes et créances** : comment suivez-vous les crédits des acheteurs ? Un plafond par acheteur vous aiderait-il ? Chèques, traites : combien par mois ?
- **Argent** : la carte « Argent » répond-elle à votre première question du matin ? Faites-vous un budget avant une bande ?
- **ONSSA** : quels documents vous demande-t-on au contrôle ? Le dossier d'inspection ressemble-t-il à ce qu'on vous demande ?
- **Comptable** : qui tient votre comptabilité ? Sous quelle forme lui donnez-vous les pièces ? Exploitant individuel ou société ?
- **Langue** : arabe ou français, pour vous et pour vos ouvriers ?
- **Installation** : accepteriez-vous d'installer depuis le navigateur plutôt que depuis le Play Store ?
- **En général** : qu'est-ce qui vous ferait l'utiliser dès demain ? Qu'est-ce qui vous en empêcherait ? Combien seriez-vous prêt à payer, et par quoi (mois, bande, bâtiment) ?
