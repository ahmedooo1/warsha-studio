# Warsha Studio, édition atelier

Une installation pour un seul atelier : une base de données, ses comptes, ses sauvegardes. Pas de multi-tenant, pas d'abonnement.
L'éditeur 3D est exactement celui du dépôt (`index.html`, `js/`, `assets/`) ; le serveur l'envoie tel quel avec un seul script en plus, `server/public/cloud.js`.

## Ce qui tourne

```
 appareils de l'atelier                 VPS OVH KVM2 (existant)
 ┌──────────────────────────┐          ┌──────────────────────────────────────────────┐
 │ éditeur (index.html)     │  HTTPS   │ reverse proxy existant  ── 1 route ──┐       │
 │ + cloud.js               │◄────────►│                                     ▼       │
 │   IndexedDB : copie      │          │  projet compose « warsha-atelier »          │
 │   locale + file d'envoi  │          │   app  (Node 22, NestJS)  127.0.0.1:8090    │
 └──────────────────────────┘          │   db   (PostgreSQL 16, aucun port ouvert)   │
 client : /v/<jeton>, lecture seule    │   backup (restic) ── chiffré ──► stockage   │
                                       └──────────────────────────────────┼───────────┘
                                                                          ▼
                                                  Hetzner Storage Box ou Backblaze B2
```

- `server/` : API et service des pages. NestJS 12, Drizzle ORM, PostgreSQL 16. Tests : `npm test` (API sur une vraie base) et `node test/browser.e2e.mjs` (deux appareils et un client dans de vrais navigateurs).
- `deploy/` : image Docker, `docker-compose.yml`, sauvegardes.
- `scripts/build-standalone.mjs` : version autonome (sortie de contrat, secours hors ligne).

## Synchronisation

Chaque projet a un numéro de version `rev` ; chaque changement accepté prend le numéro suivant d'une séquence unique du serveur (`change_seq`). Les horloges des appareils ne servent jamais à décider.

| Situation | Ce qui se passe |
|---|---|
| Enregistrer | Écrit d'abord sur l'appareil (IndexedDB) et dans la file d'envoi, puis envoyé « sur la version n » avec un identifiant de changement unique. |
| Le serveur est à n | Accepté, version n+1. L'état précédent reste dans l'historique. |
| Même identifiant renvoyé (réponse perdue) | Le premier résultat est rendu, rien n'est appliqué deux fois. |
| Le serveur n'est plus à n (un autre appareil a enregistré avant) | Refusé (409) avec la copie du serveur. L'appareil garde les deux : la version du serveur sous son nom, la sienne en copie marquée « تعارض ». L'utilisateur choisit : garder les deux, la sienne, ou l'autre. |
| Pas de réseau | Tout continue sur l'appareil. La file part au retour du réseau, même après fermeture de la page. |
| Suppression | Mise à la corbeille (30 jours) avec son historique ; une suppression sur une version dépassée est refusée et le projet revient. |
| Prix et réglages | Un document avec sa propre version, même règle. Seul le patron les enregistre ; un conflit propose « la mienne » ou « celle de l'autre appareil ». |

Historique : les 50 dernières versions de chaque projet, plus toutes celles qu'un devis cite (épinglées, jamais effacées). Revenir à une version crée une nouvelle version : l'historique ne fait que grandir.

Un changement refusé pour une autre raison (donnée invalide) n'est jamais jeté : il reste dans le panneau d'état, téléchargeable.

## Devis

1. Réserver : le serveur prend le numéro suivant de l'année (`D2026-0001`, sans trou) et fige le devis : le projet enregistré à sa version, les prix, la TVA, l'identité et les mentions de l'atelier à leur version, les lignes et totaux calculés par l'éditeur. Si le projet ou les prix à l'écran ne sont pas ceux du serveur, c'est refusé : le PDF dit toujours ce qui est gardé.
2. PDF : l'éditeur fabrique le PDF avec ce numéro et l'envoie ; il est gardé avec son SHA-256, une seule fois. Sans réseau à ce moment, il attend dans la file.
3. Ensuite, un déclencheur PostgreSQL refuse toute modification ou suppression. Acceptation, annulation, remplacement : des événements ajoutés (table en ajout seul).

