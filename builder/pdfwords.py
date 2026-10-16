"""Lecture des positions de mots produites par `pdftotext -bbox-layout`."""
import re
import subprocess
import html
import unicodedata

_PAGE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', re.S)
_LINE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
_WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', re.S)


def norm(s):
    """minuscules, sans accents, espaces compactés"""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.lower()).strip()


class Word:
    __slots__ = ("x0", "y0", "x1", "y1", "t")

    def __init__(self, x0, y0, x1, y1, t):
        self.x0, self.y0, self.x1, self.y1, self.t = x0, y0, x1, y1, t

    def __repr__(self):
        return f"W({self.t!r} {self.x0:.0f},{self.y0:.0f})"


class Line:
    __slots__ = ("x0", "y0", "x1", "y1", "words")

    def __init__(self, x0, y0, x1, y1, words):
        self.x0, self.y0, self.x1, self.y1, self.words = x0, y0, x1, y1, words

    @property
    def text(self):
        return " ".join(w.t for w in self.words)


class Page:
    def __init__(self, idx, w, h, lines):
        self.idx, self.w, self.h, self.lines = idx, w, h, lines

    @property
    def words(self):
        return [w for l in self.lines for w in l.words]

    @property
    def text(self):
        return "\n".join(l.text for l in sorted(self.lines, key=lambda l: (round(l.y0), l.x0)))


def load(pdf_path):
    """Retourne la liste des pages (index 1-based) avec lignes et mots positionnés."""
    out = subprocess.run(["pdftotext", "-bbox-layout", pdf_path, "-"],
                         capture_output=True, check=True).stdout.decode("utf-8", "replace")
    pages = []
    for i, m in enumerate(_PAGE.finditer(out), 1):
        w, h, body = float(m.group(1)), float(m.group(2)), m.group(3)
        lines = []
        for lm in _LINE.finditer(body):
            words = [Word(float(a), float(b), float(c), float(d), html.unescape(t))
                     for a, b, c, d, t in _WORD.findall(lm.group(5))]
            if words:
                lines.append(Line(float(lm.group(1)), float(lm.group(2)),
                                  float(lm.group(3)), float(lm.group(4)), words))
        pages.append(Page(i, w, h, lines))
    return pages
