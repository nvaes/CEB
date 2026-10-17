"""
Couche « réponses interactives » : extrait des PDF

- les cases à cocher du questionnaire (glyphe ``\\uf0a3``) avec le texte de chaque proposition ;
- les lignes de réponse (soulignés ``____`` ou filets dessinés) où l'enfant peut écrire ;
- les marqueurs de points « /n » (pour regrouper les cases et répartir les points) ;
- la clé de correction des cases : quelle proposition est cochée dans la correction officielle.

Pour la clé, deux méthodes complémentaires :
1. texte du PDF de correction quand les cases y sont des glyphes (☐ / ☒) ;
2. sinon reconnaissance optique (tesseract) de la zone de correction + repérage des croix rouges,
   puis alignement des lignes reconnues avec les propositions du questionnaire.
Une clé n'est retenue que si l'alignement est complet et cohérent ; sinon la question reste en
auto-évaluation (l'enfant compare avec la correction).
"""
import difflib
import re
import shutil
import subprocess
import unicodedata

import numpy as np
from PIL import Image

BOX_Q = ""                                   # case vide dans les questionnaires
BOX_EMPTY = {"", "☐", "", "", "□", ""}
BOX_CHECKED = {"", "☒", "", "☑", "", ""}
CTRL = re.compile(r"[\x00-\x1f-☐-☒□]")
HAS_TESS = shutil.which("tesseract") is not None


def simp(s):
    s = unicodedata.normalize("NFKD", CTRL.sub(" ", s))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("’", "'")
    return re.sub(r"[^a-z0-9%,']+", " ", s).strip()


def ratio(a, b):
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


# ------------------------------------------------------------------ questionnaire
def options_of(pages, q):
    """Cases à cocher d'une question, dans l'ordre de lecture, avec le texte qui suit chaque case
    sur la même ligne visuelle (indépendamment du découpage en lignes de pdftotext)."""
    opts = []
    for s in q["segs"]:
        p = pages[s["p"] - 1]
        lo, hi = s["y0"] * p.h - 2, s["y1"] * p.h
        words = p.words
        boxes = [w for w in words if BOX_Q in w.t and lo <= w.y0 < hi]
        for w in boxes:
            size = (w.y1 - w.y0)
            gi = w.t.index(BOX_Q)
            # la boîte englobante inclut d'éventuelles tabulations avant la case
            gx = w.x0 if gi == 0 else (w.x1 - size * 0.95 if gi == len(w.t) - 1 else w.x0)
            mid = (w.y0 + w.y1) / 2
            row = sorted([x for x in words if x is not w and x.x0 >= gx + size * 0.3
                          and abs((x.y0 + x.y1) / 2 - mid) < size * 0.6], key=lambda x: x.x0)
            parts, last = [w.t[gi + 1:]], w.x1
            for x in row:
                if BOX_Q in x.t or x.x0 - last > max(3 * size, 30):
                    break
                parts.append(x.t)
                last = x.x1
            text = re.sub(r"\s+", " ", CTRL.sub(" ", " ".join(parts))).strip()
            opts.append({"p": s["p"], "x": round(gx / p.w, 4), "y": round(w.y0 / p.h, 4),
                         "w": round(size * 0.95 / p.w, 4), "h": round(size / p.h, 4), "t": text})
    out = []
    for o in sorted(opts, key=lambda o: (o["p"], round(o["y"] * 200), o["x"])):
        if out and out[-1]["p"] == o["p"] and abs(out[-1]["y"] - o["y"]) < 0.004 and abs(out[-1]["x"] - o["x"]) < 0.01:
            continue
        out.append(o)
    return out


