#!/usr/bin/env python3
"""
Construit le catalogue de révision CEB à partir des PDF officiels.

Entrée  : un dossier contenant pour chaque année
            AAAA_CEB_questionnaire.pdf, AAAA_CEB_correction.pdf, AAAA_CEB_portfolio.pdf
          (la casse et les suffixes "_" sont tolérés)
Sortie  : <out>/catalog.json + <out>/pages/<année>/<q|c|p>/<n>.jpg

Usage   : python3 build.py --pdf /pdf --out /data [--force]
"""
import argparse
import concurrent.futures as cf
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image

import answers
import autodetect
import pdfwords
import subjects
from pdfwords import norm

HERE = os.path.dirname(os.path.abspath(__file__))
DPI = int(os.environ.get("CEB_DPI", "125"))
JPEG_Q = int(os.environ.get("CEB_JPEG_QUALITY", "72"))
BUILD_VERSION = 12  # incrémenter pour forcer une reconstruction après changement d'algorithme

TOP_MARGIN = 0.035   # fraction de hauteur ignorée en haut de page (continuations)
BOTTOM_CUT = 0.935   # au-delà : pied de page (numéro, sous-total)


def log(*a):
    print("[build]", *a, flush=True)


# ---------------------------------------------------------------- fichiers
def find_years(pdf_dirs):
    """Recherche les PDF dans un ou plusieurs dossiers (séparés par os.pathsep).
    En cas de doublon, le dernier dossier (téléversements) l'emporte."""
    years = {}
    for pdf_dir in [d for d in str(pdf_dirs).split(os.pathsep) if d]:
        if not os.path.isdir(pdf_dir):
            continue
        for f in sorted(os.listdir(pdf_dir)):
            m = re.match(r"(\d{4})_CEB_([A-Za-z]+)_?\.pdf$", f, re.I)
            if not m:
                continue
            kind = m.group(2).lower()
            key = {"questionnaire": "q", "questionnaires": "q", "correction": "c", "corrections": "c",
                   "correctif": "c", "portfolio": "p"}.get(kind)
            if key:
                years.setdefault(m.group(1), {})[key] = os.path.join(pdf_dir, f)
    return {y: v for y, v in years.items() if "q" in v}


def fingerprint(files):
    h = hashlib.sha1(str(BUILD_VERSION).encode())
    for f in sorted(files):
        st = os.stat(f)
        h.update(f"{os.path.basename(f)}:{st.st_size}:{int(st.st_mtime)}".encode())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- rendu
