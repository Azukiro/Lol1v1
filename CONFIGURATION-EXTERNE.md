# LoL 1v1 – Configuration externe (hors code)

Ce fichier liste tout ce que **tu dois faire toi-même** dans des services et outils externes : comptes, consoles web, secrets, réglages du poste et du jeu. Le code ne peut pas le faire à ta place.

Infos vérifiées le 7 octobre 2026. Les offres gratuites changent souvent : revérifie les liens avant chaque étape.

**Légende « Quand »**
- 🟢 **LOCAL** : nécessaire pour développer seul sur ton PC.
- 🟡 **À DEUX** : nécessaire pour la première série jouée avec un ami (API sur Render, base sur Neon, installeur publié).
- 🔴 **PUBLIC** : nécessaire avant toute diffusion au-delà du cercle d'amis.
- ⚪ **PLUS TARD** : validation post-match, Riot Sign-On, etc.

---

## Vue d'ensemble : ordre conseillé

| # | Étape | Quand | Durée estimée |
|---|---|---|---|
| 1 | [Poste local : outils + réglages LoL](#1-poste-local) | 🟢 | 30–60 min |
| 2 | [Riot : compte développeur + lecture des Developer Policies (POC P0)](#2-riot-developer-portal--compte-et-politique-poc-p0) | 🟢 (avant de figer le périmètre) | 1 h |
| 3 | [Secrets de développement (clé JWT de dev)](#3-secrets-à-générer) | 🟢 | 5 min |
| 4 | [GitHub : dépôt](#4-github--dépôt) | 🟡 (conseillé dès le début) | 10 min |
| 5 | [Neon : base PostgreSQL](#5-neon--base-postgresql) | 🟡 | 10 min |
| 6 | [Render : API (Blueprint ou Web Service Docker)](#6-render--api) | 🟡 | 20 min |
| 7 | [Client : `API_URL` de production](#7-client--url-de-lapi) | 🟡 | 5 min |
| 8 | [GitHub : token, secrets et Releases (installeur)](#8-github--token-secrets-et-releases) | 🟡 | 15 min |
| 9 | [Optionnel : tunnel Cloudflare / ngrok](#9-optionnel--tunnel-cloudflare-tunnel-ou-ngrok) | 🟡 (alternative à 5–6) | 10 min |
| 10 | [Riot : enregistrement du produit, clé personnelle, RSO](#10-riot--enregistrement-du-produit-clés-api-rso) | ⚪ / 🔴 | variable (revue Riot) |
| 11 | [Signature de code Windows](#11-signature-de-code-windows) | 🔴 | jours à semaines |
| 12 | [RGPD](#12-rgpd--données-personnelles) | 🔴 | 1–2 h |
| — | [Récapitulatif des variables et secrets](#récapitulatif-des-variables-et-secrets) | | |
| — | [Divergences avec les specs](#divergences-relevées-avec-les-specs-octobre-2026) | | |

---

## 1. Poste local

🟢 **LOCAL**. À faire sur chaque PC de développement. Pour un simple joueur (ton ami), seuls LoL, le mode fenêtré sans bordure et éventuellement `LOL_PATH` sont nécessaires.

### 1.1 Outils à installer

| Outil | Où | Vérification |
|---|---|---|
| Git | https://git-scm.com/download/win | `git --version` |
| .NET 8 SDK | https://dotnet.microsoft.com/download/dotnet/8.0 (SDK x64, pas seulement le runtime) | `dotnet --list-sdks` affiche une ligne `8.0.x` |
| Outil EF Core (migrations) | `dotnet tool install --global dotnet-ef --version 8.*` | `dotnet ef --version` |
| Node.js LTS | https://nodejs.org (version LTS, x64) | `node -v` et `npm -v` |
| Docker Desktop | https://www.docker.com/products/docker-desktop/ | `docker compose version` |
| League of Legends | https://www.leagueoflegends.com (client Riot) | le client se lance et tu es connecté |

Docker Desktop sous Windows :
1. Active la virtualisation dans le BIOS si Docker le demande.
2. Accepte l'installation de **WSL 2** (backend recommandé). Si besoin : `wsl --install` dans un PowerShell administrateur, puis redémarre.
3. Lance Docker Desktop **avant** `docker compose up -d` à la racine du projet. La base locale écoute sur `localhost:5432` (utilisateur `lol1v1`, mot de passe `dev`, base `lol1v1`). Ce sont des valeurs de dev uniquement.

> Docker Desktop est gratuit pour un usage personnel ou une petite structure. Au moment de l'installation, accepte ou refuse toi-même ses conditions.

### 1.2 Réglage du jeu : mode « fenêtré sans bordure » (overlay)

L'overlay « Quittez la partie » est une fenêtre Electron séparée, au premier plan. Elle **n'apparaît pas par-dessus un jeu en plein écran exclusif**.

1. Lance une partie (personnalisée contre un bot, par exemple).
2. `Échap` → **Vidéo** → **Mode fenêtre** (ou « Mode d'affichage ») → **Sans bordure**.
3. Valide. Le réglage est conservé pour les parties suivantes (il est stocké dans `Config\game.cfg` du dossier LoL).

À faire **par chaque joueur**, ton ami compris. Sinon, le client utilise la notification Windows de secours.

### 1.3 Chemin d'installation de LoL → variable `LOL_PATH`

Le client lit le `lockfile` (port et mot de passe de la LCU) dans le dossier d'installation de LoL. Par défaut : `C:\Riot Games\League of Legends\lockfile`.

**Si LoL est installé ailleurs** (autre disque, autre dossier) :
1. Trouve le dossier. Quand le client LoL est lancé, cette commande l'affiche :
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" |
     Select-Object -ExpandProperty CommandLine
   # Cherche l'argument --install-directory=...
   ```
   Tu peux aussi faire un clic droit sur le raccourci LoL → « Ouvrir l'emplacement du fichier ».
2. Vérifie qu'un fichier `lockfile` existe dans ce dossier **pendant** que le client tourne (il disparaît à sa fermeture).
3. Définis la variable d'environnement utilisateur `LOL_PATH`, avec le **dossier** et non le fichier :
   ```powershell
   setx LOL_PATH "D:\Games\Riot Games\League of Legends"
   ```
4. Ferme puis rouvre le terminal ou l'app pour qu'elle soit prise en compte.

À communiquer à ton ami s'il a installé LoL ailleurs.

### 1.4 Certificat auto-signé LCU / Live Client

Aucune action système à faire. N'installe **pas** le certificat Riot dans le magasin Windows et ne désactive pas la vérification TLS globalement. Le code accepte le certificat uniquement pour `127.0.0.1`. Riot publie aussi un certificat racine, `riotgames.pem`, utilisable pour valider proprement la connexion (voir https://developer.riotgames.com/docs/lol).

### 1.5 Secrets locaux de l'API

Voir [§3](#3-secrets-à-générer). En local, la chaîne de connexion est `Host=localhost;Database=lol1v1;Username=lol1v1;Password=dev` (déjà dans `appsettings.Development.json`). L'API répond sur `http://localhost:5080`, valeur par défaut de `API_URL` côté client.

---

## 2. Riot Developer Portal : compte et politique (POC P0)

🟢 **À faire tôt**. C'est le POC **P0** : il conditionne le périmètre fonctionnel (lobby auto, overlay, conditions de victoire).

**Où** : https://developer.riotgames.com

### 2.1 Compte
1. Clique sur **Login** et connecte-toi avec ton **compte Riot** existant (le même que pour LoL). Aucun compte supplémentaire n'est nécessaire.
2. Une **clé de développement** est générée automatiquement sur le tableau de bord. Elle **expire toutes les 24 h**. Tu n'en as **pas besoin pour la V1**, qui n'utilise que la LCU et la Live Client Data. Ne la copie nulle part pour l'instant.

### 2.2 Lire les politiques (P0)
Lis et note tes conclusions (dans `08-risques-et-poc.md` ou une issue GitHub) :
- **General Policies** : https://developer.riotgames.com/policies/general
- **Docs League of Legends** (sections *League Client API* et *Game Client API*) : https://developer.riotgames.com/docs/lol
- **Conditions d'utilisation de l'API** : https://developer.riotgames.com/terms

Points à vérifier explicitement pour LoL 1v1 :

| Point | Ce que disent les docs (oct. 2026) | Impact |
|---|---|---|
| LCU | « Not officially supported for use with third party applications ». Riot demande d'**être informé** : créer une application ou laisser une note sur l'application existante dans le portail, en indiquant **quels endpoints** sont utilisés et **comment**. | Obligation de déclarer les endpoints LCU utilisés (lobby, invitations, champ select, inventaire). |
| But du jeu | « Products cannot alter the goal of the game (i.e. Destroy the Nexus) » | ⚠️ **Point le plus sensible** : nos conditions de victoire (first blood, première tour, N CS) **redéfinissent le but** de la partie personnalisée. À présenter clairement à Riot (règles d'un défi amical en partie perso, hors classé) et à faire confirmer. |
| Avantage injuste | Pas d'avantage injuste, pas de suppression de décisions du joueur. Pas d'information de session inconnue du joueur. | L'overlay ne doit afficher que le résultat de manche, aucune information cachée (par exemple, aucun élément sur l'adversaire non visible dans le jeu). |
| Paris | « Your product cannot feature betting or gambling functionality » | Conforme (pas de mise), à garder ainsi. |
| Monétisation | Uniquement si le produit est « Approved » ou « Acknowledged », avec une offre gratuite. | Hors V1. |

**Livrable P0** : une décision « go » ou « réduire le périmètre » (sans lobby auto, sans overlay, conditions limitées), à reporter dans les specs.

---

## 3. Secrets à générer

Ne mets **jamais** ces valeurs dans Git, dans le client Electron ni dans une capture d'écran. Garde-les dans un gestionnaire de mots de passe.

### 3.1 Clé JWT (`Jwt__Key`)
Il faut une valeur aléatoire d'au moins 32 caractères (48 octets en Base64, soit 64 caractères, conseillé). Génère **une clé différente** pour le dev et pour la production.

PowerShell (Windows PowerShell 5.1 et PowerShell 7) :
```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```
Alternative (Git Bash) : `openssl rand -base64 48`

Où la reporter :
- **Dev** : dans les user-secrets du projet API, pour éviter de la committer. Depuis le dossier du `.csproj` de l'API dans `server/` :
  ```powershell
  dotnet user-secrets init      # si pas déjà fait par le code
  dotnet user-secrets set "Jwt:Key" "<clé-de-dev>"
  ```
  Si l'implémentation fournit déjà une clé de dev dans `appsettings.Development.json`, cette étape est facultative en local.
- **Production** : variable d'environnement Render `Jwt__Key` (voir [§6](#6-render--api)).

Changer la clé de production invalide tous les jetons en cours : les joueurs devront se reconnecter.

### 3.2 Mot de passe Neon
Il est généré par Neon, rien à créer (voir [§5](#5-neon--base-postgresql)).

### 3.3 Token GitHub `GH_TOKEN`
Voir [§8](#8-github--token-secrets-et-releases).

---

## 4. GitHub : dépôt

🟡 **À DEUX** (conseillé dès le début). **Où** : https://github.com/new

1. Crée le dépôt `lol1v1` (le nom doit correspondre au champ `repo` de `client/electron-builder.yml`).
2. **Visibilité** : choisis **public**, de préférence.
   - La mise à jour automatique (`electron-updater`) lit les GitHub Releases **sans authentification** uniquement si le dépôt est public. Avec un dépôt privé, il faudrait embarquer un token dans le client, ce qui est à proscrire.
   - Si tu veux un code privé : crée un **second dépôt public**, par exemple `lol1v1-releases`, qui ne contient que les Releases, et mets ce nom dans `repo` de `electron-builder.yml`.
   - Render sait déployer depuis un dépôt privé (via son app GitHub). Le choix de visibilité n'a donc d'impact que sur les Releases.
3. Pousse le code avec la branche par défaut `main` (Render déploie automatiquement depuis `main`).
4. Vérifie que `.gitignore` exclut `appsettings.*.local.json`, `.env`, `node_modules`, `bin/`, `obj/` et `dist/`. Le code s'en charge normalement, mais vérifie avant le premier push.
5. Conseillé : **Settings → Code security** → active **Secret scanning** et **Push protection** (gratuit sur les dépôts publics).

---

## 5. Neon : base PostgreSQL

🟡 **À DEUX**. **Où** : https://console.neon.tech (inscription sur https://neon.com)

Offre gratuite (vérifiée en oct. 2026) : 100 CU-heures par projet et par mois, 1 Go de stockage par projet, 5 Go de transfert réseau par projet et par mois. Le calcul est suspendu après 5 min d'inactivité (non désactivable). **Pas de carte bancaire.**

1. Crée un compte (GitHub, Google ou e-mail).
2. **New Project** :
   - Nom : `lol1v1`
   - Version Postgres : 16 (cohérente avec `postgres:16` du docker-compose ; 17 fonctionne aussi)
   - **Région : AWS Europe Central 1 (Frankfurt)**, `aws-eu-central-1`, pour être au plus près de Render Frankfurt. N'utilise pas une région Azure : elles sont dépréciées chez Neon.
   - Nom de la base : `lol1v1` (ou garde `neondb`, en l'adaptant dans la chaîne).
3. Ouvre **Dashboard → Connect** et :
   - Choisis la branche `main`, la base `lol1v1` et le rôle propriétaire (par exemple `neondb_owner`).
   - **Désactive « Connection pooling »** pour récupérer l'hôte **direct** (sans `-pooler` dans le nom). Les migrations EF Core appliquées au démarrage (`Database.Migrate()`) sont plus fiables sur une connexion directe, et le trafic V1 est faible.
   - Neon affiche une URL du type :
     `postgresql://neondb_owner:MOTDEPASSE@ep-xxxx-yyyy.eu-central-1.aws.neon.tech/lol1v1?sslmode=require&channel_binding=require`
4. **Convertis-la au format Npgsql**. L'URL `postgresql://…` n'est **pas** acceptée telle quelle par `ConnectionStrings__Default` :
   ```
   Host=ep-xxxx-yyyy.eu-central-1.aws.neon.tech;Database=lol1v1;Username=neondb_owner;Password=MOTDEPASSE;SSL Mode=Require;Trust Server Certificate=true
   ```
   Correspondance : partie après `@` et avant `/` → `Host`, chemin → `Database`, avant `:` → `Username`, entre `:` et `@` → `Password`. Ignore `sslmode`/`channel_binding` de l'URL : ils sont remplacés par `SSL Mode=Require`.
   Si le mot de passe contient des caractères encodés dans l'URL (`%40`, etc.), décode-les.
5. **Où la reporter** : variable d'environnement Render `ConnectionStrings__Default` (voir [§6](#6-render--api)). Ne la mets nulle part ailleurs.
6. Optionnel, pour tester depuis ton PC avant Render : lance l'API localement avec `$env:ConnectionStrings__Default="<chaîne Npgsql>"`, puis `dotnet run`. Les tables sont créées au démarrage.

Si le mot de passe fuit : **Roles → Reset password** dans Neon, puis mets à jour la variable Render.

---

## 6. Render : API

🟡 **À DEUX**. **Où** : https://dashboard.render.com (inscription sur https://render.com)

Offre gratuite (vérifiée en oct. 2026) : web service gratuit, 512 Mo de RAM, 750 h d'instance par mois et par workspace. Mise en veille après **15 min** sans trafic entrant, environ **1 min** de réveil. **Pas de carte bancaire** pour le service gratuit. Bande passante sortante incluse dans le plan Hobby : **5 Go par mois par workspace** (au-delà : 0,15 $/Go facturé, ou **suspension** sans moyen de paiement). WebSockets supportés.

1. Crée un compte Render en te connectant **avec GitHub** (plus simple pour lier le dépôt).
2. Autorise l'app GitHub de Render **uniquement sur le dépôt `lol1v1`** (« Only select repositories »).

### Option A (recommandée) : Blueprint (`render.yaml` à la racine)
1. **New → Blueprint** → sélectionne le dépôt `lol1v1`, branche `main`.
2. Render lit `render.yaml` (service web Docker, région `frankfurt`, plan `free`, `healthCheckPath: /health`, Dockerfile `server/Dockerfile`, contexte `server/`).
3. Render demande la valeur des variables marquées `sync: false`. Renseigne-les :

   | Variable | Valeur |
   |---|---|
   | `ConnectionStrings__Default` | chaîne **Npgsql** de [§5](#5-neon--base-postgresql) |
   | `Jwt__Key` | clé de **production** générée au [§3.1](#31-clé-jwt-jwt__key) |

   `Jwt__Issuer` (`lol1v1`), `Jwt__Audience` (`lol1v1-client`) et `ASPNETCORE_ENVIRONMENT=Production` sont normalement déjà dans le Blueprint. Sinon, ajoute-les à la main.
4. **Apply**. Le premier build Docker prend quelques minutes.

### Option B : Web Service Docker créé à la main
1. **New → Web Service** → dépôt `lol1v1`.
2. Réglages :
   - **Name** : `lol1v1-api`. L'URL publique sera `https://lol1v1-api.onrender.com`, ou avec un suffixe si le nom est pris : note l'URL exacte.
   - **Region** : **Frankfurt (EU Central)**. La région ne peut plus être changée après création.
   - **Branch** : `main`
   - **Language/Runtime** : **Docker**
   - **Dockerfile Path** : `server/Dockerfile` (selon l'interface : `./server/Dockerfile`)
   - **Docker Build Context Directory** : `server`
   - **Instance Type** : **Free**
3. **Advanced** :
   - **Health Check Path** : `/health`
   - **Auto-Deploy** : **On Commit** (déploiement à chaque push sur `main`)
   - **Environment Variables** :

     | Clé | Valeur |
     |---|---|
     | `ConnectionStrings__Default` | chaîne Npgsql Neon |
     | `Jwt__Key` | clé de production (≥ 32 caractères) |
     | `Jwt__Issuer` | `lol1v1` |
     | `Jwt__Audience` | `lol1v1-client` |
     | `ASPNETCORE_ENVIRONMENT` | `Production` |

   - **Ne définis pas `PORT`** : Render le fournit et l'API l'utilise.
   - **Ne définis pas `Riot__ApiKey`** maintenant (voir [§10](#10-riot--enregistrement-du-produit-clés-api-rso)).
4. **Create Web Service**.

### Vérification
1. Dans **Logs**, attends le message de démarrage de l'API et vérifie l'absence d'erreur de connexion Npgsql ou de migration.
2. Ouvre `https://<nom-du-service>.onrender.com/health` : la réponse doit être un 200.
3. Note l'URL exacte : elle devient `API_URL` ([§7](#7-client--url-de-lapi)).
4. Surveille la bande passante dans **Workspace → Billing / Usage** : 5 Go par mois sont largement suffisants pour SignalR entre amis. **Ne publie pas l'installeur sur Render** : il passe par GitHub Releases.

Optionnel : **Workspace Settings → Notifications** pour recevoir un e-mail en cas d'échec de déploiement.

---

## 7. Client : URL de l'API

🟡 **À DEUX**.

L'URL de l'API est injectée **au build** du client via `API_URL` (défaut : `http://localhost:5080`).

- **Build local de l'installeur** (PowerShell, dans `client/`) :
  ```powershell
  $env:API_URL = "https://<nom-du-service>.onrender.com"
  npm run <script de build/dist défini dans client/package.json>
  ```
- **Build par GitHub Actions** : crée une **variable** (pas un secret, car l'URL n'est pas confidentielle) dans **Settings → Secrets and variables → Actions → Variables → New repository variable** : nom `API_URL`, valeur `https://<nom-du-service>.onrender.com`. Vérifie dans `.github/workflows/*.yml` sous quel nom le workflow la lit (`vars.API_URL` ou `secrets.API_URL`) et crée-la au bon endroit.

Pas de slash final. Utilise toujours `https://`.

---

## 8. GitHub : token, secrets et Releases

🟡 **À DEUX** (pour que ton ami installe l'app et reçoive les mises à jour).

### 8.1 `owner` / `repo` dans `client/electron-builder.yml`
C'est une modification dans le dépôt, mais avec une valeur qui dépend de ton compte GitHub. Remplace :
- `OWNER_A_REMPLACER` → ton nom d'utilisateur GitHub (ou organisation) ;
- `lol1v1` → le nom réel du dépôt qui portera les Releases (voir [§4](#4-github--dépôt), cas du dépôt `lol1v1-releases`).

### 8.2 Créer le token `GH_TOKEN`
**Où** : https://github.com/settings/personal-access-tokens/new (fine-grained token)
1. **Token name** : `lol1v1-electron-builder`
2. **Expiration** : 90 jours (note la date de renouvellement), ou une durée plus longue si tu acceptes le risque.
3. **Repository access** : **Only select repositories** → le dépôt qui porte les Releases.
4. **Permissions → Repository permissions → Contents : Read and write**. Metadata : Read est ajouté automatiquement. Rien d'autre.
5. **Generate token** et copie la valeur, affichée **une seule fois**.

### 8.3 Où le reporter
- **GitHub Actions** : **Settings → Secrets and variables → Actions → Secrets → New repository secret** avec le nom `GH_TOKEN` et la valeur du token. Il s'agit des secrets du dépôt **qui exécute le workflow**.
- **Publication depuis ton PC** (si tu publies à la main) : `$env:GH_TOKEN = "<token>"` dans la session PowerShell, **jamais** dans un fichier committé.
- Alternative sans PAT, si le workflow et les Releases sont dans le **même** dépôt : le workflow peut utiliser `secrets.GITHUB_TOKEN` avec `permissions: contents: write`. Dans ce cas, vérifie **Settings → Actions → General → Workflow permissions**. Ne l'applique que si le workflow est écrit ainsi.

### 8.4 Releases
1. Chaque push sur `dev` touchant `client/` publie automatiquement une Release `v0.1.<n°>` (pas de brouillon, rien à cliquer). `electron-updater` la détecte dans les apps installées (au démarrage puis toutes les 30 min).
2. Vérifie que la Release contient l'installeur `.exe`, `latest.yml` (indispensable à la mise à jour automatique) et le `.blockmap`.
3. Envoie à ton ami le lien de la page Releases. Au premier lancement, Windows SmartScreen affichera « Windows a protégé votre ordinateur » (binaire non signé, voir [§11](#11-signature-de-code-windows)) : **Informations complémentaires → Exécuter quand même**.
4. À chaque nouvelle version, augmente `version` dans `client/package.json`. Sinon, la mise à jour n'est pas proposée.

---

## 9. Optionnel : tunnel (Cloudflare Tunnel ou ngrok)

🟡 Alternative à Render et Neon pour un **tout premier test à deux** avec l'API et la base sur ton PC. Ton PC doit rester allumé, et l'URL change à chaque lancement en mode rapide. Il faut donc reconstruire le client de ton ami avec la nouvelle `API_URL`.

**Cloudflare Tunnel (sans compte, mode « quick tunnel »)**
1. Installe `cloudflared` : `winget install --id Cloudflare.cloudflared`
2. Lance l'API locale, puis : `cloudflared tunnel --url http://localhost:5080`
3. Récupère l'URL `https://xxxx.trycloudflare.com` affichée et utilise-la comme `API_URL`. WebSockets/SignalR passent.
4. Pour une URL fixe : compte Cloudflare (https://dash.cloudflare.com) + domaine + tunnel nommé (Zero Trust → Networks → Tunnels).

**ngrok**
1. Compte sur https://dashboard.ngrok.com/signup (gratuit), puis `winget install --id Ngrok.Ngrok`.
2. `ngrok config add-authtoken <token affiché dans le dashboard>` : ce token reste sur ton PC, ne le committe pas.
3. `ngrok http 5080` → l'URL `https://….ngrok-free.app` sert d'`API_URL`. L'offre gratuite fournit un domaine statique gratuit ; une page d'avertissement s'affiche pour les navigateurs, sans impact pour les appels API.

N'expose jamais ta base PostgreSQL locale (port 5432) par un tunnel, seulement l'API.

---

## 10. Riot : enregistrement du produit, clés API, RSO

### 10.1 Enregistrer le produit
⚪/🔴 **Recommandé dès que le périmètre est figé (après P0)** et **obligatoire avant toute diffusion au-delà des amis**. C'est aussi le moyen de **déclarer l'usage de la LCU**, comme Riot le demande.

**Où** : https://developer.riotgames.com → **Register Product** (ou « Apps » / « My Apps » selon l'interface).
1. Choisis **Personal API Key** (petite communauté privée, sans vérification Riot) pour la phase entre amis. Choisis **Production API Key** seulement pour une diffusion publique.
2. Remplis le formulaire :
   - nom provisoire et description : défi 1v1 entre amis en partie personnalisée, aucun pari, aucune lecture mémoire ni injection ;
   - **endpoints LCU utilisés** et leur usage (identité, inventaire de champions, création de lobby + invitation, champ select, gameflow) ;
   - Live Client Data API (événements de partie) ;
   - overlay externe qui affiche uniquement « manche terminée, quittez la partie » ;
   - point « conditions de victoire alternatives » : à formuler honnêtement (voir [§2.2](#22-lire-les-politiques-p0)).
3. Note le statut (*Pending / Acknowledged / Approved / Rejected*) et les retours de Riot dans les specs.

### 10.2 Clé API (validation post-match, Match-V5)
⚪ **PLUS TARD**, pas en V1.
- **Clé de développement** : celle du tableau de bord, régénérable, expire toutes les 24 h. Suffit pour un prototype local.
- **Clé personnelle** : obtenue après l'enregistrement en Personal. Limites : 20 requêtes/s et 100 requêtes/2 min par région. Elle **n'expire pas** toutes les 24 h.
- **Clé de production** : pour un usage public, prototype fonctionnel et approbation Riot exigés. Limites de départ : 500 requêtes/10 s et 30 000/10 min par région.
- **Où la reporter** : **uniquement** la variable Render `Riot__ApiKey` (Dashboard → service → Environment), **jamais** dans le client Electron ni dans Git. Render redéploie après modification.

### 10.3 Riot Sign-On (RSO)
⚪/🔴 Avant une diffusion publique, pour prouver la propriété du compte Riot. RSO exige un **produit approuvé en production**. La demande se fait via le portail après l'approbation production : Riot fournit alors un `client_id` et un `client_secret` OAuth, à stocker côté serveur uniquement (variables Render). Les noms de variables seront définis par l'implémentation au moment voulu.

### 10.4 Data Dragon
Aucune configuration : CDN public, sans clé.

---

## 11. Signature de code Windows

🔴 **PUBLIC** (non indispensable entre amis). Sans signature, SmartScreen avertit à chaque nouvelle version, et certains antivirus peuvent bloquer l'installeur.

Options en 2026, à comparer au moment voulu :
1. **Azure Trusted Signing / Artifact Signing** (Microsoft) : environ 10 $/mois, aucun matériel nécessaire, supporté nativement par electron-builder (`azureSignOptions`). **Vérifie l'éligibilité des particuliers en France**, longtemps limitée à certains pays et aux entreprises ayant 3 ans d'historique. Portail : https://portal.azure.com. Secrets GitHub à créer dans ce cas : `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus endpoint, compte et profil de certificat dans `electron-builder.yml`.
2. **Certificat OV classique** (Certum, Sectigo, SSL.com…) : environ 100–400 €/an. Depuis 2023, la clé privée doit être sur un **token matériel ou HSM cloud**, donc un fichier `.pfx` simple n'est plus délivré. La signature en CI passe alors par le service cloud du fournisseur (par exemple SSL.com eSigner, Certum SimplySign), avec ses identifiants en secrets GitHub.
3. **SignPath Foundation** : gratuit pour les projets **open source** éligibles (https://signpath.org).

Un certificat EV ne supprime plus instantanément l'alerte SmartScreen : la réputation se construit avec le volume de téléchargements dans tous les cas.

Étapes communes : choisir le fournisseur → valider l'identité (pièce d'identité, voire entreprise : **à faire toi-même**) → configurer electron-builder → secrets GitHub → signer → tester sur un Windows propre.

---

## 12. RGPD et données personnelles

🔴 **PUBLIC** (avant toute ouverture au-delà des amis). Ce n'est pas un service à configurer, mais une démarche à faire toi-même.

Données traitées : e-mail, hash du mot de passe, Riot ID, PUUID, historique des séries (voir `07-securite-anti-triche.md`).

1. **Politique de confidentialité** : rédige-la et publie-la (page GitHub Pages ou README du dépôt de releases), avec un lien visible dans l'app. Contenu : responsable du traitement (toi), données, finalités, base légale (exécution du service), durée de conservation, sous-traitants, droits (accès, rectification, suppression, portabilité), contact, droit de réclamation auprès de la CNIL. Riot demande en général une politique de confidentialité pour un produit public.
2. **Sous-traitants et localisation** : Render (Frankfurt) et Neon (AWS Frankfurt), données hébergées dans l'UE, mais sociétés américaines. Consulte et conserve leurs **DPA** : https://render.com/dpa (ou page « Legal » de Render) et https://neon.com/dpa (ou page « Legal » de Neon). GitHub héberge les binaires, pas de données personnelles.
3. **Registre des traitements** : un tableau simple suffit pour une petite structure. Modèle CNIL : https://www.cnil.fr/fr/RGDP-le-registre-des-activites-de-traitement
4. **Suppression de compte** : fonctionnalité à implémenter (dette listée dans les specs). Prévoir aussi la purge des données associées.
5. **Mineurs** : beaucoup de joueurs de LoL sont mineurs. En France, le consentement seul n'est valable qu'à partir de 15 ans. Vu la base légale « contrat », reste prudent et mentionne-le dans les CGU.
6. **Sécurité** : secrets uniquement en variables Render et secrets GitHub, rotation en cas de fuite ([§3](#3-secrets-à-générer), [§5](#5-neon--base-postgresql), [§8](#8-github--token-secrets-et-releases)).

---

## Récapitulatif des variables et secrets

| Nom | Valeur / format | Où la saisir | Produite par | Quand |
|---|---|---|---|---|
| `ConnectionStrings__Default` | `Host=ep-….eu-central-1.aws.neon.tech;Database=lol1v1;Username=…;Password=…;SSL Mode=Require;Trust Server Certificate=true` | Render → Environment | Neon (§5), convertie au format Npgsql | 🟡 |
| `Jwt__Key` | ≥ 32 caractères aléatoires (Base64 de 48 octets) | Render → Environment (prod) ; `dotnet user-secrets` (dev) | Toi, via PowerShell (§3.1) | 🟢 dev / 🟡 prod |
| `Jwt__Issuer` | `lol1v1` | Render (ou valeur par défaut) | fixe | 🟡 |
| `Jwt__Audience` | `lol1v1-client` | Render (ou valeur par défaut) | fixe | 🟡 |
| `ASPNETCORE_ENVIRONMENT` | `Production` | Render | fixe | 🟡 |
| `PORT` | fourni par Render | **ne pas définir** | Render | — |
| `Riot__ApiKey` | `RGAPI-…` | Render uniquement | Portail Riot (§10.2) | ⚪ |
| `API_URL` | `https://<service>.onrender.com` (défaut `http://localhost:5080`) | env au build du client ; variable GitHub Actions `API_URL` | Render (§6) | 🟡 |
| `GH_TOKEN` | fine-grained PAT, Contents R/W | Secret GitHub Actions ; env local lors d'une publication manuelle | GitHub (§8.2) | 🟡 |
| `owner` / `repo` | ton login GitHub / `lol1v1` | `client/electron-builder.yml` | toi | 🟡 |
| `LOL_PATH` | dossier d'installation de LoL (si différent de `C:\Riot Games\League of Legends`) | variable d'environnement utilisateur Windows (`setx`) | toi (§1.3) | 🟢 |
| Secrets de signature (`AZURE_*` ou ceux du fournisseur) | selon le fournisseur | Secrets GitHub Actions | fournisseur de certificat (§11) | 🔴 |

---

## Divergences relevées avec les specs (octobre 2026)

1. **Riot – « alter the goal of the game »** (⚠️ important pour P0) : les General Policies indiquent que les produits ne peuvent pas modifier le but du jeu (« Destroy the Nexus »). Les specs ne mentionnent pas ce point, alors que le cœur de LoL 1v1 (victoire au first blood, à la première tour, aux CS) le touche directement. C'est à poser explicitement à Riot lors de l'enregistrement. Plan B possible : présenter l'app comme un outil d'organisation et de suivi de défis entre amis, sans rien imposer au jeu.
2. **Riot – déclaration LCU** : la doc Riot demande de déclarer **quels endpoints LCU** sont utilisés et comment (création d'application ou note sur le portail). Les specs parlent seulement d'enregistrer le produit « avant diffusion ». Il vaut mieux le faire dès la fin du POC.
3. **Riot – RSO** : RSO exige explicitement une **clé et un produit en production**, pas seulement « un produit approuvé ». C'est cohérent sur le fond, mais en pratique l'accès à RSO passe par l'approbation production.
4. **Render – bande passante** : les specs disent « 5 Go/mois, réduite en avril 2026 ». Précision : les nouveaux plans de workspace datent du **23 avril 2026**, et les workspaces existants ont été migrés le **1er août 2026** (Hobby : 100 Go → 5 Go, puis 0,15 $/Go). Les 5 Go sont **partagés par tout le workspace**. Sans carte bancaire, un dépassement entraîne la **suspension** des services. Le reste est inchangé (512 Mo, 750 h, veille 15 min, environ 1 min de réveil, pas de carte).
5. **Neon – transfert réseau** : non mentionné dans les specs. L'offre gratuite inclut **5 Go de transfert sortant par projet et par mois**, sans impact attendu pour la V1. Les autres chiffres (100 CU-h, 1 Go, veille après 5 min, pas de carte) sont conformes. Les régions **Azure** sont dépréciées : choisis bien **AWS Frankfurt**.
6. **Neon – chaîne de connexion** : la console fournit une URL `postgresql://…?sslmode=require&channel_binding=require`. La spec parle de « récupérer la chaîne avec `SSL Mode=Require` ». Il faut la **convertir** au format Npgsql (§5) et privilégier l'hôte **direct** (non `-pooler`) à cause des migrations au démarrage.
7. **Dockerfile** : l'exemple du dossier technique (`COPY . .` + `Api/Api.csproj`) suppose un contexte à la racine de l'API. L'implémentation retenue utilise `server/Dockerfile` avec le contexte `server/`. Dans Render, mets donc *Dockerfile Path* `server/Dockerfile` et *Build Context* `server` (déjà dans `render.yaml` en mode Blueprint).
8. **Mise à jour automatique** : les specs ne précisent pas la visibilité du dépôt. Sans token embarqué, `electron-updater` exige que les Releases soient sur un dépôt **public** (§4).