## Liens clients

Jeton aléatoire de 256 bits, seul son SHA-256 est stocké. Lecture seule, durée limitée (30 jours par défaut, 180 au plus), révocable à tout moment, code PIN facultatif (5 erreurs bloquent le lien). Le client voit la pièce en mode présentation, l'identité de l'atelier et, pour un devis, son numéro, son total, le PDF et un bouton d'accord. Jamais le téléphone, les notes de l'atelier, les prix de revient ni les listes de débit.

## Sécurité

- Mots de passe Argon2id, 10 caractères minimum, blocage 15 min après 8 échecs, limitation par adresse.
- Session : jeton aléatoire en cookie httpOnly, SameSite=Lax, Secure en HTTPS ; seul son SHA-256 est en base. Le patron voit et coupe chaque appareil.
- Écritures : en-tête `x-warsha` et contrôle de l'Origin (une page d'un autre site ne peut envoyer ni l'un ni l'autre).
- Rôles : patron (prix, utilisateurs, exports, données personnelles) et compagnon (projets, devis, liens).
- En-têtes : CSP stricte (aucune connexion hors du serveur), `frame-ancestors 'none'`, HSTS en HTTPS, `Referrer-Policy: no-referrer` sur les liens clients.
- Conteneur de l'app en lecture seule, sans capacités, utilisateur non root ; la base n'a aucun port publié.
- Aucun secret dans le dépôt : tout est dans `deploy/.env` sur le serveur (`chmod 600`).

## Sauvegardes

