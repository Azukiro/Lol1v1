# LoL 1v1

Client Windows qui organise des séries de 1v1 sur League of Legends entre amis : configuration de la série, attribution des champions, suivi de la partie via les API locales du client LoL, détection des conditions de victoire et enregistrement des résultats. Specs : dossier `Documents/` (local, non versionné). Configuration des services externes : [CONFIGURATION-EXTERNE.md](CONFIGURATION-EXTERNE.md).

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
- Client : chaque push sur `dev` qui touche `client/` lance `.github/workflows/release-client.yml`, qui publie la version `0.1.<n°>` dans GitHub Releases. Les apps installées la téléchargent en arrière-plan et l'installent à la fermeture (bandeau « Redémarrer maintenant » dans l'app). Build local : `API_URL=https://<service>.onrender.com npm run dist` (installeur dans `client/release/`).

## Choix d'implémentation à connaître

- **Observations, pas de résultat** : chaque client remonte des événements bruts relatifs à lui (`SELF` / `OPPONENT`) ; le serveur les convertit en joueur absolu, les croise par `EventID`, valide « source unique » après 10 s, passe en litige si les attributions se contredisent, et départage par `EventTime`.
- **CS** : auto-déclaré à chaque seuil, corroboré si la vue de l'adversaire est à 10 près.
- **Observations ignorées hors partie** : il faut `ReportGameStarted` (envoyé au passage du gameflow LCU en `InProgress`) pour que la manche passe `IN_GAME`.
- **Hypothèses des questions ouvertes appliquées** : pas de relance ni de répétition (Q1, Q2), plafond ⌈BO/2⌉+1 jetons par sort borné à BO (Q3), rotation gratuite comptée (Q4), litige tranché par vote des deux joueurs sinon manche annulée (Q5), annulation d'un commun accord (Q6).
- **Sorts proposés** : ceux que Data Dragon marque `ARAM`, liste de secours dans `ReferenceDataService` (POC P9), surchargeable par `Game:AllowedSpellIds`.
- **Endpoints LCU** (non officiels, POC P1–P4) isolés dans `client/electron/lcu-connector.ts`.