def point_marks(pages, q):
    marks = []
    for s in q["segs"]:
        p = pages[s["p"] - 1]
        words = [w for w in p.words if s["y0"] * p.h - 2 <= w.y0 < s["y1"] * p.h]
        for i, w in enumerate(words):
            t = w.t.replace(" ", "")
            m = re.match(r"^/(\d{1,2})$", t)
            if not m and t == "/" and i + 1 < len(words) and re.fullmatch(r"\d{1,2}", words[i + 1].t):
                m = re.match(r"(\d+)", words[i + 1].t)
            if m and w.x0 > p.w * 0.86 and w.y0 < p.h * 0.935:
                y = w.y0 / p.h
                if any(abs(y - mm["y"]) < 0.004 and mm["p"] == s["p"] for mm in marks):
                    continue
                marks.append({"p": s["p"], "y": round(y, 4), "n": int(m.group(1))})
    # le premier « /22 » de l'en-tête de question est exclu par la règle x>0.86 dans build.py ;
    # ici on écarte aussi tout marqueur collé à l'en-tête (premier 3 % du segment de tête)
    if q["segs"]:
        s0 = q["segs"][0]
        marks = [m for m in marks if not (m["p"] == s0["p"] and m["y"] < s0["y0"] + 0.03)]
    return marks


def underscore_fields(pages, q):
    """Lignes « ______ » du questionnaire = zones de saisie."""
    out = []
    for s in q["segs"]:
        p = pages[s["p"] - 1]
        for w in p.words:
            if re.fullmatch(r"[_.…]{6,}[.]?", w.t) and s["y0"] * p.h <= w.y0 < s["y1"] * p.h \
                    and (w.x1 - w.x0) > p.w * 0.06:
                out.append({"p": s["p"], "x": round(w.x0 / p.w, 4), "y": round(w.y1 / p.h, 4),
                            "w": round((w.x1 - w.x0) / p.w, 4)})
    return out


def drawn_fields(img_path, segs_on_page, page_no, existing):
    """Filets horizontaux fins et isolés (lignes d'écriture dessinées) sur l'image de la page."""
    im = np.asarray(Image.open(img_path).convert("L"))
    H, W = im.shape
    out = []
    dark = im < 215
    for s in segs_on_page:
        y0, y1 = int(s["y0"] * H), int(s["y1"] * H)
        band = dark[y0:y1]
        rows = band.sum(1)
        for ry in np.where(rows > W * 0.12)[0]:
            row = band[ry]
            # plus longue suite continue
            d = np.diff(np.concatenate(([0], row.astype(np.int8), [0])))
            starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
            if not len(starts):
                continue
            k = int(np.argmax(ends - starts))
            a, b = int(starts[k]), int(ends[k])
            if b - a < W * 0.12 or b - a > W * 0.86 or a < W * 0.06:
                continue
            yabs = y0 + ry
            # ligne fine : pas d'encre juste au-dessus ni en dessous sur la longueur (pas un cadre plein)
            above = dark[max(0, yabs - 14):yabs - 2, a:b].mean() if yabs > 16 else 1
            below = max(dark[yabs + 3:yabs + 10, a:b].mean(), 0.5 * (im[yabs + 3:yabs + 14, a:b] < 242).mean()) if yabs + 14 < H else 1
            if above > 0.02 or below > 0.05:
                continue
            # texte collé au-dessus ou en dessous sur une bonne partie de la longueur (étiquette, encadré)
            cov_above = dark[max(0, yabs - 26):max(0, yabs - 4), a:b].any(0).mean()
            cov_below = dark[yabs + 4:yabs + 26, a:b].any(0).mean() if yabs + 26 < H else 1
            if cov_above > 0.25 or cov_below > 0.25:
                continue
            # extrémités : pas de traits verticaux (sinon c'est un tableau)
            vert = max(dark[max(0, yabs - 20):yabs - 1, max(0, a - 3):a + 4].mean(), dark[max(0, yabs - 20):yabs - 1, max(0, b - 4):b + 3].mean(),
                       dark[yabs + 2:yabs + 20, max(0, a - 3):a + 4].mean(), dark[yabs + 2:yabs + 20, max(0, b - 4):b + 3].mean())
            if vert > 0.12:
                continue  # extrémités prolongées par un trait vertical : cadre, tableau ou étiquette
            fy = round(float(yabs) / H, 4)
            if any(f["p"] == page_no and abs(f["y"] - fy) < 0.008 and abs(f["x"] - a / W) < 0.05 for f in out + existing):
                continue
            out.append({"p": page_no, "x": round(a / W, 4), "y": fy, "w": round((b - a) / W, 4)})
    return out


