/* Réponses interactives sur les pages scannées :
   - cases à cocher détectées dans le PDF (clic = croix) ;
   - lignes de réponse détectées (champ de saisie posé sur la ligne) ;
   - outils libres : croix, texte, crayon (pour les tableaux, schémas, tracés…).
   Les positions sont exprimées en fractions de page (x, y), indépendantes de l'écran. */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IA = { tool: "none", listeners: [] };

  IA.empty = () => ({ b: {}, f: {}, m: [], t: [], s: [] });
  IA.hasContent = (a) => !!a && (Object.values(a.b || {}).some(Boolean) || Object.values(a.f || {}).some((v) => String(v).trim())
    || (a.m || []).length || (a.t || []).some((x) => String(x[3]).trim()) || (a.s || []).length);

  /* --- positionnement relatif à un segment (p, y0, y1) */
  function pos(seg, x, y, w, h) {
    const H = seg.y1 - seg.y0;
    return `left:${(x * 100).toFixed(3)}%;top:${(((y - seg.y0) / H) * 100).toFixed(3)}%;` +
      (w !== undefined ? `width:${(w * 100).toFixed(3)}%;` : "") + (h !== undefined ? `height:${((h / H) * 100).toFixed(3)}%;` : "");
  }
  const inSeg = (seg, p, y) => p === seg.p && y >= seg.y0 - 0.002 && y < seg.y1;

  /* --- contenu d'une couche pour un segment.
     ctx = { questions: [q…], answers: {qid: ans}, reveal: {qid: bool} } */
  IA.layerInner = function (seg, ctx) {
    let html = "";
    for (const q of ctx.questions) {
      const ia = q.ia || {}; const a = ctx.answers[q.qid] || IA.empty(); const rev = ctx.reveal && ctx.reveal[q.qid];
      (ia.opts || []).forEach((o, i) => {
        if (!inSeg(seg, o.p, o.y)) return;
        const on = !!a.b[i];
        let cls = on ? " on" : "";
        if (rev && o.ok !== undefined) cls += o.ok ? (on ? " good" : " missed") : (on ? " bad" : "");
        const pad = 0.006;
        html += `<button type="button" class="ia-box${cls}" data-q="${q.qid}" data-o="${i}" title="${esc(o.t)}" aria-pressed="${on}"
          style="${pos(seg, o.x - pad, o.y - pad, o.w + 2 * pad, o.h + 2 * pad)}">${on ? "✗" : ""}</button>`;
      });
      (ia.fields || []).forEach((f, i) => {
        if (!inSeg(seg, f.p, f.y)) return;
        const h = 0.024;
        html += `<input class="ia-field" data-q="${q.qid}" data-f="${i}" autocomplete="off" spellcheck="false" ${ctx.readonly ? "readonly" : ""}
          value="${esc(a.f[i] || "")}" style="${pos(seg, f.x, f.y - h + 0.002, f.w, h)}">`;
      });
      (a.m || []).forEach((m, i) => { if (inSeg(seg, m[0], m[2])) html += `<span class="ia-mark" data-q="${q.qid}" data-m="${i}" style="${pos(seg, m[1], m[2])}">✗</span>`; });
      (a.t || []).forEach((t, i) => {
        if (!inSeg(seg, t[0], t[2])) return;
        html += `<input class="ia-text" data-q="${q.qid}" data-t="${i}" value="${esc(t[3])}" ${ctx.readonly ? "readonly" : ""} style="${pos(seg, t[1], t[2] - 0.012)}">`;
      });
    }
    return html + `<canvas class="ia-draw"></canvas>`;
  };
  IA.layer = (seg, ctx) => `<div class="ia" data-p="${seg.p}" data-y0="${seg.y0}" data-y1="${seg.y1}">${IA.layerInner(seg, ctx)}</div>`;

  function segOf(el) { return { p: +el.dataset.p, y0: +el.dataset.y0, y1: +el.dataset.y1 }; }
  function qidAt(ctx, p, y) {
    for (const q of ctx.questions) for (const s of q.segs) if (s.p === p && y >= s.y0 && y < s.y1) return q.qid;
    return ctx.questions[0] && ctx.questions[0].qid;
  }
  function ans(ctx, qid) { if (!ctx.answers[qid]) ctx.answers[qid] = IA.empty(); const a = ctx.answers[qid]; a.m = a.m || []; a.t = a.t || []; a.s = a.s || []; return a; }

  function drawCanvas(layer, ctx) {
    const cv = layer.querySelector("canvas.ia-draw"); if (!cv) return;
    const seg = segOf(layer); const r = layer.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
    g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#2547d0"; g.lineWidth = Math.max(2, r.width * 0.0035) * dpr;
    const H = seg.y1 - seg.y0;
    for (const q of ctx.questions) {
      for (const st of (ctx.answers[q.qid] || {}).s || []) {
        if (st[0] !== seg.p) continue;
        const pts = st[1]; g.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const X = pts[i] * cv.width, Y = ((pts[i + 1] - seg.y0) / H) * cv.height;
          if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
        }
        g.stroke();
      }
    }
  }
  function refresh(layer, ctx) {
    const keep = document.activeElement && layer.contains(document.activeElement) ? document.activeElement : null;
    if (keep && keep.tagName === "INPUT") return; // ne pas casser la saisie en cours
    layer.innerHTML = IA.layerInner(segOf(layer), ctx);
    drawCanvas(layer, ctx);
  }

  /* --- interactions. onChange(qid) est appelé après chaque modification. */
  IA.bind = function (root, ctx, onChange) {
    const layers = Array.from(root.querySelectorAll(".ia"));
    layers.forEach((l) => drawCanvas(l, ctx));
    const ro = new ResizeObserver(() => layers.forEach((l) => drawCanvas(l, ctx)));
    layers.forEach((l) => ro.observe(l));
    let drawing = null;
    const point = (layer, e) => {
      const r = layer.getBoundingClientRect(); const seg = segOf(layer);
      const x = (e.clientX - r.left) / r.width, y = seg.y0 + ((e.clientY - r.top) / r.height) * (seg.y1 - seg.y0);
      return { p: seg.p, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
    };
    root.addEventListener("pointerdown", (e) => {
      const layer = e.target.closest(".ia"); if (!layer || ctx.readonly) return;
      const box = e.target.closest(".ia-box");
      if (box) {
        e.preventDefault();
        const a = ans(ctx, box.dataset.q); const i = box.dataset.o; a.b[i] = !a.b[i];
        refresh(layer, ctx); onChange(box.dataset.q); return;
      }
      if (e.target.closest("input")) return;
      const mark = e.target.closest(".ia-mark");
      if (mark && (IA.tool === "x" || IA.tool === "erase")) {
        ans(ctx, mark.dataset.q).m.splice(+mark.dataset.m, 1); refresh(layer, ctx); onChange(mark.dataset.q); return;
      }
      const pt = point(layer, e); const qid = qidAt(ctx, pt.p, pt.y);
      if (IA.tool === "x") { ans(ctx, qid).m.push([pt.p, pt.x, pt.y]); refresh(layer, ctx); onChange(qid); }
      else if (IA.tool === "text") {
        const a = ans(ctx, qid); a.t.push([pt.p, pt.x, pt.y, ""]); refresh(layer, ctx);
        const inp = layer.querySelector(`.ia-text[data-q="${qid}"][data-t="${a.t.length - 1}"]`); setTimeout(() => inp && inp.focus(), 10);
      } else if (IA.tool === "pen") {
        e.preventDefault(); layer.setPointerCapture(e.pointerId);
        drawing = { layer, qid, st: [pt.p, [pt.x, pt.y]] }; ans(ctx, qid).s.push(drawing.st);
      } else if (IA.tool === "erase") {
        // efface le trait le plus proche
        const a = ans(ctx, qid); let best = -1, bd = 0.02;
        a.s.forEach((st, i) => { if (st[0] !== pt.p) return; for (let k = 0; k < st[1].length; k += 2) { const d = Math.hypot(st[1][k] - pt.x, (st[1][k + 1] - pt.y) / 1.414); if (d < bd) { bd = d; best = i; } } });
        if (best >= 0) { a.s.splice(best, 1); drawCanvas(layer, ctx); onChange(qid); }
        a.t = a.t.filter((t) => !(t[0] === pt.p && Math.hypot(t[1] - pt.x, t[2] - pt.y) < 0.02 && !String(t[3]).trim()));
      }
    });
    root.addEventListener("pointermove", (e) => {
      if (!drawing) return; const pt = point(drawing.layer, e); const a = drawing.st[1];
      const lx = a[a.length - 2], ly = a[a.length - 1];
      if (Math.hypot(pt.x - lx, pt.y - ly) < 0.002) return;
      a.push(pt.x, pt.y); drawCanvas(drawing.layer, ctx);
    });
    const end = () => { if (drawing) { const q = drawing.qid; drawing = null; onChange(q); } };
    root.addEventListener("pointerup", end); root.addEventListener("pointercancel", end);
    root.addEventListener("input", (e) => {
      const el = e.target;
      if (el.classList.contains("ia-field")) { ans(ctx, el.dataset.q).f[el.dataset.f] = el.value; onChange(el.dataset.q); }
      if (el.classList.contains("ia-text")) { const t = ans(ctx, el.dataset.q).t[+el.dataset.t]; if (t) { t[3] = el.value; onChange(el.dataset.q); } }
    });
    return () => ro.disconnect();
  };

  /* --- barre d'outils */
  IA.toolbarHTML = () => `<div class="ia-tools no-print" role="toolbar" aria-label="Outils de réponse">
      <span class="tiny">Répondre :</span>
      ${[["none", "👆", "Cocher / écrire"], ["x", "✗", "Croix"], ["text", "Aa", "Texte"], ["pen", "✏️", "Crayon"], ["erase", "🧽", "Gomme"]]
        .map(([k, i, l]) => `<button type="button" class="btn sm ${IA.tool === k ? "primary" : ""}" data-tool="${k}" title="${l}">${i}<span class="lbl"> ${l}</span></button>`).join("")}
    </div>`;
  IA.bindToolbar = (root) => {
    root.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => {
      IA.tool = b.dataset.tool;
      root.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("primary", x === b));
      root.querySelectorAll(".ia").forEach((l) => l.dataset.tool = IA.tool);
    }));
    root.querySelectorAll(".ia").forEach((l) => l.dataset.tool = IA.tool);
  };

  /* --- correction automatique des cases.
     Retourne { pts, max, full, groups:[{n, pts, auto}], detail } */
  IA.evaluate = function (q, a) {
    const ia = q.ia || {}; const opts = ia.opts || []; a = a || IA.empty();
    const marks = ia.marks && ia.marks.length ? ia.marks : [{ n: q.max || 1 }];
    const res = { pts: 0, max: 0, full: false, groups: [], checkedAny: false };
    if (!opts.length || !ia.key) return res;
    const fieldsGroups = new Set((ia.fields || []).map((f) => groupOf(marks, f.p, f.y)));
    marks.forEach((m, g) => {
      const os = opts.map((o, i) => ({ ...o, i })).filter((o) => o.g === g);
      if (!os.length || os.some((o) => o.ok === undefined) || fieldsGroups.has(g)) { res.groups.push({ n: m.n, auto: false }); return; }
      const rows = [];
      for (const o of os) { const r = rows.find((r) => r.p === o.p && Math.abs(r.y - o.y) < 0.006); if (r) r.o.push(o); else rows.push({ p: o.p, y: o.y, o: [o] }); }
      const right = (list) => list.every((o) => !!a.b[o.i] === !!o.ok);
      let pts;
      if (rows.length === m.n && rows.length > 1 && rows.every((r) => r.o.length >= 2)) pts = rows.filter((r) => right(r.o)).length;
      else pts = right(os) ? m.n : 0;
      res.groups.push({ n: m.n, pts, auto: true }); res.pts += pts; res.max += m.n;
    });
    res.checkedAny = Object.values(a.b).some(Boolean);
    res.full = res.max > 0 && res.max >= (q.max || 0);
    return res;
  };
  function groupOf(marks, p, y) { let g = 0; marks.forEach((m, i) => { if (m.p !== undefined && (m.p < p || (m.p === p && m.y <= y + 0.002))) g = i; }); return g; }

  window.IA = IA;
})();
