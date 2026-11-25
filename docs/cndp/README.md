# Dossier CNDP (loi n° 09-08) : projets de documents

> **Projet — à faire relire par un juriste / la CNDP.** Rien ici n'est un avis juridique. Rédigé le 24/11/2026 à partir des seuls textes cités ci-dessous, lus ce jour-là. Aucun document n'a encore été relu ni déposé.

Ces documents préparent les formalités de la loi n° 09-08 pour l'application de gestion d'élevage :

- **chaque exploitation** est responsable du traitement de ses données (loi 09-08, art. 1.5) et dépose ses propres formalités ;
- **l'éditeur** de l'application est son sous-traitant (art. 1.6, art. 23) pour ces données, et responsable de ses propres fichiers (comptes, journal de connexion, clients de l'éditeur).

La décision d'hébergement et de transfert est l'[ADR-016](../decisions/ADR-016-hosting-and-transfers.md). L'étude source est [expert-free-defaults-2026-11-24](../studies/expert-free-defaults-2026-11-24.md), section 3.

| Document | Pour qui | Contenu |
|---|---|---|
| [declarations-exploitation.md](declarations-exploitation.md) | Chaque exploitation | Les 4 traitements à notifier, prêts à recopier dans les formulaires F-113, F-214 et F-211, et le F-118 si l'hébergement est à l'étranger |
| [declarations-editeur.md](declarations-editeur.md) | L'éditeur | Ses propres formalités : clients de l'éditeur (F-214), comptes et sécurité de la plateforme (F-211), F-118 |
| [contrat-sous-traitance.md](contrat-sous-traitance.md) | Exploitation et éditeur | Modèle de contrat de sous-traitance (art. 23) |
| [notices-information.md](notices-information.md) | Salariés, acheteurs, visiteurs, fournisseurs | Notices d'information (art. 5), clause du contrat de travail, clause fournisseurs |

## Comment déposer : liste de contrôle

À cocher par l'exploitant (et par l'éditeur pour ses propres fichiers), **avant la première donnée réelle** (ADR-016).

1. **Hébergement choisi** (ADR-016 §3) :
   - au Maroc : pas de F-118 pour l'hébergement ;
   - à l'étranger : un F-118 par destinataire étranger (hébergeur, base de données, prestataire SMS), déposé **en même temps** que les déclarations (F-211 et F-214, partie A : « devra faire l'objet d'une demande simultanée »).
2. **Contact pour les droits** désigné : la personne ou le service à qui les salariés, acheteurs et visiteurs s'adressent (loi 09-08, art. 15.g ; rubrique « Droits des personnes concernées » des formulaires).
3. **Pièces jointes prêtes** (procédure de notification de la CNDP du 24/07/2025) :
   - [ ] la notice d'information de chaque traitement ([notices-information.md](notices-information.md)) ;
   - [ ] RH : le modèle de contrat de travail avec sa clause de protection des données, et le document de consentement ;
   - [ ] fournisseurs : le modèle de contrat ou de bon de commande avec sa clause de protection des données ;
   - [ ] le contrat de sous-traitance signé avec l'éditeur ([contrat-sous-traitance.md](contrat-sous-traitance.md)) ;
   - [ ] le document attestant du pouvoir de signature de la personne qui signe les formulaires.
4. **Formulaires remplis**, un par traitement ([declarations-exploitation.md](declarations-exploitation.md)) :
   - [ ] F-113, ressources humaines (délibération n° 298-AU-2014) ;
   - [ ] F-214, clients (délibération n° 32-2015) ;
   - [ ] F-113, fournisseurs (délibération n° 98-AU-2015) ;
   - [ ] F-211, suivi sanitaire, visiteurs et intervenants (déclaration normale) ;
   - [ ] F-118, si hébergement à l'étranger.
5. **Envoi à la CNDP** (décret n° 2-09-165, art. 24) : par lettre recommandée, par remise au secrétariat contre reçu, ou par voie électronique avec accusé de réception.
   - Adresse : Avenue Al Arz, Secteur 4, M1, Hay Riad, Rabat. Courriel : contact@cndp.ma. Téléphone : 3020 (site de la CNDP, page « Notifier une déclaration », consultée le 24/11/2026).
   - **Plateforme en ligne : non confirmée.** Aucune adresse de dépôt en ligne n'a été trouvée sur le site. Demander à la CNDP par quel canal déposer.
