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
| ✍️ **Réponses à l'écran** | L'enfant répond directement sur les pages : les cases à cocher et les lignes de réponse sont repérées dans les PDF (cases cliquables, champs de saisie posés sur les lignes) ; pour les tableaux, schémas et tracés, outils ✗ croix, Aa texte, ✏️ crayon et gomme. Réponses sauvegardées par enfant. |
| 🤖 **Correction automatique des cases** | La clé de chaque question à cases est extraite de la correction officielle (glyphes ☒ du PDF, ou reconnaissance optique + détection des croix rouges) ; les cases sont corrigées et notées automatiquement, le reste de la question est évalué avec la correction. |
| ⏱️ **Examen blanc** | Un livret complet, réponses à l'écran, durée officielle relevée dans les consignes de passation (brouillon sauvegardé, reprise possible), puis correction : cases notées automatiquement, reste guidé. Tableau « simulation du CEB » (seuil de 50 % par épreuve). |
| 📤 **Fichiers CEB** | Téléversement des PDF d'une nouvelle année depuis le navigateur, détection automatique des livrets et des sections de correction, réglage fin des plages de pages si nécessaire, analyse incrémentale (les années inchangées sont reprises du cache). |
| 🎧 **Écouter** | Le texte lu par l'enseignant est extrait de la correction et lu par la synthèse vocale de l'appareil (vitesse réglable, résumés de la dernière question). |
| ⚡ **Exercices rapides** | Séries générées à l'infini avec correction immédiate : tables, calcul mental, ×/: par 10-100-1 000, fractions et pourcentages, arrondis, décimaux, conversions, durées, périmètres et aires, conjugaison, homophones. 3 niveaux. |
| 👪 **Familles** | Plusieurs familles peuvent partager le même serveur : chaque famille a **son propre code parent** et **ne voit que ses enfants** (progrès, gestion, codes). Chaque tablette est associée une fois à une famille avec le code parent ; l'écran « Qui révise aujourd'hui ? » n'affiche alors que les enfants de cette famille. Le premier compte créé est l'**administrateur** : il gère les fichiers CEB et les familles, et voit la progression de tous les enfants. |
| 🔒 **Espace Parents** | Accès par **code parent** (demandé à chaque entrée ; la session se ferme dès qu'on quitte l'espace, avec « Verrouiller » ou après 4 h). Regroupe : **📈 Progrès** de ses enfants (tous pour l'administrateur) (réussite par discipline et compétence, carte d'activité, examens blancs, simulation du CEB, exercices, export CSV), **👨‍👩‍👧 Enfants** (ajout, modification, réinitialisation du code, remise à zéro, suppression), **⚙️ Réglages** (son code parent, association de la tablette) et, pour l'administrateur, **📤 Fichiers CEB** et **👪 Familles** (créer une famille avec son code, renommer, nouveau code, supprimer). |
| 👨‍👩‍👧 **Multi-enfants** | Un profil par enfant protégé par un **code secret** (4 à 6 chiffres, pavé numérique adapté aux enfants), choisi à la création du profil. L'enfant peut changer son code ; en cas d'oubli, un parent le **réinitialise** (code parent requis) et l'enfant en choisit un nouveau à sa prochaine connexion. 5 erreurs de suite bloquent le profil 30 s, puis plus longtemps. |
| 🔑 **Codes parents** | Un code par famille, unique sur le serveur (c'est lui qui identifie la famille). Le cloisonnement est appliqué **par le serveur** : une session parent ne peut lire ou modifier que les enfants de sa famille, seul l'administrateur peut téléverser, lancer l'analyse et gérer les familles. Un ancien code parent unique est migré automatiquement en compte administrateur. |
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

Au premier démarrage, les PDF sont découpés en pages, en questions et en zones de réponse, reconnaissance optique comprise (environ 5 minutes pour 5 années sur 2 cœurs, davantage sur un petit NAS ; la page d'accueil affiche la progression). Les démarrages suivants sont immédiats : le catalogue n'est reconstruit que si les PDF changent.

Une image prête à l'emploi (amd64/arm64) est publiée par GitHub Actions : remplacer `build: .` par `image: ghcr.io/nvaes/ceb:latest` dans `docker-compose.yml`.

### Noms de fichiers attendus

```
pdf/AAAA_CEB_questionnaire.pdf
pdf/AAAA_CEB_correction.pdf
pdf/AAAA_CEB_portfolio.pdf
```

La casse et un `_` final sont tolérés (`2025_CEB_Questionnaire.pdf`, `2021_CEB_portfolio_.pdf`).

### Ajouter une nouvelle année

**Depuis le site** : **🔒 Parents → 📤 Fichiers CEB** → choisir l'année et les trois PDF → *Envoyer et analyser*. Les fichiers sont stockés dans le volume de données (`/data/pdf`), le dossier `pdf/` peut donc rester en lecture seule.

**Ou à la main** : déposer les PDF dans `pdf/` puis *Relancer l'analyse* (ou redémarrer le conteneur).

Tout est détecté automatiquement : livrets, questions, points, sections de correction de chaque livret (les correctifs suivent l'ordre des livrets ; validé sur 2021-2025, identique aux réglages manuels à une page d'annexe près), texte « Écouter », cases et lignes de réponse, clé des cases. Si une correction ne tombe pas en face de la bonne question, la page **Parents → Fichiers CEB → Réglage fin** permet d'ajuster les plages de pages (enregistré dans `/data/years.local.json`). Les réglages de référence des années fournies sont dans [`builder/years.json`](builder/years.json).

## Architecture

```
builder/            extraction (Python + poppler-utils + tesseract + Pillow/numpy)
  build.py          rendu des pages, découpage des questions, appariement des corrections, cache par année
  answers.py        cases, lignes de réponse, marqueurs de points, clé de correction des cases (texte/OCR)
  autodetect.py     détection des sections de correction pour une année sans réglage
  pdfwords.py       lecture des positions de mots (pdftotext -bbox-layout)
  subjects.py       référentiel des livrets / disciplines
  years.json        plages de pages de correction, textes « Écouter », durées officielles
app/
  server.py         serveur HTTP (bibliothèque standard) + API JSON + SQLite
  web/              application monopage sans dépendance (HTML/CSS/JS)
pdf/                PDF officiels (non versionnés)
/data (volume)      catalog.json, pages JPEG, ceb.sqlite (progression, réponses), pdf/ (téléversements), cache/
```

**Comment les questions sont découpées.** `pdftotext -bbox-layout` donne la position de chaque mot. Les en-têtes « QUESTION n » délimitent les questions (y compris sur plusieurs pages) ; les marqueurs « /n » de la marge droite donnent les points, contrôlés avec le total « /N » de la couverture du livret. Dans la correction, la colonne « Q » du tableau donne le numéro ; les filets horizontaux du tableau (détectés sur l'image de la page) délimitent précisément chaque ligne. Les grilles « tâches complexes » et les gabarits sont rattachés à leur question. Le navigateur affiche ensuite des **zones** des pages rendues : rien n'est retranscrit à la main.

**Comment les réponses deviennent interactives.** Les cases à cocher sont des glyphes du PDF (position exacte + texte de la proposition). Les lignes de réponse sont soit des soulignés `____` du texte, soit des filets fins détectés sur l'image. Pour la clé, l'outil lit d'abord les cases ☐/☒ du PDF de correction ; si la correction est une image, il passe la zone en reconnaissance optique (tesseract, français), repère les croix rouges ou les cases noircies et aligne les lignes reconnues avec les propositions du questionnaire. Une clé n'est conservée que si l'alignement est complet et cohérent (au moins une case juste par série) ; sinon la question reste en auto-évaluation.

État avec les PDF 2021-2025 : 730 questions, 720 avec correction ciblée (les 10 autres affichent les pages de correction du livret), points conformes au total officiel pour les 48 livrets. Réponses interactives : 531 questions avec cases et/ou lignes de réponse détectées (1 694 cases, 884 lignes), 136 questions à cases avec clé automatique ; les autres se répondent avec les outils libres et se corrigent avec la correction officielle.

### API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/status` | état de la construction du catalogue |
| GET | `/api/catalog` | années, livrets, questions et zones |
| GET/POST | `/api/profiles` | profils enfants |
| POST | `/api/parent/setup` · `/login` · `/check` · `/logout` | création du compte administrateur (une seule fois) · session parent → jeton `X-Parent-Token` (4 h) |
| GET | `/api/parent/children` | enfants visibles par la session parent (sa famille, ou tous pour l'administrateur) |
| GET/POST/PUT/DELETE | `/api/parents[/{id}]` | familles (administrateur ; un parent peut changer son propre code) |
| POST/GET | `/api/family/bind` · `/info` · `/unbind` | association d'une tablette à une famille → clé `X-Family-Key` ; `GET /api/profiles` ne renvoie que les enfants de cette famille |
| POST | `/api/profiles/{id}/login` | code de l'enfant → jeton de session (en-tête `X-Profile-Token` pour les routes du profil) |
| POST | `/api/profiles/{id}/setcode` · `/logout` | changer son code · se déconnecter |
| POST | `/api/profiles/{id}/resetcode` | réinitialisation du code par un parent (session parent requise) |
| GET | `/api/profiles/{id}/state` | essais, examens, exercices, marque-pages (jeton de l'enfant ou session parent) |
| POST | `/api/profiles/{id}/attempts` · `/exams` · `/drills` | enregistrement |
| GET | `/api/profiles/{id}/export` | export CSV |
| PUT | `/api/profiles/{id}/answers` | réponses saisies à l'écran |
| POST | `/api/upload?year=AAAA&kind=questionnaire\|correction\|portfolio` | téléversement (corps = PDF, session parent requise) |
| DELETE | `/api/uploads/{fichier}` | suppression d'un fichier téléversé |
| GET/PUT | `/api/yearconfig/{année}` | réglage fin d'une année |
| POST | `/api/rebuild` | relance de l'analyse (années inchangées reprises du cache) |

### Développement sans Docker

```bash
sudo apt install poppler-utils tesseract-ocr tesseract-ocr-fra   # ou: brew install poppler tesseract tesseract-lang
pip install Pillow numpy
CEB_PDF_DIR=./pdf CEB_DATA_DIR=./data PORT=8080 python3 app/server.py
```

## Limites connues

- Seules les **cases à cocher** sont notées automatiquement (environ la moitié des questions à cases ont une clé fiable). Les réponses rédigées, les tableaux à croix, les tracés et les calculs sont comparés par l'enfant (ou le parent) à la correction officielle affichée juste en dessous : une correction automatique de texte libre serait trop peu fiable pour le CEB.
- Pour une année téléversée sans réglage, vérifier quelques corrections : la détection automatique des sections peut inclure une page d'annexe en trop.
- « Écouter » utilise la voix de synthèse du navigateur : la qualité dépend de l'appareil (les voix françaises d'iPad/macOS et de Chrome sont correctes).
- Le questionnaire 2021 fourni est la version adaptée « Arial 14 » ; sa couverture porte la mention CEB2020.

## Sécurité

Le site est prévu pour un réseau domestique (HTTP, sans compte). Les codes enfants et le code parent sont stockés hachés (PBKDF2 / SHA-256) ; 5 erreurs de suite bloquent temporairement la saisie (enfant ou parent) ; la session parent n'est gardée qu'en mémoire du navigateur (verrouillée au rechargement de la page) ; les codes enfants servent à séparer les profils entre frères et sœurs, pas à protéger le site contre un attaquant du réseau. Pour un accès depuis l'extérieur, placer le site derrière un reverse proxy avec HTTPS et authentification (ou un VPN). Les profils créés avant l'ajout des codes demandent à l'enfant de créer son code à la première connexion.

## Droits

Le code est sous licence MIT. Les épreuves du CEB appartiennent à la Fédération Wallonie-Bruxelles et **ne sont pas incluses** dans ce dépôt : chaque utilisateur dépose ses propres copies des PDF publiés par la FWB, pour un usage privé.
