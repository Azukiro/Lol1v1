# Duelyst

Client Windows qui organise des séries de 1v1 (ou 2v2) sur League of Legends entre amis : configuration de la série, attribution des champions, suivi de la partie via les API locales du client LoL, détection des conditions de victoire et enregistrement des résultats. Specs : dossier `Documents/` (local, non versionné). Configuration des services externes : [CONFIGURATION-EXTERNE.md](CONFIGURATION-EXTERNE.md).

## Structure

| Dossier | Contenu |
|---|---|
| `server/Api` | Backend ASP.NET Core 8 : REST `/api/v1`, hub SignalR `/hubs/series`, EF Core + PostgreSQL. Seul arbitre. |
| `server/Api.Tests` | Tests xUnit : règles, tirages, arbitrage, et séries complètes jouées via SignalR (base en mémoire). |
| `client/electron` | Processus principal Electron : `lcu-connector`, `live-client-poller`, overlay. |
| `client/src/shared` | Logique partagée testée : `rules-engine` (évaluation locale), `live-events` (Live Client Data → observations). |
| `client/src/app` | Interface Angular 21 : accueil, nouveau défi, deck, bans, pick aveugle, sélection, suivi live, récapitulatif, historique. |

## Démarrage local

Prérequis : .NET 8 SDK, Node.js 22 LTS, Docker Desktop, League of Legends.

```bash
docker compose up -d
```

```bash
cd server/Api && dotnet run
```

L'API écoute sur `http://localhost:5080` et applique les migrations au démarrage. Sans Docker, un mode démo garde tout en mémoire :

```bash
cd server/Api && Database__Provider=InMemory dotnet run
```

Client (fenêtre Electron + serveur Angular) :

```bash
cd client && npm install && npm run dev
```

Si LoL n'est pas installé dans `C:\Riot Games\League of Legends`, définir `LOL_PATH` (le connecteur lit aussi la ligne de commande de `LeagueClientUx.exe` en secours). Le jeu doit être en **fenêtré sans bordure** pour voir l'overlay de fin de manche.

## Tests

```bash
cd server/Api.Tests && dotnet test
```

```bash
cd client && npm test
```

## Déploiement

- API : `render.yaml` (Blueprint Render, Docker, `server/Dockerfile`), base Neon via `ConnectionStrings__Default`.
- Page vitrine « Duelyst » : `server/Api/wwwroot/index.html`, servie à la racine de l'API. `/download` redirige vers l'installeur embarqué (`/updates/launcher-setup-<version>.exe`), `/download/latest` donne version et taille (dossier surchargeable par `Launcher:UpdatesPath`).
- Client : chaque push sur `dev` qui touche `client/` lance `.github/workflows/release-client.yml`, qui construit la version `0.1.<n°>`, la pousse dans l'image `ghcr.io/azukiro/duelyst-launcher` puis redéploie l'API (secret `RENDER_DEPLOY_HOOK`). Le Dockerfile du serveur copie cette image dans `/app/updates` : les apps installées y trouvent la mise à jour, la téléchargent en arrière-plan et l'installent à la fermeture (bandeau « Redémarrer maintenant » dans l'app). GitHub Releases est encore publié pour la transition des anciennes installations. Le paquet ghcr doit être public (Render le tire sans identifiants) ; il doit exister avant tout `docker build` du serveur. Build local : `API_URL=https://<service>.onrender.com npm run dist` (installeur dans `client/release/`).

## Choix d'implémentation à connaître

- **Observations, pas de résultat** : chaque client remonte des événements bruts relatifs à lui (`SELF` / `OPPONENT`) ; le serveur les convertit en joueur absolu, les croise par `EventID`, valide « source unique » après 10 s, passe en litige si les attributions se contredisent, et départage par `EventTime`.
- **CS** : auto-déclaré à chaque seuil, corroboré si la vue de l'adversaire est à 10 près.
- **Observations ignorées hors partie** : il faut `ReportGameStarted` (envoyé au passage du gameflow LCU en `InProgress`) pour que la manche passe `IN_GAME`.
- **Hypothèses des questions ouvertes appliquées** : pas de relance ni de répétition (Q1, Q2), plafond ⌈BO/2⌉+1 jetons par sort borné à BO (Q3), rotation gratuite comptée (Q4), litige tranché par vote des deux joueurs sinon manche annulée (Q5), annulation d'un commun accord (Q6).
- **Sorts proposés** : ceux que Data Dragon marque `ARAM`, liste de secours dans `ReferenceDataService` (POC P9), surchargeable par `Game:AllowedSpellIds`.
- **Endpoints LCU** (non officiels, POC P1–P4) isolés dans `client/electron/lcu-connector.ts`.
- **Lancement sans clic** (`GameTrackerService`) : dès que les champions sont révélés, le créateur crée le lobby et invite (une fois sorti de la partie précédente), l'invité accepte l'invitation de son adversaire, la sélection démarre quand les deux sont dans le lobby, puis chacun voit ses sorts réglés et son champion imposé survolé et verrouillé. Une fois par tentative de manche (`id:attempt`), réarmé à l'annulation ; les boutons « Relancer le lobby » / « Démarrer la sélection » restent en secours.
- **2v2** (`SeriesConfig.teamSize = 2`) : les slots A / B deviennent des équipes (`SeriesPlayer.Seat` = place dans l'équipe, 0 = capitaine qui porte la victoire). Invitation de groupe (`Invitation.GroupId`) : coéquipier + 2 adversaires, série créée quand les trois ont accepté, un refus annule tout. Modes Miroir (une paire tirée, même place = même champion) et Aléatoire (4 champions différents) uniquement, pas de labo. Conditions comptées par équipe : chaque client remonte SELF = son équipe, CS cumulés (tolérance de corroboration ×2). Score, annulation (accord de l'équipe adverse) et vote de litige (un par équipe, le dernier compte) par équipe. Lobby : le créateur invite d'abord son coéquipier, puis les adversaires une fois l'équipe pleine ; un invité mal placé passe dans l'autre équipe (`/lol-lobby/v1/lobby/custom/switch-teams`) ; sélection lancée quand les 4 sont placés. Exclu des face-à-face des stats.
- **Labo** (`/labo`, `api/v1/lab`, `Domain/Lab`) : modes expérimentaux tenus à l'écart du flux « Nouveau défi ». Premier mode, *objectifs secrets* : chaque joueur reçoit un objectif tiré dans le même palier (court / moyen / long), révélé au chargement et caché à l'adversaire jusqu'à la fin de la manche. Pas de condition « première X ». Au temps limite du palier, la meilleure progression gagne (horloge = la plus basse des deux clients, `CLOCK` toutes les 30 s), égalité = manche rejouée. Durées estimées dans `SecretObjectives.Pool`, à recalibrer sur l'historique.