# ------------------------------------------------------------------ correction
def key_from_pdf_text(cpages, corr, opts):
    """Cases présentes comme glyphes dans le PDF de correction."""
    found = []
    for s in corr:
        p = cpages[s["p"] - 1]
        for l in sorted(p.lines, key=lambda l: (round(l.y0), l.x0)):
            if not (s["y0"] * p.h - 2 <= l.y0 < s["y1"] * p.h):
                continue
            for k, w in enumerate(l.words):
                ch = w.t[:1]
                if ch in BOX_EMPTY or ch in BOX_CHECKED:
                    parts = [w.t[1:]]
                    for nxt in l.words[k + 1:]:
                        if nxt.t[:1] in BOX_EMPTY or nxt.t[:1] in BOX_CHECKED:
                            break
                        parts.append(nxt.t)
                    found.append((simp(" ".join(parts)), ch in BOX_CHECKED))
    if len(found) < len(opts) or not any(c for _, c in found):
        return None
    return align([simp(o["t"]) for o in opts], found)


def align(opt_texts, lines, min_ratio=0.55):
    """Aligne les propositions (ordre de lecture) sur des lignes reconnues [(texte, coché)]
    en respectant l'ordre. Retourne la liste des booléens ou None."""
    res, j = [], 0
    for ot in opt_texts:
        best, bj = 0.0, -1
        for jj in range(j, min(len(lines), j + 12)):
            lt = lines[jj][0]
            r = max(ratio(ot, lt[:len(ot) + 6]), ratio(ot, lt)) if ot else (1.0 if not lt else 0)
            if len(ot) <= 4:  # « OUI », « NON », « A »…
                r = 1.0 if lt.startswith(ot) or lt == ot else r * 0.8
            if r > best:
                best, bj = r, jj
        if best < min_ratio:
            return None
        res.append(lines[bj][1])
        j = bj + 1
    return res


