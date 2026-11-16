# Contrat de sous-traitance de données personnelles (article 28 du RGPD)

> Modèle à faire relire par un avocat ou un juriste avant signature.

**Entre** [NOM DE L'ATELIER], [forme], [adresse], SIRET [ ], représenté par [ ], ci-après « le Responsable de traitement »,

**et** [NOM DU PRESTATAIRE], [statut], [adresse], SIRET [ ], ci-après « le Sous-traitant »,

annexé au contrat de prestation du [date] portant sur la fourniture et l'hébergement du logiciel Warsha Studio, édition atelier.

## 1. Objet

Le Sous-traitant traite des données personnelles pour le compte du Responsable de traitement, uniquement pour fournir, héberger, sauvegarder et maintenir le logiciel décrit au contrat de prestation.

## 2. Description du traitement

| | |
|---|---|
| Finalités | Conception de projets d'aménagement pour les clients de l'atelier, établissement et conservation des devis, partage de projets avec les clients, gestion des comptes des utilisateurs de l'atelier. |
| Personnes concernées | Clients et prospects de l'atelier ; utilisateurs de l'atelier (patron, salariés). |
| Données | Clients : nom, téléphone, notes libres saisies par l'atelier, plans et dimensions des pièces, photos de pièces éventuellement jointes à l'assistant, devis (montants), nom saisi lors de l'acceptation d'un devis. Utilisateurs : nom, adresse e-mail, empreinte du mot de passe (Argon2id), appareils et horaires de connexion. |
| Données sensibles | Aucune. L'atelier s'engage à ne pas en saisir dans les notes. |
| Opérations | Enregistrement, conservation, consultation, synchronisation entre appareils, sauvegarde chiffrée, export, effacement. |
| Lieu | Serveur [OVH, centre de données en France / UE, à préciser] ; sauvegardes chiffrées chez [Hetzner Online GmbH, Allemagne / Backblaze, préciser la région UE]. |
| Durée | Celle du contrat de prestation, puis restitution (article 10). |

## 3. Obligations du Sous-traitant

Le Sous-traitant :

1. traite les données uniquement sur instruction documentée du Responsable de traitement, y compris pour les transferts ; s'il estime qu'une instruction viole la réglementation, il l'en informe immédiatement ;
2. garantit la confidentialité des données et veille à ce que toute personne autorisée à les traiter soit tenue au secret ;
3. met en œuvre les mesures de sécurité de l'annexe 1 ;
4. ne recrute un autre sous-traitant qu'avec l'autorisation écrite préalable du Responsable de traitement ; les sous-traitants autorisés à la signature sont listés à l'annexe 2 ; il impose à chacun les mêmes obligations et reste responsable de leur exécution ;
5. aide le Responsable de traitement à répondre aux demandes d'exercice des droits (accès, rectification, effacement, limitation, portabilité, opposition) ; le logiciel fournit à cet effet une recherche par personne, un export et un effacement ;
6. aide le Responsable de traitement à garantir la sécurité, à notifier les violations et, le cas échéant, à réaliser une analyse d'impact ;
7. notifie au Responsable de traitement toute violation de données personnelles dans un délai maximal de [48] heures après en avoir pris connaissance, avec les informations utiles à sa propre notification à la CNIL ;
8. met à disposition les informations nécessaires pour démontrer le respect de ses obligations et permet des audits, à raison d'un par an au plus sauf violation, avec un préavis de [30] jours ;
9. tient un registre des catégories de traitements effectués pour le compte du Responsable de traitement.

## 4. Obligations du Responsable de traitement

Il fournit les données et instructions, informe ses clients (modèle `information-clients.md`), fixe les durées de conservation, veille au respect du RGPD par ses utilisateurs, et conserve hors du serveur une copie de la clé de chiffrement des sauvegardes.

## 5. Durées de conservation

Fixées par le Responsable de traitement ; proposition par défaut, que le logiciel affiche dans son rapport de conservation (aucun effacement automatique) :

| Données | Durée |
|---|---|
| Prospects sans devis | 3 ans après le dernier contact |
| Clients avec devis | 3 ans après la fin de la relation commerciale ; les devis eux-mêmes 10 ans (pièces commerciales et comptables) |
| Corbeille | 30 jours puis suppression définitive, sauf projet cité par un devis |
| Comptes utilisateurs | Durée du contrat de travail ou de la prestation ; désactivés, jamais supprimés, pour conserver la traçabilité |
| Journal d'audit | Durée du contrat (ne contient pas de données des clients) |
| Sauvegardes | 14 sauvegardes quotidiennes, 8 hebdomadaires, 24 mensuelles : une donnée effacée disparaît des sauvegardes au plus tard 24 mois après |

## 6. Sort des données en fin de contrat

À la fin du contrat, au choix du Responsable de traitement exprimé par écrit : (a) restitution de toutes les données sous la forme de l'export complet du logiciel (format JSON importable par la version autonome, devis en PDF avec leur empreinte, CSV), ou (b) transfert vers un prestataire désigné. Puis destruction des données et des sauvegardes chez le Sous-traitant dans un délai de [30] jours, attestée par écrit. Les sauvegardes déjà chiffrées dont la clé a été remise au Responsable de traitement peuvent lui être transférées au lieu d'être détruites.

## Annexe 1 : mesures de sécurité

- Chiffrement des échanges en HTTPS (TLS) ; HSTS.
- Mots de passe stockés en empreinte Argon2id ; 10 caractères minimum ; blocage après échecs répétés.
- Sessions par jeton aléatoire, seule l'empreinte est stockée ; déconnexion de tout appareil par le patron.
- Contrôle d'accès par rôles (patron, compagnon) ; liens clients en lecture seule, limités dans le temps, révocables, avec code facultatif.
- Devis figés par la base de données (modification et suppression impossibles) ; journal d'audit en ajout seul.
- Base de données sans accès réseau extérieur ; conteneurs isolés, sans privilèges.
- Sauvegardes quotidiennes chiffrées (AES-256) hors du serveur principal ; test de restauration automatique hebdomadaire.
- Mises à jour de sécurité du système et des dépendances appliquées au moins [mensuellement].

## Annexe 2 : sous-traitants ultérieurs autorisés

| Sous-traitant | Rôle | Localisation |
|---|---|---|
| [OVH SAS] | Hébergement du serveur | [France] |
| [Hetzner Online GmbH] ou [Backblaze] | Stockage des sauvegardes chiffrées (le sous-traitant ne peut pas les lire) | [Allemagne / UE] |
| Anthropic (uniquement si l'assistant est activé par l'atelier) | Analyse du texte de la demande et de l'image jointe pour proposer un aménagement | [États-Unis : vérifier le mécanisme de transfert applicable, par exemple le cadre UE–États-Unis ou des clauses contractuelles types] |

Fait à [ ], le [ ], en deux exemplaires.