- Chaque nuit : `pg_dump` (toutes les tables, PDF compris), chiffré par restic (AES-256) et envoyé hors du VPS. Rétention : 14 jours, 8 semaines, 24 mois.
- Chaque semaine : restauration réelle de la dernière sauvegarde dans une base temporaire, contrôle (tables, nombres de lignes, chaque PDF contre son empreinte), puis suppression de la base temporaire. Le résultat s'affiche dans la gestion de l'atelier, en rouge si une sauvegarde a plus de 30 h ou si un test a échoué.
- Testé ici : sauvegarde, test de restauration, restauration complète par-dessus une base existante (déclencheurs compris).
- La clé `RESTIC_PASSWORD` doit exister aussi hors du serveur (gestionnaire de mots de passe, papier à l'atelier). Sans elle, personne ne peut relire les sauvegardes.

## Données personnelles (RGPD)

L'atelier est responsable de traitement ; celui qui exploite le serveur est sous-traitant (article 28). Modèles dans `docs/legal/`, **à faire relire par un juriste avant signature**.

Dans la gestion de l'atelier (patron) : recherche d'une personne par nom ou téléphone, export de tout ce qui la concerne (JSON), effacement définitif. Les projets cités par un devis sont conservés (pièce commerciale, conservation légale) et la réponse le dit. Un rapport de conservation liste ce qui a dépassé sa durée (prospects 3 ans, clients 3 ans après le dernier devis, devis 10 ans) ; rien n'est effacé automatiquement. Le journal d'audit ne contient aucune donnée de client.

## Assistant de conception (facultatif)

Éteint par défaut. `AI_ENABLED=true` et une clé `ANTHROPIC_API_KEY` de l'atelier l'activent ; la clé ne quitte jamais le serveur. Plafonds par jour et par mois (`AI_DAILY_LIMIT`, `AI_MONTHLY_LIMIT`), comptés même en cas d'échec. Seuls le texte de la demande et l'image jointe sont envoyés.

## Installation sur le VPS

Prérequis : Docker et Docker Compose v2, un reverse proxy déjà en place, un sous-domaine qui pointe vers le VPS. Rien d'autre n'est modifié sur le serveur.

```sh
git clone -b atelier https://github.com/ahmedooo1/warsha-studio.git /opt/warsha-atelier
cd /opt/warsha-atelier/deploy
cp .env.example .env && chmod 600 .env        # remplir PUBLIC_URL, APP_PORT, POSTGRES_PASSWORD, SETUP_TOKEN, RESTIC_*
# clé SFTP de la Storage Box (si SFTP) :
ssh-keygen -t ed25519 -N '' -f backup/ssh/id_ed25519 && ssh-keyscan -p 23 uXXXX.your-storagebox.de > backup/ssh/known_hosts
docker compose build && docker compose up -d
docker compose logs -f app                     # « listening on 0.0.0.0:8080 »
```

Route à ajouter au reverse proxy (une seule). Pour nginx, le fichier prêt est `deploy/nginx/warsha-atelier.conf` (étapes en tête du fichier). Si nginx tourne lui-même dans un conteneur Docker, `127.0.0.1` désigne ce conteneur : il faut alors joindre l'app par un réseau Docker commun au lieu du port local.

```nginx
server {
  server_name atelier.example.fr;            # certificat comme les autres sites du serveur
  client_max_body_size 30m;
  location / { proxy_pass http://127.0.0.1:8090; proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme; }
}
```
```caddy
atelier.example.fr {
  request_body { max_size 30MB }
  reverse_proxy 127.0.0.1:8090
}
```

Premier démarrage : ouvrir l'adresse, saisir `SETUP_TOKEN`, créer le compte du patron. Puis retirer `SETUP_TOKEN` de `.env` et `docker compose up -d app`.

## Exploitation

| Tâche | Commande (dans `deploy/`) |
|---|---|
| Mettre à jour | `git pull && docker compose build app && docker compose up -d app` (les migrations passent au démarrage) |
| État | `docker compose ps`, `docker compose logs --tail 100 app` |
| Sauvegarde tout de suite | `docker compose exec backup backup.sh` |
| Test de restauration tout de suite | `docker compose exec backup restore-test.sh` |
| Restauration complète | `docker compose stop app && docker compose run --rm backup restore.sh latest && docker compose start app` |
| Liste des sauvegardes | `docker compose exec backup restic snapshots` |
| Changer de serveur | installer comme ci-dessus sur le nouveau, `restore.sh latest`, basculer le DNS |

## Fin de contrat

1. Gestion de l'atelier > Sauvegardes et export > Télécharger l'export complet : un ZIP avec `warsha-backup.json` (format que l'éditeur importe), chaque devis en PDF avec son empreinte et son instantané JSON, l'historique, le journal et des CSV.
2. `node scripts/build-standalone.mjs` donne la version autonome (dossier ou ZIP, three.js inclus). L'ouvrir, puis Clients > Importer un fichier > `warsha-backup.json`.
3. Si l'atelier garde un serveur : lui remettre le dépôt, `deploy/.env` et la clé restic ; il peut tout réinstaller seul.

## Coûts et limites connues

- Hébergement : 0 € de plus (le VPS existant). Sauvegarde externe : environ 3 à 4 € par mois (Storage Box 1 To) ou quelques centimes sur B2 pour quelques Go.
- Assistant : facturé à l'atelier par Anthropic à l'usage, plafonné.
- Hors ligne : une page ouverte continue sans réseau et garde tout. Une fois l'éditeur ouvert une fois sur un appareil, il se rouvre aussi sans réseau (service worker) ; seuls les textures déjà vues sont disponibles, et la connexion d'un nouvel utilisateur demande le réseau.
- Les tests réels sur Android et sur le VPS restent à faire ; les tests ici tournent dans Chromium avec un GPU logiciel.
- Les listes de débit restent des brouillons à vérifier par un menuisier, comme dans l'éditeur.