def _ocr_lines(img):
    """Lignes OCR : [(texte, x0, y0, x1, y1)] en pixels de l'image donnée."""
    up = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    try:
        out = subprocess.run(["tesseract", "stdin", "stdout", "-l", "fra+eng", "--psm", "4", "tsv"],
                             input=_png(up), capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
    except Exception:
        return []
    lines = {}
    for row in out.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or not c[11].strip() or c[0] != "5":
            continue
        key = (c[2], c[3], c[4])
        x, y, w, h = (int(v) // 2 for v in c[6:10])
        lines.setdefault(key, []).append((x, y, x + w, y + h, c[11]))
    res = []
    for ws in lines.values():
        ws.sort()
        res.append((" ".join(w[4] for w in ws), min(w[0] for w in ws), min(w[1] for w in ws),
                    max(w[2] for w in ws), max(w[3] for w in ws), ws))
    res.sort(key=lambda r: (r[2], r[1]))
    return res


def _png(img):
    import io
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def key_from_image(img_dir, corr, opts):
    """OCR de la zone de correction + croix rouges / cases noircies."""
    if not HAS_TESS or any(len(simp(o["t"])) < 2 for o in opts):
        return None
    lines = []
    for s in corr:
        im = Image.open(f"{img_dir}/{s['p']}.jpg").convert("RGB")
        W, H = im.size
        y0, y1 = int(s["y0"] * H), int(s["y1"] * H)
        # colonne des réponses seulement (on coupe les colonnes « modalités / points »)
        x1 = int(W * 0.78)
        crop = im.crop((0, y0, x1, y1))
        a = np.asarray(crop).astype(int)
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        red = (r > 120) & (r - g > 45) & (r - b > 35)
        gray = np.asarray(crop.convert("L"))
        for text, lx0, ly0, lx1, ly1, ws in _ocr_lines(crop):
            t = simp(text)
            # retire le(s) jeton(s) parasite(s) issus de la case elle-même (« Cl », « L] », « & »…)
            body = list(ws)
            while len(body) > 1 and len(re.sub(r"[^A-Za-zÀ-ÿ0-9]", "", body[0][4])) <= 2 and body[0][0] - lx0 < 40:
                body.pop(0)
            if len(body) < len(ws):
                t = simp(" ".join(w[4] for w in body))
            bx0, bx1 = max(0, body[0][0] - 45), body[0][0] + 2
            by0, by1 = max(0, ly0 - 6), min(a.shape[0], ly1 + 6)
            redfrac = red[by0:by1, bx0:bx1].mean() if bx1 > bx0 and by1 > by0 else 0
            box = gray[by0:by1, bx0:bx1]
            ink = (box < 110).mean() if box.size else 0
            lines.append((t, float(redfrac), float(ink)))
    if not lines:
        return None
    # décision relative : une croix rouge est petite et pâlie par la compression JPEG
    mr = max(l[1] for l in lines)
    mi = max(l[2] for l in lines)
    marked = []
    for t, rf, ik in lines:
        on = (mr >= 0.004 and rf >= max(0.004, 0.45 * mr)) or (mr < 0.004 and mi > 0.30 and ik >= 0.8 * mi)
        marked.append((t, on))
    if not any(c for _, c in marked):
        return None
    return align([simp(o["t"]) for o in opts], marked)


def _group_index(marks, o):
    g = 0
    for i, m in enumerate(marks):
        if (m["p"], m["y"]) <= (o["p"], o["y"] + 0.002):
            g = i
    return g


def _key_consistent(opts, key, marks):
    """Propositions répétées dans un même groupe (« OUI / NON », « au sol / aérienne » pour
    plusieurs items) : chaque série doit contenir au moins une case cochée."""
    groups = {}
    for o, k in zip(opts, key):
        groups.setdefault(_group_index(marks, o), []).append((simp(o["t"]), k))
    for items in groups.values():
        first = items[0][0]
        if not first or sum(1 for t, _ in items if t == first) < 2:
            continue
        chunks, cur = [], []
        for t, k in items:
            if t == first and cur:
                chunks.append(cur)
                cur = []
            cur.append(k)
        chunks.append(cur)
        if not all(any(c) for c in chunks):
            return False
    return True


def extract(qpages, cpages, q, year_dir):
    """Construit la structure 'interact' d'une question."""
    opts = options_of(qpages, q)
    marks = point_marks(qpages, q)
    fields = underscore_fields(qpages, q)
    for p in sorted({s["p"] for s in q["segs"]}):
        fields += drawn_fields(f"{year_dir}/q/{p}.jpg", [s for s in q["segs"] if s["p"] == p], p, fields)
    key, method = None, None
    if opts and q.get("corr") and cpages is not None:
        key = key_from_pdf_text(cpages, q["corr"], opts)
        method = "texte" if key else None
        if key is None:
            key = key_from_image(f"{year_dir}/c", q["corr"], opts)
            method = "ocr" if key else None
    if key is not None and not any(key):
        key, method = None, None
    if key is not None and not _key_consistent(opts, key, marks):
        key, method = None, None
    if key:
        for o, k in zip(opts, key):
            o["ok"] = bool(k)
    # regroupement des cases par marqueur de points
    for o in opts:
        o["g"] = _group_index(marks, o)
    for f in fields:
        f["y"] = round(f["y"], 4)
    return {"opts": opts, "marks": marks, "fields": fields, "key": method}
