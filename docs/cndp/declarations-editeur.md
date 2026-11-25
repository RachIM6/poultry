# Formalités CNDP de l'éditeur : projets de déclarations

> **Projet — à faire relire par un juriste / la CNDP.** Rien ici n'est un avis juridique. Rédigé le 24/11/2026 ; chaque règle citée renvoie à son article. Les crochets `[ ]` sont à remplir par l'éditeur.

L'éditeur de l'application a deux rôles :

- **sous-traitant** des exploitations pour leurs données (loi 09-08, art. 1.6 et 23). Pour ces données, ce sont les exploitations qui déposent ([declarations-exploitation.md](declarations-exploitation.md)) ; l'éditeur signe avec chacune le [contrat de sous-traitance](contrat-sous-traitance.md) ;
- **responsable du traitement** (art. 1.5) des fichiers dont il fixe lui-même les finalités et les moyens : ses clients (les exploitants abonnés) et les comptes de connexion de la plateforme avec leur journal de sécurité. Il les notifie avant de les mettre en œuvre (art. 12 et 14).

| # | Traitement | Formulaire | Base |
|---|---|---|---|
| A | Gestion des clients de l'éditeur | **F-214** | Délibération n° 32-2015 du 13/02/2015 |
| B | Comptes de connexion et sécurité de la plateforme | **F-211** | Loi 09-08, art. 12.2 et 15 |
| — | Hébergement ou prestataire à l'étranger | **F-118**, un par destinataire | Loi 09-08, art. 43–44 ; délibération n° 236-2015 |

Responsable : [raison sociale de l'éditeur], [forme], [adresse], RC n° [ ], [juridiction], représentée par [nom, qualité]. Contact pour les droits : [nom, qualité, téléphone, courriel].

## A. Gestion des clients de l'éditeur (F-214, délibération n° 32-2015)

> **Partie A du F-214 :** Conformément à la décision n° 32-2015. Dénomination : Gestion des clients. Finalité : contrats d'abonnement, facturation, encaissements et assistance aux exploitations clientes. Transfert à l'étranger : [Oui / Non].

| Élément | Contenu | Dans la délibération |
|---|---|---|
| Personnes | Exploitants clients et leurs représentants | §1 : clients et représentants des clients personnes morales |
| Finalités | Contrats, factures, comptes clients | §2 |
| Données | Nom, téléphone, adresse, raison sociale ; contrat ; factures et règlements ; échanges avec l'assistance | §3.a à §3.d |
| Conservation | Durée de la relation ; pièces comptables 10 ans (loi n° 9-88, art. 22) | §4 |
| Information | Clause dans le contrat d'abonnement, avec le n° de récépissé | §5 |

**À vérifier avant de déposer** : ce fichier n'existe peut-être pas encore (pas de facturation dans l'application). Le déposer quand l'éditeur aura des clients réels.

## B. Comptes de connexion et sécurité de la plateforme (F-211)

L'éditeur décide seul comment on se connecte et ce qui est journalisé : il en est le responsable. Un même compte (un téléphone) peut appartenir à plusieurs exploitations.

**Partie A**

> Dénomination : Comptes de connexion et sécurité de la plateforme.
> Finalité : permettre aux membres des exploitations de se connecter par leur numéro de téléphone ; protéger la plateforme contre les abus (limitation des tentatives, captcha) ; garder la trace des connexions pour enquêter sur un incident.
> Transfert à l'étranger : [Oui / Non].

**Rubrique V, catégories de données**

| Données | Personnes | Origine | Destinataires | Qui y accède | Conservation |
|---|---|---|---|---|---|
| Téléphone, nom, langue de l'interface | Membres des exploitations (propriétaires, gérants, ouvriers, comptables et vétérinaires invités) | La personne concernée | Prestataire SMS (envoi du code) ; hébergeur | Équipe technique de l'éditeur | Durée du compte ; supprimé quand la personne n'est plus membre d'aucune exploitation ([data-requests](../data-requests.md)) |
| Codes de connexion en attente | Idem | Généré par la plateforme | Prestataire SMS | Personne (valeur non affichée) | Valables 5 minutes ; effacement des lignes expirées [à vérifier] |
| Sessions ouvertes : adresse IP et navigateur au moment de la connexion | Idem | La connexion | Hébergeur | Équipe technique | Expirent 30 jours après la dernière utilisation, 90 jours au plus |
| Journal des connexions : action, résultat, téléphone masqué (`+2126•••••12`), adresse IP tronquée (sous-réseau /24 ou /64), navigateur tronqué | Toute personne qui tente de se connecter | La connexion | Hébergeur | Équipe technique | Proposition : 12 mois (aucune règle encore ; décision à prendre, étude §3, tâche C3) |
| Abonnements aux notifications (adresse technique fournie par le navigateur) | Membres qui activent les notifications | Le navigateur | Service de notification du navigateur (Google, Mozilla, Apple selon le téléphone) ; hébergeur | Équipe technique | Jusqu'à la désactivation ou la suppression du compte |

**Points à vérifier avant de déposer**

- **Les services de notification des navigateurs** sont des destinataires étrangers. Le contenu des notifications leur arrive chiffré (protocole Web Push), mais ils reçoivent l'adresse d'abonnement et l'heure d'envoi. Le juriste dira si c'est un transfert au sens de l'art. 43.
- **L'adresse IP des sessions** est écrite par la bibliothèque d'authentification ; vérifier si elle est complète, et la tronquer comme dans le journal.
- **Le prestataire SMS** n'est pas encore choisi (OQ2). S'il est à l'étranger : F-118.

**Rubriques VI à IX**

| Rubrique | À remplir |
|---|---|
| VI. Consentement | Non requis : nécessaire au contrat de service (art. 4.b) et à la sécurité (intérêt légitime, art. 4.e). À valider. |
| VII. Droits | Notice affichée sur l'écran de connexion et dans les conditions d'utilisation [à rédiger] ; contact : [ ] |
| VIII. Interconnexion | Non |
| IX. Sécurité | Voir l'[annexe 2 du contrat de sous-traitance](contrat-sous-traitance.md#annexe-2--mesures-de-sécurité) |

## Transferts à l'étranger (F-118)

Un F-118 par destinataire étranger, déposé avec les déclarations A et B : l'hébergeur de l'application, la base de données, le prestataire SMS s'il est à l'étranger. Contenu : comme le [F-118 de l'exploitation](declarations-exploitation.md#formulaire-f-118--hébergement-à-létranger), avec l'éditeur comme responsable. Aucun transfert avant le « récépissé de transfert de données à l'étranger » (formulaire F-113, rubrique IV) ; pour un pays absent de la liste de la délibération n° 236-2015, comme les États-Unis, l'autorisation expresse de la CNDP est nécessaire (loi 09-08, art. 44.3).

## Ce que l'éditeur ne dépose pas

Les traitements des exploitations (salariés, acheteurs, fournisseurs, registre sanitaire, visiteurs) : chaque exploitation les dépose en tant que responsable. L'éditeur y figure comme sous-traitant (F-211 rubrique III, et art. 15.i : la sous-traitance est déclarée par le responsable).