def render(pdf, outdir, npages, workers):
    os.makedirs(outdir, exist_ok=True)
    if len([f for f in os.listdir(outdir) if f.endswith(".jpg")]) == npages:
        return
    chunk = max(4, npages // (workers * 2) + 1)
    ranges = [(a, min(a + chunk - 1, npages)) for a in range(1, npages + 1, chunk)]

    def job(r):
        tmp = tempfile.mkdtemp(dir=outdir)
        subprocess.run(["pdftoppm", "-r", str(DPI), "-jpeg", "-jpegopt", f"quality={JPEG_Q},optimize=y",
                        "-f", str(r[0]), "-l", str(r[1]), pdf, os.path.join(tmp, "x")],
                       check=True, capture_output=True)
        for f in os.listdir(tmp):
            n = int(re.search(r"-(\d+)\.jpg$", f).group(1))
            os.replace(os.path.join(tmp, f), os.path.join(outdir, f"{n}.jpg"))
        shutil.rmtree(tmp, ignore_errors=True)

    with cf.ThreadPoolExecutor(workers) as ex:
        list(ex.map(job, ranges))


def h_rules(img_path, min_frac=0.55):
    """Ordonnées (fraction de hauteur) des filets horizontaux d'un tableau."""
    im = Image.open(img_path).convert("L").point(lambda v: 0 if v < 140 else 255)
    w, h = im.size
    data = im.tobytes()
    rows = []
    for y in range(h):
        if data[y * w:(y + 1) * w].count(0) > w * min_frac:
            rows.append(y)
    # fusion des lignes adjacentes (filets épais / doubles)
    merged = []
    for y in rows:
        if merged and y - merged[-1][1] <= 3:
            merged[-1][1] = y
        else:
            merged.append([y, y])
    return [round((a + b) / 2 / h, 4) for a, b in merged]


# ---------------------------------------------------------------- questionnaire
def find_covers(pages):
    covers = []
    for p in pages:
        for l in p.lines:
            m = re.search(r"livret\s*(\d+)\s*\|", norm(l.text))
            if m:
                near = [x for x in p.lines if l.y0 - 90 < x.y0 < l.y0]
                sid = subjects.detect(" ".join(x.text for x in sorted(near, key=lambda x: x.y0)))
                if not sid:
                    sid = subjects.detect(p.text)
                tot = [int(w.t.strip("/ ")) for w in p.words if re.fullmatch(r"/\s?\d{1,3}", w.t)]
                covers.append({"page": p.idx, "n": int(m.group(1)), "subject": sid,
                               "total": tot[0] if tot else None})
                break
    return covers


def question_headings(page):
    """Repère « QUESTION » + numéro ; retourne [(y_haut, numéro)] trié."""
    out = []
    words = page.words
    for w in words:
        if norm(w.t) != "question":
            continue
        best = None
        for d in words:
            if re.fullmatch(r"\d{1,2}", d.t) and w.y0 - 40 <= d.y0 <= w.y0 + 40 and w.x0 - 15 <= d.x0 <= w.x1 + 110:
                dist = abs(d.y0 - w.y0) + abs(d.x0 - w.x1) / 3
                if best is None or dist < best[0]:
                    best = (dist, d)
        if best:
            out.append((min(w.y0, best[1].y0) / page.h, int(best[1].t)))
    out.sort()
    # dédoublonnage
    res = []
    for y, n in out:
        if not res or abs(res[-1][0] - y) > 0.02:
            res.append((y, n))
    return res


PTS = re.compile(r"^/\s?(\d{1,2})$")
PORTF = re.compile(r"\bP\.\s*(\d{1,2})(?:\s*(?:-|–|à|et|,)\s*(\d{1,2}))?")


def region_words(page, y0, y1):
    return [w for w in page.words if y0 * page.h - 2 <= w.y0 < y1 * page.h]


def analyse_region(page, y0, y1, heading_y=None):
    pts, portfolio, words = 0, set(), region_words(page, y0, y1)
    # tokens "/n" peuvent être découpés ("/" "1")
    toks = []
    for w in words:
        toks.append(w)
    for i, w in enumerate(toks):
        t = w.t.replace(" ", "")
        m = PTS.match(t)
        if not m and t == "/" and i + 1 < len(toks) and re.fullmatch(r"\d{1,2}", toks[i + 1].t) \
                and abs(toks[i + 1].y0 - w.y0) < 4:
            m = re.match(r"(\d+)", toks[i + 1].t)
        if not m:
            continue
        if w.x0 < page.w * 0.86 or w.y0 > page.h * BOTTOM_CUT:
            continue
        if heading_y is not None and abs(w.y0 / page.h - heading_y) < 0.035:
            continue  # « /22 » = nombre de questions du livret
        pts += int(m.group(1))
    lines = [l for l in page.lines if y0 * page.h - 2 <= l.y0 < y1 * page.h]
    for l in lines:
        for m in PORTF.finditer(l.text):
            a = int(m.group(1))
            b = int(m.group(2)) if m.group(2) else a
            if 1 <= a <= b <= 60 and b - a < 8:
                portfolio.update(range(a, b + 1))
    text = " ".join(l.text for l in sorted(lines, key=lambda l: (round(l.y0), l.x0)))
    return pts, portfolio, text


def parse_questionnaire(pages, covers):
    livrets = []
    for i, c in enumerate(covers):
        end = covers[i + 1]["page"] - 1 if i + 1 < len(covers) else len(pages)
        # dernière page d'un livret = 4e de couverture (mentions légales) → ignorée si sans question
        lv = {"n": c["n"], "subject": c["subject"], "qpages": [c["page"], end], "questions": [],
              "total": c.get("total")}
        cur = None
        for pno in range(c["page"] + 1, end + 1):
            page = pages[pno - 1]
            low = norm(page.text)
            if "editeur responsable" in low or "mediateur" in low:
                continue
            heads = question_headings(page)
            bounds = [h[0] for h in heads]
            if cur is not None:
                stop = (bounds[0] - 0.01) if bounds else BOTTOM_CUT
                if stop - TOP_MARGIN > 0.06 and region_words(page, TOP_MARGIN, stop):
                    pts, pf, txt = analyse_region(page, TOP_MARGIN, stop)
                    cur["segs"].append({"p": pno, "y0": TOP_MARGIN, "y1": round(stop, 4)})
                    cur["max"] += pts
                    cur["portfolio"] |= pf
                    cur["text"] += " " + txt
            for j, (y, n) in enumerate(heads):
                y0 = max(0.0, y - 0.012)
                y1 = heads[j + 1][0] - 0.012 if j + 1 < len(heads) else BOTTOM_CUT
                pts, pf, txt = analyse_region(page, y0, y1, heading_y=y)
                seg = {"p": pno, "y0": round(y0, 4), "y1": round(y1, 4)}
                prev = next((q for q in lv["questions"] if q["n"] == n), None)
                if prev is not None:  # annexe (gabarit…) d'une question déjà vue
                    prev["segs"].append(seg)
                    prev["portfolio"] |= pf
                    cur = prev
                    continue
                cur = {"n": n, "segs": [seg], "max": pts, "portfolio": pf, "text": txt}
                lv["questions"].append(cur)
        if not lv["questions"]:
            # livret sans questions numérotées (ex. Écrire) : un seul item pleine page
            segs = []
            for pno in range(c["page"] + 1, end + 1):
                low = norm(pages[pno - 1].text)
                if "editeur responsable" in low or "mediateur" in low:
                    continue
                segs.append({"p": pno, "y0": 0, "y1": 1})
            lv["questions"].append({"n": 1, "segs": segs, "max": 0, "portfolio": set(),
                                    "text": "", "whole": True})
        for q in lv["questions"]:
            q["portfolio"] = sorted(q["portfolio"])
            q["text"] = re.sub(r"_{3,}", "____", q["text"])[:600]
        livrets.append(lv)
    return livrets


# ---------------------------------------------------------------- correction
LABEL = re.compile(r"^(\d{1,2})(?:[.\s]?([a-z]))?\)?$")


def label_column(pages, page_list):
    """Abscisse (fraction) de la colonne « Q » du tableau de correction."""
    from collections import Counter
    cnt = Counter()
    for pno in page_list:
        p = pages[pno - 1]
        for w in p.words:
            if w.x0 < p.w * 0.18 and p.h * 0.012 < w.y0 < p.h * 0.93 and LABEL.match(w.t.strip()):
                cnt[round(w.x0 / p.w, 2)] += 1
    common = [x for x, c in cnt.items() if c >= 3]
    return min(common) if common else 0.07


def corr_labels(page, col):
    out = []
    for w in page.words:
        x = w.x0 / page.w
        if not (col - 0.02 <= x <= col + 0.025) or w.y0 > page.h * 0.93 or w.y0 < page.h * 0.012:
            continue
        m = LABEL.match(w.t.strip())
        if m:
            out.append((w.y0 / page.h, int(m.group(1))))
    out.sort()
    return out


def page_kind(page, col):
    """Détecte les annexes de correction rattachées à une question précise."""
    if len(corr_labels(page, col)) >= 2:
        return ("table", None)
    top = norm(" ".join(l.text for l in page.lines if l.y0 < page.h * 0.25))
    m = re.search(r"grille de correction.{0,40}?(?:question|q)\s*(\d{1,2})", top)
    if m:
        return ("annex", int(m.group(1)))
    m = re.search(r"livret\s*\d+\s*question\s*(\d{1,2})", norm(page.text)) or \
        re.search(r"question\s*(\d{1,2})\s*$", top)
    if m and len(page.words) < 60:
        return ("annex", int(m.group(1)))
    if "grille de correction" in top:
        return ("annex", None)
    return ("table", None)


def parse_correction(pages, page_list, rules_of):
    """page_list : pages de la section de correction d'un livret.
    Retourne {num_question: [segments]}, annexes."""
    res, annexes = {}, []
    col = label_column(pages, page_list)
    cur = None
    last_n = 0
    first = True
    for pno in page_list:
        page = pages[pno - 1]
        kind, qn = page_kind(page, col)
        if kind == "annex":
            seg = {"p": pno, "y0": 0, "y1": 1}
            if qn:
                res.setdefault(qn, []).append(seg)
            else:
                annexes.append(pno)
            continue
        rules = [r for r in rules_of(pno) if 0.02 < r < 0.95]
        # garder une séquence croissante, sans saut aberrant
        seq = []
        for y, n in corr_labels(page, col):
            if n < last_n or n > last_n + 6:
                continue
            seq.append((y, n))
            last_n = n
        table_bottom = rules[-1] if rules else BOTTOM_CUT

        def snap(y):
            above = [r for r in rules if r <= y + 0.004]
            return above[-1] if above else max(0.004, y - 0.014)

        starts = []
        for y, n in seq:
            s = snap(y)
            if starts and starts[-1][1] == n:
                continue  # sous-question de la même question (4.a, 4.b…)
            starts.append((s, n))
        if cur is not None and not first:
            stop = starts[0][0] if starts else table_bottom
            top = rules[0] if rules and rules[0] < 0.2 else TOP_MARGIN
            if stop - top > 0.03:
                res.setdefault(cur, []).append({"p": pno, "y0": round(top, 4), "y1": round(stop, 4)})
        for j, (s, n) in enumerate(starts):
            e = starts[j + 1][0] if j + 1 < len(starts) else table_bottom
            if e - s > 0.01:
                res.setdefault(n, []).append({"p": pno, "y0": round(max(0, s - 0.004), 4),
                                              "y1": round(min(1, e + 0.004), 4)})
            cur = n
        first = False
    return res, annexes


def ecouter_text(pdf, pages_range):
    if not pages_range:
        return ""
    a, b = pages_range
    out = subprocess.run(["pdftotext", "-f", str(a), "-l", str(b), pdf, "-"],
                         capture_output=True).stdout.decode("utf-8", "replace")
    keep = []
    for line in out.splitlines():
        s = line.strip()
        if not s or re.fullmatch(r"[\d\s/]+", s) or "____" in s or s.startswith("Support du Savoir"):
            if not s and keep and keep[-1] != "":
                keep.append("")
            continue
        if re.match(r"^(CEB|Consignes de passation|Page \d)", s, re.I):
            continue
        keep.append(s)
    # recolle les lignes en paragraphes
    paras, buf = [], []
    for s in keep:
        if s == "":
            if buf:
                paras.append(" ".join(buf))
                buf = []
        else:
            buf.append(s)
    if buf:
        paras.append(" ".join(buf))
    text = "\n\n".join(p for p in paras if len(p) > 1)
    text = re.sub(r"(\w)- (\w)", r"\1\2", text)
    return text.replace("\f", "")


# ---------------------------------------------------------------- portfolio
def portfolio_numbers(pages):
    """Associe numéro imprimé → page PDF (par défaut identité)."""
    return {p.idx: p.idx for p in pages}


# ---------------------------------------------------------------- principal
def build_year(year, files, cfg, out, workers):
    t0 = time.time()
    ydir = os.path.join(out, "pages", year)
    info = {"id": year, "label": cfg.get("label", f"CEB {year}"), "note": cfg.get("note", ""),
            "files": {k: os.path.basename(v) for k, v in files.items()}, "pages": {}}
    loaded = {}
    for k, pdf in files.items():
        loaded[k] = pdfwords.load(pdf)
        info["pages"][k] = {"count": len(loaded[k]),
                            "ratio": round(loaded[k][0].h / loaded[k][0].w, 4) if loaded[k] else 1.414,
                            "ratios": {str(p.idx): round(p.h / p.w, 4) for p in loaded[k]
                                       if abs(p.h / p.w - loaded[k][0].h / loaded[k][0].w) > 0.01}}
        render(pdf, os.path.join(ydir, k), len(loaded[k]), workers)
    qpages = loaded["q"]
    covers = cfg.get("covers") or find_covers(qpages)
    livrets = parse_questionnaire(qpages, covers)

    # correction
    if "c" in files:
        cpages = loaded["c"]
        sections = cfg.get("correction") or {}
        if not sections:
            sections, how = autodetect.correction_sections(cpages, livrets)
            info["auto"] = True
            log(f"{year}: sections de correction détectées automatiquement ({how}) : "
                + ", ".join(f"{k} p.{v[0][0]}-{v[-1][1]}" for k, v in sections.items()))
        info["sections"] = sections
        rules_cache = {}

        def rules_of(pno):
            if pno not in rules_cache:
                rules_cache[pno] = h_rules(os.path.join(ydir, "c", f"{pno}.jpg"))
            return rules_cache[pno]

        for lv in livrets:
            sec = sections.get(lv["subject"])
            if not sec:
                continue
            plist = []
            for a, b in sec:
                plist.extend(range(a, b + 1))
            lv["cpages"] = plist
            corr, annexes = parse_correction(cpages, plist, rules_of)
            lv["annexes"] = annexes
            for q in lv["questions"]:
                if q.get("whole"):
                    q["corr"] = [{"p": p, "y0": 0, "y1": 1} for p in plist]
                else:
                    q["corr"] = corr.get(q["n"], [])
        etp = cfg.get("ecouter_text_pages") or autodetect.ecouter_pages(cpages, sections)
        if etp:
            info["ecouter_text"] = ecouter_text(files["c"], etp)
    # réponses interactives : cases, zones de saisie, clé de correction des cases
    if os.environ.get("CEB_INTERACTIVE", "1") != "0":
        cp = loaded.get("c")
        todo = [q for lv in livrets for q in lv["questions"] if not q.get("whole")]

        def ia(q):
            try:
                q["ia"] = answers.extract(qpages, cp, q, ydir)
            except Exception as e:  # pragma: no cover
                log(f"{year} Q{q['n']}: extraction interactive impossible ({e!r})")
        with cf.ThreadPoolExecutor(max(1, workers)) as ex:
            list(ex.map(ia, todo))
        nk = sum(1 for q in todo if q.get("ia", {}).get("key"))
        no = sum(1 for q in todo if q.get("ia", {}).get("opts"))
        log(f"{year}: {no} questions à cases, {nk} avec clé de correction automatique")
    for lv in livrets:
        sid = lv["subject"]
        s = subjects.SUBJECT_BY_ID.get(sid)
        lv["label"] = s[1] if s else f"Livret {lv['n']}"
        lv["discipline"] = s[2] if s else "autre"
        lv["max"] = sum(q["max"] for q in lv["questions"])
        if lv["total"] and len(lv["questions"]) == 1 and lv["questions"][0].get("whole"):
            lv["questions"][0]["max"] = lv["max"] = lv["total"]
        lv["points_ok"] = bool(lv["total"]) and lv["max"] == lv["total"]
        lv["minutes"] = cfg.get("minutes", {}).get(sid, DEFAULT_MINUTES.get(sid, 50))
    livrets.sort(key=lambda l: l["n"])
    info["livrets"] = livrets
    nq = sum(len(l["questions"]) for l in livrets)
    nc = sum(1 for l in livrets for q in l["questions"] if q.get("corr"))
    log(f"{year}: {len(livrets)} livrets, {nq} questions, {nc} avec correction ciblée ({time.time()-t0:.0f}s)")
    return info


DEFAULT_MINUTES = {"ecouter": 40, "ecrire": 65, "solides": 65, "grandeurs": 75, "nombres": 75,
                   "nombres1": 40, "nombres2": 50, "histgeo": 75, "sciences": 75,
                   "lire-info": 65, "lire-fict": 65}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=os.environ.get("CEB_PDF_DIR", "/pdf"))
    ap.add_argument("--out", default=os.environ.get("CEB_DATA_DIR", "/data"))
    ap.add_argument("--config", default=os.path.join(HERE, "years.json"))
    ap.add_argument("--force", action="store_true", help="ignore l'empreinte globale (le cache par année reste utilisé)")
    ap.add_argument("--no-cache", action="store_true", help="réanalyse toutes les années")
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 2)))
    a = ap.parse_args()

    years = find_years(a.pdf)
    if not years:
        log(f"Aucun PDF trouvé dans {a.pdf} (attendu : AAAA_CEB_questionnaire.pdf, …)")
        return 2
    local_cfg = os.path.join(a.out, "years.local.json")
    allfiles = [f for v in years.values() for f in v.values()] + [a.config] \
        + [os.path.join(HERE, f) for f in os.listdir(HERE) if f.endswith(".py")] \
        + ([local_cfg] if os.path.exists(local_cfg) else [])
    fp = fingerprint(allfiles)
    os.makedirs(a.out, exist_ok=True)
    cat_path = os.path.join(a.out, "catalog.json")
    if not a.force and os.path.exists(cat_path):
        try:
            if json.load(open(cat_path)).get("fingerprint") == fp:
                log("Catalogue à jour.")
                return 0
        except Exception:
            pass
    cfg = json.load(open(a.config)) if os.path.exists(a.config) else {}
    catalog = {"fingerprint": fp, "built": time.strftime("%Y-%m-%d %H:%M"), "dpi": DPI,
               "disciplines": subjects.DISCIPLINES,
               "subjects": {s[0]: {"label": s[1], "discipline": s[2]} for s in subjects.SUBJECTS},
               "years": []}
    local = os.path.join(a.out, "years.local.json")
    if os.path.exists(local):
        try:
            for k, v in json.load(open(local)).items():
                cfg[k] = {**cfg.get(k, {}), **v}
        except Exception as e:
            log(f"years.local.json ignoré : {e!r}")
    cache_dir = os.path.join(a.out, "cache")
    os.makedirs(cache_dir, exist_ok=True)
    code_fp = fingerprint([os.path.join(HERE, f) for f in os.listdir(HERE) if f.endswith(".py")])
    for y in sorted(years):
        yfp = hashlib.sha1((fingerprint(list(years[y].values())) + code_fp
                            + json.dumps(cfg.get(y, {}), sort_keys=True)).encode()).hexdigest()[:16]
        cpath = os.path.join(cache_dir, f"{y}.json")
        try:
            if not a.no_cache and os.path.exists(cpath):
                c = json.load(open(cpath))
                if c.get("_fp") == yfp:
                    catalog["years"].append(c["year"])
                    log(f"{y}: inchangé (cache)")
                    continue
        except Exception:
            pass
        try:
            info = build_year(y, years[y], cfg.get(y, {}), a.out, a.workers)
            catalog["years"].append(info)
            with open(cpath, "w") as f:
                json.dump({"_fp": yfp, "year": info}, f, ensure_ascii=False, separators=(",", ":"))
        except Exception as e:  # une année défaillante ne bloque pas les autres
            log(f"ERREUR {y}: {e!r}")
            import traceback
            traceback.print_exc()
    tmp = cat_path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, cat_path)
    log("Catalogue écrit :", cat_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
