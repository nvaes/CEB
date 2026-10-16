import sys, re, glob
import pdfwords, subjects
from pdfwords import norm
def covers(pages):
    res = []
    for p in pages:
        for l in p.lines:
            m = re.search(r'livret\s*(\d+)\s*\|', norm(l.text))
            if m:
                # lines between "CEB20xx" and the LIVRET line, or just above
                cand = [x for x in p.lines if l.y0 - 90 < x.y0 < l.y0 and x is not l]
                txt = " ".join(x.text for x in sorted(cand, key=lambda x: x.y0))
                res.append((p.idx, int(m.group(1)), subjects.detect(txt), txt[:80]))
                break
    return res
def corr_sections(pages):
    res = []
    for p in pages:
        ls = sorted(p.lines, key=lambda l: (round(l.y0), l.x0))
        if len(ls) >= 2 and ls[0].text.strip() == 'CEB' and ls[0].y0 < 120:
            res.append((p.idx, subjects.detect(ls[1].text), ls[1].text[:60]))
        else:
            # 'CEB' may be on same line
            for l in ls[:3]:
                if norm(l.text).startswith('ceb ') and 'consignes' not in norm(l.text) and l.y0<120 and len(l.text)<70:
                    res.append((p.idx, subjects.detect(l.text), l.text[:60])); break
    return res
for y in sys.argv[1:]:
    q = glob.glob(f'/mnt/user-data/uploads/CEB/{y}_CEB_[Qq]uestionnaire.pdf')[0]
    c = glob.glob(f'/mnt/user-data/uploads/CEB/{y}_CEB_correction.pdf')[0]
    print("=====", y)
    qp = pdfwords.load(q); print("Q pages", len(qp))
    for r in covers(qp): print("  cover", r)
    cp = pdfwords.load(c)
    for r in corr_sections(cp): print("  corr", r)
