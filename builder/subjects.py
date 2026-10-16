"""Référentiel des livrets du CEB (Fédération Wallonie-Bruxelles)."""
from pdfwords import norm

# id, libellé, discipline, mots-clés (normalisés, testés dans l'ordre)
SUBJECTS = [
    ("nombres2", "Nombres et opérations 2", "math", ["nombres et operations 2"]),
    ("nombres1", "Nombres et opérations 1", "math", ["nombres et operations 1"]),
    ("nombres", "Nombres et opérations", "math", ["nombres et operation", "nombres"]),
    ("grandeurs", "Grandeurs", "math", ["grandeurs"]),
    ("solides", "Solides et figures", "math", ["solides"]),
    ("histgeo", "Formation historique et géographique", "eveil", ["historique", "geographique"]),
    ("sciences", "Initiation scientifique", "eveil", ["scientifique"]),
    ("ecouter", "Écouter", "francais", ["ecouter"]),
    ("ecrire", "Écrire", "francais", ["ecrire"]),
    ("lire-info", "Lire – texte informatif", "francais", ["lire informatif", "informatif"]),
    ("lire-fict", "Lire – texte fictionnel", "francais", ["lire fictionnel", "fictionnel"]),
]
DISCIPLINES = {
    "francais": {"label": "Français", "color": "#e4572e"},
    "math": {"label": "Mathématiques", "color": "#2e86de"},
    "eveil": {"label": "Éveil", "color": "#27ae60"},
}
SUBJECT_BY_ID = {s[0]: s for s in SUBJECTS}


def detect(text):
    t = norm(text)
    for sid, _label, _disc, keys in SUBJECTS:
        if any(k in t for k in keys):
            return sid
    return None
