# Contexte de build : dossier server/
# Installeur Windows et flux de mise à jour, publiés par .github/workflows/release-client.yml.
ARG LAUNCHER_IMAGE=ghcr.io/azukiro/duelyst-launcher:latest
FROM ${LAUNCHER_IMAGE} AS launcher

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Api/Api.csproj Api/
RUN dotnet restore Api/Api.csproj
COPY Api/ Api/
RUN dotnet publish Api/Api.csproj -c Release -o /app --no-restore
# Numéro de build (date UTC) : lu par /api/v1/version et gravé dans l'app des reliques et son service worker,
# pour que chaque déploiement change la version affichée et renouvelle le cache hors ligne.
RUN BUILD=$(date -u +%Y.%m.%d-%H%M) \
 && echo "$BUILD" > /app/version.txt \
 && sed -i "s/__BUILD__/$BUILD/g" /app/wwwroot/reliques/app.js /app/wwwroot/reliques/sw.js

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app .
COPY --from=launcher / ./updates/
ENV ASPNETCORE_ENVIRONMENT=Production
# Render fournit PORT ; 8080 par défaut en local.
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]