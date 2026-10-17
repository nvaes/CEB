"""Détection automatique de la structure d'un PDF de correction (années sans entrée dans years.json)."""
import re

import subjects
from pdfwords import norm


def _top(p, frac):
    return " ".join(l.text for l in sorted(p.lines, key=lambda l: (round(l.y0), l.x0)) if l.y0 < p.h * frac)


def _bottom(p):
    return " ".join(l.text for l in p.lines if l.y0 > p.h * 0.9)


def section_starts(cpages):
    """Pages qui ouvrent un correctif de livret : en-tête « CEB » + nom de discipline, hors consignes."""
    starts = []
    for p in cpages:
        top = norm(_top(p, 0.14))
        if not re.search(r"\bceb\b", top) or "consignes" in top or "taches complexes" in top:
            continue
        if "gabarit" in top:
            continue
        # tableau de correction attendu : présence d'une colonne de points
        body = norm(p.text)
        if not re.search(r"\b(pt|pts|points?|tout ou rien|modalites)\b", body):
            continue
        sid = subjects.detect(_top(p, 0.2)) or subjects.detect(_bottom(p))
        starts.append((p.idx, sid))
    # fusionne les débuts successifs d'une même discipline (pages de suite)
    out = []
    for idx, sid in starts:
        if out and sid and out[-1][1] == sid:
            continue
        out.append((idx, sid))
    return out


def correction_sections(cpages, livrets):
    """{subject: [[a, b]]} — plages de pages par livret."""
    starts = section_starts(cpages)
    if not starts:
        return {}, "aucune section"
    order = sorted(livrets, key=lambda l: l["n"])
    ends = [s[0] for s in starts[1:]] + [len(cpages) + 1]
    res = {}
    if len(starts) == len(order):  # les correctifs suivent l'ordre des livrets
        for (a, sid), b, lv in zip(starts, ends, order):
            res[lv["subject"]] = [[a, b - 1]]
        return res, "ordre des livrets"
    known = {l["subject"] for l in livrets}
    for (a, sid), b in zip(starts, ends):
        if sid == "nombres" and sid not in known:
            sid = next((x for x in ("nombres1", "nombres2") if x in known and x not in res), sid)
        if sid in known and sid not in res:
            res[sid] = [[a, b - 1]]
        elif sid in res:
            res[sid].append([a, b - 1])
    return res, "disciplines détectées"


def ecouter_pages(cpages, sections):
    first = min((r[0][0] for r in sections.values()), default=len(cpages) + 1)
    hits = [p.idx for p in cpages[:first - 1]
            if re.search(r"support du savoir ecouter|resumes? a lire|extrait a lire", norm(p.text))]
    if not hits:
        return None
    return [hits[0], max(hits)]
