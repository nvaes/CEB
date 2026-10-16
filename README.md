# Révision CEB

Site web de révision du **CEB** (Certificat d'Études de Base, Fédération Wallonie-Bruxelles), construit automatiquement à partir des PDF officiels des années précédentes et hébergé sur votre réseau local avec Docker.

Les enfants travaillent **question par question** sur les vraies épreuves, comparent avec la **correction officielle** de la question, notent leurs points, et le site suit leur progression.

## Fonctionnalités

| | |
|---|---|
| 📚 **Épreuves** | Toutes les années, livret par livret (Écouter, Écrire, Lire, Nombres, Grandeurs, Solides et figures, Histoire-géo, Sciences). Pages d'origine, correction complète et PDF téléchargeables. |
| ✂️ **Découpage automatique** | Chaque question est extraite des questionnaires, associée à sa ligne de correction et aux pages du portfolio qu'elle utilise. Les points par question sont relus et contrôlés avec le total officiel de chaque livret. |
| 🎯 **S'entraîner** | Séries de questions mélangées par compétence et par année (ex. : toutes les questions de « Grandeurs » de 2021 à 2025), filtres « jamais faites » / « pas encore réussies ». |
| 🔁 **À revoir** | Les questions ratées reviennent ; une fois réussies, elles réapparaissent à intervalles espacés (2, 5, 12 jours) pour consolider. Possibilité de marquer une question. |
| ⏱️ **Examen blanc** | Un livret complet avec la durée officielle relevée dans les consignes de passation, puis correction guidée et score. Tableau « simulation du CEB » (seuil de 50 % par épreuve). |
| 🎧 **Écouter** | Le texte lu par l'enseignant est extrait de la correction et lu par la synthèse vocale de l'appareil (vitesse réglable, résumés de la dernière question). |
| ⚡ **Exercices rapides** | Séries générées à l'infini avec correction immédiate : tables, calcul mental, ×/: par 10-100-1 000, fractions et pourcentages, arrondis, décimaux, conversions, durées, périmètres et aires, conjugaison, homophones. 3 niveaux. |
| 📈 **Progrès** | Par enfant : réussite par discipline et compétence, carte d'activité, historique des examens, export CSV. |
| 👨‍👩‍👧 **Multi-enfants** | Un profil par enfant (sans mot de passe), code parent optionnel pour supprimer/réinitialiser. |
| 📱 **Tablette** | Interface responsive, mode sombre, installable sur l'écran d'accueil, impression d'une question. |

Aucune donnée ne quitte votre réseau : pas de compte, pas de service externe.

## Démarrage rapide

```bash
git clone https://github.com/nvaes/CEB.git
cd CEB
# copier les PDF officiels dans pdf/
cp ~/Downloads/CEB/*.pdf pdf/
docker compose up -d --build
```

Puis ouvrir `http://<ip-du-serveur>:8080`.

Au premier démarrage, les PDF sont découpés en pages et en questions (environ une minute pour 5 années sur un PC récent, quelques minutes sur un petit NAS ; la page d'accueil affiche la progression). Les démarrages suivants sont immédiats : le catalogue n'est reconstruit que si les PDF changent.

Une image prête à l'emploi (amd64/arm64) est publiée par GitHub Actions : remplacer `build: .` par `image: ghcr.io/nvaes/ceb:latest` dans `docker-compose.yml`.

### Noms de fichiers attendus

```
pdf/AAAA_CEB_questionnaire.pdf
pdf/AAAA_CEB_correction.pdf
pdf/AAAA_CEB_portfolio.pdf
```

La casse et un `_` final sont tolérés (`2025_CEB_Questionnaire.pdf`, `2021_CEB_portfolio_.pdf`).

### Ajouter une nouvelle année

1. Déposer les trois PDF dans `pdf/`.
2. Espace parent → **Reconstruire le catalogue** (ou redémarrer le conteneur).

Les questions et les points sont détectés automatiquement. Pour la **correction ciblée** par question, ajouter l'année dans [`builder/years.json`](builder/years.json) avec les plages de pages de correction de chaque livret (numérotation du PDF) ; sans cette entrée, le site affiche les questions sans correction ciblée. C'est aussi là que se trouvent les pages du texte « Écouter » et les durées officielles.

## Architecture

```
builder/            extraction (Python + poppler-utils + Pillow)
  build.py          rendu des pages, découpage des questions, appariement des corrections
  pdfwords.py       lecture des positions de mots (pdftotext -bbox-layout)
  subjects.py       référentiel des livrets / disciplines
  years.json        plages de pages de correction, textes « Écouter », durées officielles
app/
  server.py         serveur HTTP (bibliothèque standard) + API JSON + SQLite
  web/              application monopage sans dépendance (HTML/CSS/JS)
pdf/                PDF officiels (non versionnés)
/data (volume)      catalog.json, pages JPEG, ceb.sqlite (progression)
```

**Comment les questions sont découpées.** `pdftotext -bbox-layout` donne la position de chaque mot. Les en-têtes « QUESTION n » délimitent les questions (y compris sur plusieurs pages) ; les marqueurs « /n » de la marge droite donnent les points, contrôlés avec le total « /N » de la couverture du livret. Dans la correction, la colonne « Q » du tableau donne le numéro ; les filets horizontaux du tableau (détectés sur l'image de la page) délimitent précisément chaque ligne. Les grilles « tâches complexes » et les gabarits sont rattachés à leur question. Le navigateur affiche ensuite des **zones** des pages rendues : rien n'est retranscrit à la main.

État avec les PDF 2021-2025 : 730 questions, 720 avec correction ciblée (les 10 autres affichent les pages de correction du livret), points conformes au total officiel pour les 48 livrets.

### API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/status` | état de la construction du catalogue |
| GET | `/api/catalog` | années, livrets, questions et zones |
| GET/POST | `/api/profiles` | profils enfants |
| GET | `/api/profiles/{id}/state` | essais, examens, exercices, marque-pages |
| POST | `/api/profiles/{id}/attempts` · `/exams` · `/drills` | enregistrement |
| GET | `/api/profiles/{id}/export` | export CSV |
| POST | `/api/rebuild` | reconstruction forcée |

### Développement sans Docker

```bash
sudo apt install poppler-utils   # ou: brew install poppler
pip install Pillow
CEB_PDF_DIR=./pdf CEB_DATA_DIR=./data PORT=8080 python3 app/server.py
```

## Limites connues

- Les réponses se font sur papier (ou à l'oral) : l'enfant s'auto-évalue avec la correction officielle. C'est volontaire, la majorité des questions du CEB sont ouvertes.
- « Écouter » utilise la voix de synthèse du navigateur : la qualité dépend de l'appareil (les voix françaises d'iPad/macOS et de Chrome sont correctes).
- Le questionnaire 2021 fourni est la version adaptée « Arial 14 » ; sa couverture porte la mention CEB2020.

## Droits

Le code est sous licence MIT. Les épreuves du CEB appartiennent à la Fédération Wallonie-Bruxelles et **ne sont pas incluses** dans ce dépôt : chaque utilisateur dépose ses propres copies des PDF publiés par la FWB, pour un usage privé.