6. **Attendre la réponse** :
   - déclaration : récépissé sous 24 heures, et le traitement peut commencer dès sa réception (art. 19) ; la CNDP peut, dans les 8 jours, le soumettre à autorisation (art. 20) ;
   - autorisation (F-113) : décision dans un délai de deux mois (décret, art. 24) ;
   - transfert à l'étranger : pas de transfert avant l'accord exprès de la CNDP, par un « récépissé de transfert de données à l'étranger » (formulaire F-113, rubrique IV).
7. **Après le dépôt** :
   - [ ] reporter le numéro du récépissé ou de l'autorisation dans chaque notice et chaque document de collecte (art. 5.1.d, art. 19) ;
   - [ ] garder une copie de chaque dossier déposé et de chaque réponse ;
   - [ ] signaler sans délai à la CNDP toute modification d'un traitement ou sa suppression, avec le numéro d'enregistrement initial (art. 15, avant-dernier alinéa) ;
   - [ ] tenir un registre des demandes d'accès, de rectification et d'opposition, et de leurs réponses ([data-requests](../data-requests.md)).

### Points à faire trancher par le juriste ou la CNDP

- **Exploitant sans registre de commerce.** Le N° RC est obligatoire (*) dans la partie A du F-214 et figure dans les autres formulaires. Un agriculteur personne physique n'en a pas toujours. Que mettre ?
- **Les durées de conservation** proposées dans [declarations-exploitation.md](declarations-exploitation.md). Aujourd'hui l'application ne supprime aucun enregistrement tant que l'exploitation utilise le service ; elle ne supprime qu'à son départ ([data-requests](../data-requests.md)).
- **Le registre sanitaire et le registre des visiteurs** : faut-il une déclaration normale (F-211), ou l'un d'eux relève-t-il d'un autre régime ? Aucune délibération type ne les couvre.
- **L'adresse IP enregistrée avec chaque session** (`Session.ipAddress`, écrite par la bibliothèque d'authentification) : à vérifier, et à tronquer comme dans le journal de connexion si elle est complète.

## Sources

Toutes lues le 24/11/2026.

| Texte | Où |
|---|---|
| Loi n° 09-08 (dahir n° 1-09-15 du 18/02/2009, BO n° 5714 du 05/03/2009, p. 345), texte consolidé avec les articles du décret n° 2-09-165 en notes | <https://adala.justice.gov.ma/api/uploads/2024/04/30/Protection%20des%20personnes%20physiques-1714464099884.pdf> |
| Décret n° 2-09-165 du 21/05/2009 (BO n° 5744 du 18/06/2009, p. 1006) | Lu seulement à travers les notes du texte consolidé ci-dessus |
| Délibération n° 298-AU-2014 du 11/04/2014 (ressources humaines, autorisation type) | <https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-298-AU-2014-11-04-2014.pdf> |
| Délibération n° 32-2015 du 13/02/2015 (clients, déclaration type) | <https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-32-2015-13-02-2015.pdf> |
| Délibération n° 98-AU-2015 du 12/06/2015 (fournisseurs, autorisation type) | <https://www.cndp.ma/wp-content/uploads/2023/01/deliberation-n-98-AU-2015-12-06-2015.pdf> |
| Délibération n° 236-2015 du 18/12/2015 (liste des États à protection suffisante) | <https://www.cndp.ma/wp-content/uploads/2023/12/deliberation-n-236-2015-18-12-2015.pdf> |
| Formulaire F-211, déclaration normale | <https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Declaration-Normale_F211_20250910_Fr.pdf> |
| Formulaire F-214, déclaration conformément à une décision | <https://www.cndp.ma/wp-content/uploads/2025/07/CNDP-Declaration-Normale-Conformement-Decision_F214_20250724_Fr.pdf> |
| Formulaire F-113, autorisation conformément à une décision | <https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Autorisation-Prealable-Conformement-Decision-F113-20250910.pdf> |
| Formulaire F-118, transfert de données à l'étranger | <https://www.cndp.ma/wp-content/uploads/2025/09/CNDP-Transfert-Etranger-F118.pdf> |
| Procédure de notification des traitements, 24/07/2025 (pièces à fournir) | <https://www.cndp.ma/wp-content/uploads/2025/07/CNDP_Procedure-de-Notification-des-traitements_20250724.pdf> |
| Mentions types de la CNDP (dont « Sous-traitance » et « Formulaire ») | <https://www.cndp.ma/mentions-types/> |
| Arrêté n° 2126-05 (registre de suivi sanitaire), loi n° 49-99 | [docs/sources/onssa](../sources/onssa/README.md), S1 et S3 |
| Loi n° 9-88, art. 22 (conservation des pièces comptables : 10 ans) | [data-requests](../data-requests.md) |
