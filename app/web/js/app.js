/* Révision CEB — application monopage (sans dépendance) */
(function () {
  "use strict";

  /* ================================================================ outils */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : 0);
  const fmtN = (n) => (Math.round(n * 10) / 10).toString().replace(".", ",");
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const DAY = 86400;
  const now = () => Date.now() / 1000;
  const dayKey = (ts) => { const d = new Date(ts * 1000); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, "0")}`; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem("ceb:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ceb:" + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  function toast(msg, ms = 2200) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  async function api(path, opts = {}) {
    const res = await fetch("/api/" + path, {
      method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  }
  const app = () => $("#app");
  function render(html, wide = false) { const m = app(); m.className = wide ? "wide" : ""; m.innerHTML = html; window.scrollTo(0, 0); }

  /* ================================================================ état */
  const S = {
    catalog: null, Q: {}, years: [], profiles: [], profile: null,
    state: { attempts: [], exams: [], drills: [], notes: [] }, last: {}, session: null, timers: [],
  };
  const DISC = { francais: { label: "Français", css: "fr", color: "var(--fr)" }, math: { label: "Mathématiques", css: "math", color: "var(--math)" }, eveil: { label: "Éveil", css: "eveil", color: "var(--eveil)" } };
  const SUBJECT_ICON = { ecouter: "🎧", ecrire: "✏️", "lire-info": "📰", "lire-fict": "📖", solides: "📐", grandeurs: "⚖️", nombres: "🔢", nombres1: "🔢", nombres2: "🔢", histgeo: "🗺️", sciences: "🔬" };
  const GROUPS = [
    { id: "ecouter", label: "Écouter", disc: "francais" }, { id: "lire-info", label: "Lire (informatif)", disc: "francais" },
    { id: "lire-fict", label: "Lire (fictionnel)", disc: "francais" }, { id: "ecrire", label: "Écrire", disc: "francais" },
    { id: "nombres", label: "Nombres et opérations", disc: "math" }, { id: "grandeurs", label: "Grandeurs", disc: "math" },
    { id: "solides", label: "Solides et figures", disc: "math" }, { id: "histgeo", label: "Histoire-géographie", disc: "eveil" },
    { id: "sciences", label: "Sciences", disc: "eveil" },
  ];
  const groupOf = (sid) => (String(sid).startsWith("nombres") ? "nombres" : sid);

  function indexCatalog(cat) {
    S.catalog = cat; S.Q = {}; S.years = cat.years;
    for (const y of cat.years) {
      for (const lv of y.livrets) {
        lv.year = y.id;
        for (const q of lv.questions) {
          q.qid = `${y.id}-${lv.n}-${q.n}`; q.year = y.id; q.livret = lv; S.Q[q.qid] = q;
        }
      }
    }
  }
  const yearOf = (id) => S.years.find((y) => y.id === id);
  const livretOf = (y, n) => (yearOf(y) || { livrets: [] }).livrets.find((l) => l.n === +n);
  const qmax = (q) => (q.max > 0 ? q.max : 1);

  function derive() {
    S.last = {}; S.hist = {};
    for (const a of S.state.attempts) {
      S.last[a.qid] = a;
      (S.hist[a.qid] = S.hist[a.qid] || []).push(a);
    }
    S.flags = {};
    for (const n of S.state.notes) if (n.flag) S.flags[n.qid] = true;
  }
  function status(qid) {
    const a = S.last[qid]; if (!a) return "";
    const r = a.max > 0 ? a.score / a.max : 0;
    return r >= 0.999 ? "ok" : r > 0 ? "mid" : "ko";
  }
  function reviewList() {
    const out = [];
    const t = now();
    for (const qid in S.hist) {
      if (!S.Q[qid]) continue;
      const h = S.hist[qid];
      let box = 0, failed = false;
      for (const a of h) { if (a.max > 0 && a.score / a.max >= 0.999) box++; else { box = 0; failed = true; } }
      const last = h[h.length - 1];
      const waits = [0, 2, 5, 12];
      let due = false, reason = "";
      if (box === 0) { due = true; reason = "à retravailler"; }
      else if (failed && box < 4 && t >= last.ts + waits[box] * DAY) { due = true; reason = "à consolider"; }
      if (S.flags[qid]) { due = true; reason = reason || "marquée"; }
      if (due) out.push({ qid, reason, ts: last.ts, box });
    }
    for (const qid in S.flags) if (!S.hist[qid] && S.Q[qid]) out.push({ qid, reason: "marquée", ts: 0, box: 0 });
    return out.sort((a, b) => a.box - b.box || a.ts - b.ts);
  }
  function stats(filterFn) {
    let done = 0, total = 0, got = 0, max = 0;
    for (const qid in S.Q) {
      const q = S.Q[qid]; if (filterFn && !filterFn(q)) continue;
      total++;
      const a = S.last[qid];
      if (a) { done++; got += a.score; max += a.max; }
    }
    return { done, total, got, max, mastery: pct(got, max), coverage: pct(done, total) };
  }
  function streak() {
    const days = new Set([...S.state.attempts, ...S.state.drills].map((a) => dayKey(a.ts)));
    let n = 0; let t = now();
    if (!days.has(dayKey(t))) t -= DAY;
    while (days.has(dayKey(t))) { n++; t -= DAY; }
    return n;
  }

  /* ================================================================ profils */
  async function loadProfiles() { S.profiles = await api("profiles"); }
  async function selectProfile(id) {
    const p = S.profiles.find((x) => x.id === id);
    if (!p) return;
    S.profile = p; store.set("profile", id);
    S.state = await api(`profiles/${id}/state`); S.ans = S.state.answers || {}; derive(); paintWho();
  }
  async function refreshState() { if (S.profile) { S.state = await api(`profiles/${S.profile.id}/state`); S.ans = S.state.answers || {}; derive(); } }
  const saveTimers = {};
  function saveAnswer(qid) {
    clearTimeout(saveTimers[qid]);
    saveTimers[qid] = setTimeout(() => {
      if (!S.profile) return;
      api(`profiles/${S.profile.id}/answers`, { method: "PUT", body: { qid, data: S.ans[qid] || {} } }).catch(() => toast("Réponse non enregistrée (serveur injoignable)"));
    }, 700);
  }
  function paintWho() {
    const w = $("#who");
    w.innerHTML = S.profile ? `<span class="avatar" style="background:${esc(S.profile.color)}33">${esc(S.profile.avatar)}</span><span class="name">${esc(S.profile.name)}</span>`
      : `<span class="avatar">🙂</span><span class="name">Choisir</span>`;
  }
  async function saveAttempt(q, score, mode, seconds) {
    if (!S.profile) return;
    const item = { qid: q.qid, score, max: qmax(q), mode, seconds: Math.round(seconds || 0) };
    try {
      await api(`profiles/${S.profile.id}/attempts`, { method: "POST", body: item });
      S.state.attempts.push({ ...item, ts: now() }); derive();
    } catch (e) { toast("Enregistrement impossible : " + e.message); }
  }
  async function toggleFlag(qid) {
    const on = !S.flags[qid];
    await api(`profiles/${S.profile.id}/notes`, { method: "PUT", body: { qid, flag: on } });
    S.state.notes = S.state.notes.filter((n) => n.qid !== qid).concat([{ qid, flag: on ? 1 : 0 }]); derive();
    return on;
  }

  /* ================================================================ rendu images */
  function pageRatio(year, kind, p) {
    const info = (yearOf(year).pages || {})[kind] || {};
    return (info.ratios && info.ratios[String(p)]) || info.ratio || 1.414;
  }
  const pageUrl = (year, kind, p) => `/pages/${year}/${kind}/${p}.jpg`;
  function segHTML(year, kind, s) {
    const h = Math.max(0.02, s.y1 - s.y0), r = pageRatio(year, kind, s.p);
    return `<div class="seg" data-zoom="${pageUrl(year, kind, s.p)}" style="aspect-ratio:1/${(r * h).toFixed(4)}">
      <img loading="lazy" alt="" src="${pageUrl(year, kind, s.p)}" style="top:${(-(s.y0 / h) * 100).toFixed(3)}%"></div>`;
  }
  const fullPage = (year, kind, p) => segHTML(year, kind, { p, y0: 0, y1: 1 });
  function segIA(year, s, ctx) {
    const h = Math.max(0.02, s.y1 - s.y0), r = pageRatio(year, "q", s.p);
    return `<div class="seg segia" style="aspect-ratio:1/${(r * h).toFixed(4)}">
      <img loading="lazy" alt="" src="${pageUrl(year, "q", s.p)}" style="top:${(-(s.y0 / h) * 100).toFixed(3)}%">${IA.layer(s, ctx)}</div>`;
  }
  function bindZoom(root = document) {
    $$(".seg[data-zoom]", root).forEach((el) => el.addEventListener("click", () => openLightbox([el.dataset.zoom], 0)));
  }
  function openLightbox(urls, idx) {
    const lb = document.createElement("div");
    lb.className = "lightbox";
    const draw = () => {
      lb.innerHTML = `<div class="lb-bar"><span class="small" style="margin-right:auto;opacity:.8">${urls.length > 1 ? `Page ${idx + 1} / ${urls.length}` : ""}</span>
        ${urls.length > 1 ? `<button class="btn sm" data-a="prev">◀</button><button class="btn sm" data-a="next">▶</button>` : ""}
        <button class="btn sm" data-a="zoom">🔍 Zoom</button><button class="btn sm" data-a="close">✕ Fermer</button></div>
        <div class="lb-body"><img src="${urls[idx]}" alt=""></div>`;
    };
    draw();
    lb.addEventListener("click", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close" || e.target.classList.contains("lb-body")) { lb.remove(); document.removeEventListener("keydown", key); }
      if (a === "zoom") lb.classList.toggle("zoom");
      if (a === "prev" && idx > 0) { idx--; draw(); }
      if (a === "next" && idx < urls.length - 1) { idx++; draw(); }
    });
    const key = (e) => { if (e.key === "Escape") { lb.remove(); document.removeEventListener("keydown", key); } };
    document.addEventListener("keydown", key);
    document.body.appendChild(lb);
  }

  /* ================================================================ écoute (synthèse vocale) */
  function ecouterParts(year) {
    const raw = (yearOf(year).ecouter_text || "").replace(/¡/g, "").replace(/\bFaire cocher OUI ou NON\.?/g, "").replace(/Reprendre les questionnaires\.?/g, "");
    const paras = raw.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const cut = paras.findIndex((p) => /^(Résumés? à lire|Extrait à lire|Lire le premier résumé|Lire le résumé)/i.test(p));
    return cut > 0 ? { main: paras.slice(0, cut), extra: paras.slice(cut) } : { main: paras, extra: [] };
  }
  function ttsHTML(year, compact) {
    const { main, extra } = ecouterParts(year);
    if (!main.length) return `<div class="notice">Le texte lu pour cette épreuve n'a pas été trouvé dans la correction. Un adulte peut le lire depuis le PDF de correction.</div>`;
    return `<div class="card tts" data-year="${year}">
      <div class="spread"><h3 style="margin:0">🎧 Écoute le texte</h3><span class="tiny">Voix de synthèse de l'appareil</span></div>
      <p class="small muted" style="margin:0">Au CEB, le texte est lu deux fois par l'enseignant. Écoute sans prendre de notes, puis réponds aux questions.</p>
      <div class="toolbar">
        <button class="btn primary" data-tts="play">▶ Écouter</button>
        <button class="btn" data-tts="pause">⏸ Pause</button>
        <button class="btn" data-tts="stop">⏹ Stop</button>
        <label class="small row" style="gap:6px">Vitesse <select data-tts="rate"><option value="0.8">lente</option><option value="0.92" selected>normale</option><option value="1.05">rapide</option></select></label>
        <label class="small row" style="gap:6px"><input type="checkbox" data-tts="show" ${compact ? "" : ""}> Afficher le texte (adulte)</label>
      </div>
      <div class="text hidden">${main.map((p, i) => `<p data-i="${i}">${esc(p)}</p>`).join("")}</div>
      ${extra.length ? `<details><summary class="small"><b>Pour la dernière question</b> (résumés / extrait lus à la fin)</summary>
        <div class="toolbar" style="margin-top:8px"><button class="btn sm" data-tts="extra">▶ Lire les résumés</button></div>
        <div class="text" style="margin-top:8px">${extra.map((p) => `<p>${esc(p)}</p>`).join("")}</div></details>` : ""}
    </div>`;
  }
  function bindTTS(root) {
    const box = $(".tts", root); if (!box) return;
    const synth = window.speechSynthesis;
    if (!synth) { $$("[data-tts=play],[data-tts=pause],[data-tts=stop],[data-tts=extra]", box).forEach((b) => (b.disabled = true)); return; }
    const { main, extra } = ecouterParts(box.dataset.year);
    const voice = () => { const v = synth.getVoices(); return v.find((x) => /fr[-_]BE/i.test(x.lang)) || v.find((x) => /fr[-_]FR/i.test(x.lang) && /Google|Amélie|Thomas|Audrey|Marie/i.test(x.name)) || v.find((x) => /^fr/i.test(x.lang)); };
    const speak = (list, mark) => {
      synth.cancel();
      const rate = +$("[data-tts=rate]", box).value;
      list.forEach((txt, i) => {
        const u = new SpeechSynthesisUtterance(txt); u.lang = "fr-BE"; u.rate = rate; const v = voice(); if (v) u.voice = v;
        if (mark) {
          u.onstart = () => { $$(".text p", box).forEach((p) => p.classList.toggle("speaking", +p.dataset.i === i)); };
          u.onend = () => { if (i === list.length - 1) $$(".text p", box).forEach((p) => p.classList.remove("speaking")); };
        }
        synth.speak(u);
      });
    };
    box.addEventListener("click", (e) => {
      const a = e.target.closest("[data-tts]")?.dataset.tts;
      if (a === "play") { if (synth.paused) synth.resume(); else speak(main, true); }
      if (a === "pause") synth.pause();
      if (a === "stop") synth.cancel();
      if (a === "extra") speak(extra, false);
    });
    $("[data-tts=show]", box).addEventListener("change", (e) => $(".text", box).classList.toggle("hidden", !e.target.checked));
    window.addEventListener("hashchange", () => synth.cancel(), { once: true });
  }

  /* ================================================================ vues : accueil */
  function viewHome() {
    if (!S.profile) return viewProfiles();
    const all = stats();
    const rev = reviewList();
    const st = streak();
    const recentDrills = S.state.drills.slice(-1)[0];
    const discCards = Object.entries(DISC).map(([id, d]) => {
      const s = stats((q) => q.livret.discipline === id);
      return `<div class="card row" style="gap:16px">
        <div class="ring" style="--p:${s.mastery};--c:${d.color}"><span>${s.max ? s.mastery + "%" : "–"}</span></div>
        <div><b style="font-family:var(--font-round);font-size:1.1rem">${d.label}</b>
          <div class="small muted">${s.done} / ${s.total} questions faites</div>
          <div class="bar" style="margin-top:6px;width:150px"><i class="ok" style="width:${s.coverage}%"></i></div></div></div>`;
    }).join("");
    render(`
      <div class="hero"><div class="avatar big" style="background:${esc(S.profile.color)}33">${esc(S.profile.avatar)}</div>
        <div><h1 style="margin:0">Bonjour ${esc(S.profile.name)} !</h1>
        <p class="muted">${st > 1 ? `🔥 ${st} jours d'affilée — continue comme ça !` : all.done ? "Prêt·e pour une nouvelle séance ?" : "Bienvenue ! Commence par une petite série de questions."}</p></div></div>
      <div class="grid g4" style="margin-top:18px">
        <button class="card tile" data-go="daily"><span class="ico">☀️</span><b>Défi du jour</b><span class="small muted">5 questions variées, jamais faites</span></button>
        <a class="card tile" href="#/revoir"><span class="ico">🔁</span><b>À revoir</b><span class="small muted">${rev.length ? `${rev.length} question${rev.length > 1 ? "s" : ""} en attente` : "Rien en attente 🎉"}</span></a>
        <a class="card tile" href="#/entrainement"><span class="ico">🎯</span><b>S'entraîner</b><span class="small muted">Par matière, toutes années</span></a>
        <a class="card tile" href="#/examen"><span class="ico">⏱️</span><b>Examen blanc</b><span class="small muted">Un livret complet, chronométré</span></a>
        <a class="card tile" href="#/exercices"><span class="ico">⚡</span><b>Exercices rapides</b><span class="small muted">${recentDrills ? `Dernier : ${recentDrills.correct}/${recentDrills.total}` : "Calcul, conversions, conjugaison…"}</span></a>
        <a class="card tile" href="#/epreuves"><span class="ico">📚</span><b>Toutes les épreuves</b><span class="small muted">${S.years.length} années · ${Object.keys(S.Q).length} questions</span></a>
      </div>
      <div class="section-title"><h2>Ma progression</h2><a href="#/progres" class="small">Détails →</a></div>
      <div class="grid g3">${discCards}</div>
      <p class="tiny" style="margin-top:22px">Le pourcentage indique les points obtenus sur les questions déjà faites (dernier essai). La barre montre la part des questions déjà travaillées.</p>
    `);
    $("[data-go=daily]").addEventListener("click", () => {
      const pool = shuffle(Object.values(S.Q).filter((q) => !S.last[q.qid] && !q.whole && q.livret.subject !== "ecouter"));
      const picked = [], seen = new Set();
      for (const q of pool) { const g = groupOf(q.livret.subject); if (seen.has(g)) continue; seen.add(g); picked.push(q.qid); if (picked.length === 5) break; }
      startSession({ title: "Défi du jour", items: picked, mode: "practice", back: "#/" });
    });
  }

  /* ================================================================ profils */
  const AVATARS = ["🦊", "🐼", "🐯", "🦁", "🐸", "🐙", "🦄", "🐧", "🐨", "🐵", "🐶", "🐱", "🦖", "🚀", "⚽", "🎸"];
  const COLORS = ["#4f6df5", "#e0583a", "#2f9e5b", "#e7a23a", "#9b59b6", "#16a2b8", "#d63384"];
  function viewProfiles() {
    render(`<h1>Qui révise aujourd'hui ?</h1><p class="muted">Chaque enfant a sa propre progression.</p>
      <div class="profiles" style="margin-top:18px">
        ${S.profiles.map((p) => `<button class="profile-card" data-id="${p.id}"><span class="avatar big" style="background:${esc(p.color)}33">${esc(p.avatar)}</span>${esc(p.name)}</button>`).join("")}
        <button class="profile-card" data-new="1" style="border-style:dashed"><span class="avatar big">＋</span>Ajouter</button>
      </div>
      <p class="tiny" style="margin-top:28px"><a href="#/parent">Espace parent</a></p>`);
    $$("[data-id]").forEach((b) => b.addEventListener("click", async () => { await selectProfile(+b.dataset.id); location.hash = "#/"; route(); }));
    $("[data-new]").addEventListener("click", () => editProfile());
  }
  function editProfile(p) {
    let avatar = p?.avatar || AVATARS[S.profiles.length % AVATARS.length], color = p?.color || COLORS[S.profiles.length % COLORS.length];
    const bg = document.createElement("div"); bg.className = "modal-bg";
    bg.innerHTML = `<div class="card modal stack"><h2>${p ? "Modifier le profil" : "Nouveau profil"}</h2>
      <label class="stack"><span class="small muted">Prénom</span><input type="text" id="pname" maxlength="40" value="${esc(p?.name || "")}" autofocus></label>
      <div><div class="small muted" style="margin-bottom:6px">Avatar</div><div class="emoji-pick">${AVATARS.map((a) => `<button data-av="${a}" class="${a === avatar ? "on" : ""}">${a}</button>`).join("")}</div></div>
      <div><div class="small muted" style="margin-bottom:6px">Couleur</div><div class="emoji-pick">${COLORS.map((c) => `<button data-col="${c}" class="${c === color ? "on" : ""}" style="background:${c}"></button>`).join("")}</div></div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-x>Annuler</button><button class="btn primary" data-ok>Enregistrer</button></div></div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click", async (e) => {
      const t = e.target;
      if (t === bg || t.closest("[data-x]")) bg.remove();
      if (t.dataset.av) { avatar = t.dataset.av; $$("[data-av]", bg).forEach((b) => b.classList.toggle("on", b === t)); }
      if (t.dataset.col) { color = t.dataset.col; $$("[data-col]", bg).forEach((b) => b.classList.toggle("on", b === t)); }
      if (t.closest("[data-ok]")) {
        const name = $("#pname", bg).value.trim(); if (!name) return $("#pname", bg).focus();
        const res = p ? await api(`profiles/${p.id}`, { method: "PUT", body: { name, avatar, color } }) : await api("profiles", { method: "POST", body: { name, avatar, color } });
        bg.remove(); await loadProfiles();
        if (!p || S.profile?.id === p.id) await selectProfile(res.id);
        route();
      }
    });
    setTimeout(() => $("#pname", bg)?.focus(), 30);
  }

  /* ================================================================ épreuves */
  function livretCard(lv) {
    const qs = lv.questions; const done = qs.filter((q) => S.last[q.qid]).length;
    const ok = qs.filter((q) => status(q.qid) === "ok").length, mid = qs.filter((q) => status(q.qid) === "mid").length, ko = qs.filter((q) => status(q.qid) === "ko").length;
    const n = qs.length;
    return `<a class="card tile livret bd-${lv.discipline}" href="#/livret/${lv.year}/${lv.n}" style="padding:14px">
      <div class="top"><span class="n bg-${lv.discipline}">${lv.n}</span><b style="font-size:1rem">${SUBJECT_ICON[lv.subject] || ""} ${esc(lv.label)}</b></div>
      <div class="small muted">${lv.questions[0].whole ? "Production d'écrit" : `${n} questions`} · /${lv.total || lv.max} pts · ${lv.minutes} min</div>
      <div class="bar"><i class="ok" style="width:${pct(ok, n)}%"></i><i class="mid" style="width:${pct(mid, n)}%"></i><i class="ko" style="width:${pct(ko, n)}%"></i></div>
      <div class="tiny">${done ? `${done}/${n} faites` : "Pas encore commencé"}</div></a>`;
  }
  function viewEpreuves() {
    const sel = store.get("yearsel", S.years[S.years.length - 1]?.id);
    const y = yearOf(sel) || S.years[S.years.length - 1];
    render(`<div class="spread"><h1>Épreuves officielles</h1>
        <div class="seg-ctl" id="ysel">${S.years.map((x) => `<button data-y="${x.id}" class="${x.id === y.id ? "on" : ""}">${esc(x.label)}</button>`).join("")}</div></div>
      ${y.note ? `<div class="notice info" style="margin:8px 0 14px">${esc(y.note)}</div>` : ""}
      ${Object.entries(DISC).map(([d, info]) => {
        const lvs = y.livrets.filter((l) => l.discipline === d);
        if (!lvs.length) return "";
        return `<div class="section-title"><h2><span class="chip ${info.css}">${info.label}</span></h2></div><div class="grid g3">${lvs.map(livretCard).join("")}</div>`;
      }).join("")}
      <div class="section-title"><h2>Documents d'origine</h2></div>
      <div class="row">${Object.entries(y.files).map(([k, f]) => `<a class="btn sm" href="/pdf/${encodeURIComponent(f)}" target="_blank" rel="noopener">📄 ${{ q: "Questionnaires", c: "Correction", p: "Portfolio" }[k]} (PDF)</a>`).join("")}
        <a class="btn sm" href="#/portfolio/${y.id}">🖼️ Feuilleter le portfolio</a></div>`);
    $$("#ysel button").forEach((b) => b.addEventListener("click", () => { store.set("yearsel", b.dataset.y); viewEpreuves(); }));
  }
  function viewLivret(year, n) {
    const lv = livretOf(year, n); if (!lv) return notFound();
    const y = yearOf(year);
    const isWhole = lv.questions[0].whole;
    render(`<a href="#/epreuves" class="small">← ${esc(y.label)}</a>
      <div class="spread" style="margin-top:6px"><h1 style="margin:0">${SUBJECT_ICON[lv.subject] || ""} Livret ${lv.n} — ${esc(lv.label)}</h1>
        <span class="chip ${DISC[lv.discipline]?.css}">${DISC[lv.discipline]?.label}</span></div>
      <p class="muted">${esc(y.label)} · ${isWhole ? "production d'écrit" : `${lv.questions.length} questions`} · ${lv.total || lv.max} points · durée officielle ${lv.minutes} min</p>
      <div class="toolbar" style="margin:14px 0 18px">
        <button class="btn primary big" data-a="practice">▶ ${isWhole ? "Ouvrir le livret" : "Réviser les questions"}</button>
        <a class="btn big" href="#/examen/${year}/${lv.n}">⏱️ Examen blanc</a>
        ${!isWhole ? `<button class="btn" data-a="todo">Seulement celles pas encore réussies</button>` : ""}
        <button class="btn" data-a="pages">📄 Pages du livret</button>
        ${lv.cpages ? `<button class="btn" data-a="corr">✅ Correction complète</button>` : ""}
      </div>
      ${lv.subject === "ecouter" ? ttsHTML(year) : ""}
      ${isWhole ? `<div class="notice info" style="margin-top:14px">Pour l'écrit, l'enfant rédige sur papier. Utilise ensuite la grille de correction pour évaluer avec lui chaque critère.</div>` : `
      <div class="section-title"><h2>Questions</h2><span class="tiny">vert = réussie · orange = en partie · rouge = ratée</span></div>
      <div class="dots">${lv.questions.map((q) => `<a class="dot ${status(q.qid)}" href="#/q/${q.qid}" title="Question ${q.n} — ${q.max} pt">${q.n}</a>`).join("")}</div>`}
    `);
    bindTTS(app());
    const qids = lv.questions.map((q) => q.qid);
    $("[data-a=practice]").addEventListener("click", () => startSession({ title: `${y.label} · ${lv.label}`, items: qids, mode: "practice", back: `#/livret/${year}/${n}` }));
    $("[data-a=todo]")?.addEventListener("click", () => {
      const items = qids.filter((id) => status(id) !== "ok");
      if (!items.length) return toast("Tout est réussi dans ce livret 🎉");
      startSession({ title: `${lv.label} — à retravailler`, items, mode: "practice", back: `#/livret/${year}/${n}` });
    });
    $("[data-a=pages]").addEventListener("click", () => openLightbox(range(lv.qpages[0], lv.qpages[1]).map((p) => pageUrl(year, "q", p)), 0));
    $("[data-a=corr]")?.addEventListener("click", () => openLightbox(lv.cpages.map((p) => pageUrl(year, "c", p)), 0));
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  function viewPortfolio(year) {
    const y = yearOf(year); if (!y || !y.pages.p) return notFound();
    render(`<a href="#/epreuves" class="small">← Épreuves</a><h1>Portfolio ${esc(y.label)}</h1>
      <p class="muted">Le portfolio contient les documents (textes, cartes, images) utilisés pendant les épreuves.</p>
      <div class="grid g4">${range(1, y.pages.p.count).map((p) => `<div class="card" style="padding:8px"><div class="sheet">${fullPage(year, "p", p)}</div><div class="tiny" style="text-align:center;margin-top:4px">page ${p}</div></div>`).join("")}</div>`, true);
    const urls = range(1, y.pages.p.count).map((p) => pageUrl(year, "p", p));
    $$(".seg").forEach((el, i) => el.addEventListener("click", () => openLightbox(urls, i)));
  }

  /* ================================================================ session de questions */
  function startSession(opts) {
    if (!opts.items || !opts.items.length) return toast("Aucune question à proposer avec ces critères.");
    S.session = { i: 0, scores: {}, revealed: {}, t0: now(), qt: now(), ...opts };
    if (location.hash === "#/session") viewSession(); else location.hash = "#/session";
  }
  function directQuestion(qid) {
    const q = S.Q[qid]; if (!q) return notFound();
    const items = q.livret.questions.map((x) => x.qid);
    S.session = { i: items.indexOf(qid), scores: {}, revealed: {}, t0: now(), qt: now(), title: `${yearOf(q.year).label} · ${q.livret.label}`, items, mode: "practice", back: `#/livret/${q.year}/${q.livret.n}`, browse: true };
    viewSession();
  }
  function scoreControls(q, cur) {
    const m = qmax(q);
    if (m <= 8) {
      return `<div class="score-btns">${range(0, m).map((v) => `<button data-score="${v}" class="${cur === v ? "on" : ""} ${v === m ? "full" : ""}">${v}</button>`).join("")}</div>`;
    }
    return `<div class="row"><div class="stepper"><button class="btn" data-step="-1">−</button><input type="number" min="0" max="${m}" step="1" value="${cur ?? ""}" placeholder="?" id="scoreInput"><button class="btn" data-step="1">+</button></div>
      <span class="muted">/ ${m}</span><button class="btn" data-score="${m}">Tout juste</button><button class="btn" data-score="0">Rien</button><button class="btn primary" data-score-input>Valider</button></div>`;
  }
  function viewSession() {
    const s = S.session; if (!s) { location.hash = "#/"; return; }
    if (s.i >= s.items.length) return viewSessionEnd();
    const q = S.Q[s.items[s.i]]; const lv = q.livret; const year = q.year;
    const revealed = !!s.revealed[q.qid] || s.mode === "exam";
    const cur = s.scores[q.qid];
    const pf = q.portfolio || [];
    const showPf = pf.length > 0 && yearOf(year).pages.p;
    const pfOpen = store.get("pfOpen", window.innerWidth > 1000) && showPf;
    const corrHTML = q.corr && q.corr.length
      ? q.corr.map((sg) => segHTML(year, "c", sg)).join("")
      : (lv.cpages ? `<div class="notice" style="margin:10px">Correction ciblée indisponible pour cette question : voici les pages de correction du livret.</div>${lv.cpages.map((p) => fullPage(year, "c", p)).join("")}` : `<div class="notice">Pas de correction disponible.</div>`);
    const prevA = S.last[q.qid];
    const answers = s.mode === "exam" ? (s.answers = s.answers || {}) : (S.ans = S.ans || {});
    const ctx = { questions: [q], answers, reveal: revealed ? { [q.qid]: true } : {}, readonly: s.mode === "exam" };
    const ev = IA.evaluate(q, answers[q.qid]);
    if (revealed && cur === undefined && ev.full && (s.mode === "exam" || IA.hasContent(answers[q.qid]))) {
      s.scores[q.qid] = ev.pts; s.autoScored = { ...(s.autoScored || {}), [q.qid]: true };
      if (s.mode !== "exam") { saveAttempt(q, ev.pts, s.mode, now() - s.qt); s.lastSaved = { ...(s.lastSaved || {}), [q.qid]: ev.pts }; }
      return viewSession();
    }
    const hasIA = q.ia && ((q.ia.opts || []).length || (q.ia.fields || []).length);
    render(`
      <div class="spread no-print"><a href="${s.back || "#/"}" class="small">← Quitter</a><span class="small muted">${esc(s.title || "")}</span></div>
      <div class="dots no-print" style="margin:10px 0 14px">${s.items.map((id, k) => `<button class="dot ${s.scores[id] !== undefined ? (s.scores[id] >= qmax(S.Q[id]) ? "ok" : s.scores[id] > 0 ? "mid" : "ko") : ""} ${k === s.i ? "cur" : ""}" data-jump="${k}">${k + 1}</button>`).join("")}</div>
      <div class="qhead">
        <span class="title">Question ${q.whole ? "" : q.n}</span>
        <span class="chip ${DISC[lv.discipline]?.css}">${esc(lv.label)}</span>
        <span class="chip">${esc(yearOf(year).label)} · livret ${lv.n}</span>
        <span class="chip">${q.max ? `${q.max} pt${q.max > 1 ? "s" : ""}` : "points : voir grille"}</span>
        ${prevA && !s.browse ? `<span class="chip">déjà faite : ${fmtN(prevA.score)}/${fmtN(prevA.max)}</span>` : ""}
        <span style="flex:1"></span>
        ${showPf ? `<button class="btn sm no-print" data-a="pf">${pfOpen ? "Masquer" : "Afficher"} le portfolio (p. ${pf.join(", ")})</button>` : ""}
        <button class="btn sm no-print" data-a="flag" title="Marquer à revoir">${S.flags[q.qid] ? "★ Marquée" : "☆ À revoir"}</button>
        <button class="btn sm no-print" data-a="print" title="Imprimer la question">🖨️</button>
      </div>
      ${lv.subject === "ecouter" ? `<details class="no-print" ${s.i === 0 ? "open" : ""} style="margin-bottom:14px"><summary class="small"><b>🎧 Texte à écouter</b></summary><div style="margin-top:8px">${ttsHTML(year, true)}</div></details>` : ""}
      <div class="qwrap ${pfOpen ? "with-pf" : ""}">
        <div>
          <div class="spread no-print" style="margin-bottom:8px">${IA.toolbarHTML()}<div class="row"><button class="btn sm" data-a="zoom" title="Agrandir la page">🔍</button><button class="btn sm ghost" data-a="clear" title="Effacer mes réponses">↺<span class="lbl"> Effacer</span></button></div></div>
          <div class="sheet" id="qsheet">${q.segs.map((sg) => segIA(year, sg, ctx)).join("")}</div>
          <p class="tiny no-print" style="margin-top:6px">${hasIA ? "Réponds directement sur la page : touche les cases, écris sur les lignes. Pour un tableau ou un tracé, utilise ✗, Aa ou ✏️." : "Réponds sur la page avec les outils ✗, Aa et ✏️, ou sur une feuille."} Puis vérifie avec la correction.</p>
          <div class="corr-box ${revealed ? "" : "hidden"}" id="corr">
            <div class="label">✅ Correction</div>
            <div class="sheet">${corrHTML}</div>
            ${lv.annexes && lv.annexes.length ? `<button class="btn sm" data-a="annex" style="margin-top:8px">Voir la grille / les annexes de correction</button>` : ""}
          </div>
          <div class="card score-box ${revealed ? "" : "hidden"} no-print" id="score">
            <div class="spread"><h3 style="margin:0">Combien de points as-tu obtenus ?</h3><span class="tiny">Compare ta réponse à la correction, honnêtement 😉</span></div>
            ${ev.max ? `<div class="notice ${ev.full ? "info" : ""}" style="margin-top:8px">🤖 Cases corrigées automatiquement : <b>${fmtN(ev.pts)} / ${ev.max}</b>${ev.full ? (s.autoScored?.[q.qid] ? " — score enregistré, tu peux le modifier." : "") : ` — évalue toi-même le reste de la question (${fmtN(qmax(q) - ev.max)} pt${qmax(q) - ev.max > 1 ? "s" : ""}).`}</div>` : ""}
            <div style="margin-top:10px">${scoreControls(q, cur)}</div>
          </div>
          <div class="sticky-foot no-print"><div class="row nowrap">
            <button class="btn" data-a="prev" ${s.i === 0 ? "disabled" : ""}>←<span class="lbl"> Précédente</span></button>
            <span style="flex:1"></span>
            ${!revealed ? `<button class="btn primary big" data-a="reveal">Voir la correction</button><span style="flex:1"></span>` : ""}
            <button class="btn ${cur !== undefined ? "primary" : ""}" data-a="next">${s.i === s.items.length - 1 ? "Terminer" : cur !== undefined ? `<span class="lbl">Suivante </span>→` : `<span class="lbl">Passer </span>→`}</button>
          </div></div>
        </div>
        ${pfOpen ? `<aside class="pf-panel no-print"><div class="pf-tabs">${pf.map((p, k) => `<button class="btn sm ${k === 0 ? "primary" : ""}" data-pfp="${p}">Portfolio p. ${p}</button>`).join("")}</div>
          <div class="sheet" id="pfview">${fullPage(year, "p", pf[0])}</div></aside>` : ""}
      </div>`, true);
    bindZoom(app()); bindTTS(app());
    IA.bindToolbar(app());
    IA.bind($("#qsheet"), ctx, (qid) => { if (s.mode !== "exam") saveAnswer(qid); });
    S.sessionActive = true;
    const inp = $("#scoreInput");
    $$("[data-step]").forEach((b) => b.addEventListener("click", () => { const v = Math.min(qmax(q), Math.max(0, (+inp.value || 0) + +b.dataset.step)); inp.value = v; }));
    $("[data-score-input]")?.addEventListener("click", () => { if (inp.value !== "") setScore(q, Math.min(qmax(q), Math.max(0, +inp.value))); });
  }
  async function setScore(q, v) {
    const s = S.session;
    const first = s.scores[q.qid] === undefined;
    s.scores[q.qid] = v;
    if (s.mode !== "exam") {
      if (first || s.lastSaved?.[q.qid] !== v) {
        await saveAttempt(q, v, s.mode, now() - s.qt);
        s.lastSaved = { ...(s.lastSaved || {}), [q.qid]: v };
      }
    }
    if (v >= qmax(q) && first) toast(pick(["Bravo ! 🎉", "Super ! ⭐", "Parfait ! 👏", "Excellent ! 🚀"]), 1200);
    viewSession();
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  async function sessionClick(e) {
    const s = S.session; if (!s) return;
    const q = S.Q[s.items[s.i]];
    const t = e.target.closest("[data-a],[data-score],[data-jump],[data-pfp]"); if (!t) return;
    if (t.dataset.score !== undefined) return setScore(q, +t.dataset.score);
    if (t.dataset.jump !== undefined) { s.i = +t.dataset.jump; s.qt = now(); return viewSession(); }
    if (t.dataset.pfp) {
      $$("[data-pfp]").forEach((b) => b.classList.toggle("primary", b === t));
      $("#pfview").innerHTML = fullPage(q.year, "p", +t.dataset.pfp); bindZoom($("#pfview")); return;
    }
    const a = t.dataset.a;
    if (a === "reveal") { s.revealed[q.qid] = true; viewSession(); setTimeout(() => $("#corr")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    if (a === "next") { s.i++; s.qt = now(); viewSession(); }
    if (a === "prev") { s.i = Math.max(0, s.i - 1); s.qt = now(); viewSession(); }
    if (a === "pf") { store.set("pfOpen", !store.get("pfOpen", window.innerWidth > 1000)); viewSession(); }
    if (a === "flag") { const on = await toggleFlag(q.qid); toast(on ? "Ajoutée à « À revoir »" : "Retirée de « À revoir »"); viewSession(); }
    if (a === "print") window.print();
    if (a === "zoom") openLightbox([...new Set(q.segs.map((sg) => sg.p))].map((p) => pageUrl(q.year, "q", p)), 0);
    if (a === "clear") {
      const tgt = s.mode === "exam" ? s.answers : S.ans;
      if (IA.hasContent(tgt[q.qid]) && !confirm("Effacer tes réponses à cette question ?")) return;
      tgt[q.qid] = IA.empty(); if (s.mode !== "exam") saveAnswer(q.qid); viewSession();
    }
    if (a === "annex") openLightbox(q.livret.annexes.map((p) => pageUrl(q.year, "c", p)), 0);
  }
  function viewSessionEnd() {
    const s = S.session;
    const items = s.items.map((id) => S.Q[id]);
    const answered = items.filter((q) => s.scores[q.qid] !== undefined);
    const got = answered.reduce((a, q) => a + s.scores[q.qid], 0), max = answered.reduce((a, q) => a + qmax(q), 0);
    const p = pct(got, max);
    if (s.mode === "exam" && !s.examSaved) return finishExam();
    const exam = s.mode === "exam";
    render(`<div class="card stack" style="max-width:720px;margin:20px auto;text-align:center">
      <div class="celebrate">${p >= 80 ? "🏆" : p >= 50 ? "👍" : "💪"}</div>
      <h1>${exam ? "Examen blanc terminé" : "Séance terminée !"}</h1>
      <p class="kpi">${fmtN(got)} / ${fmtN(max)} <span class="muted" style="font-size:1rem">(${p}%)</span></p>
      ${exam ? `<p class="${p >= 50 ? "" : "muted"}">${p >= 50 ? "✅ Au-dessus du seuil de 50 % pour ce livret." : "Sous le seuil de 50 % : on retravaille les questions ratées ?"}</p>` : ""}
      <p class="muted">${answered.length} question${answered.length > 1 ? "s" : ""} corrigée${answered.length > 1 ? "s" : ""} sur ${items.length}. ${p >= 80 ? "Magnifique travail !" : p >= 50 ? "C'est bien, continue !" : "Chaque erreur est une occasion d'apprendre."}</p>
      <div class="row" style="justify-content:center">
        ${items.some((q) => s.scores[q.qid] !== undefined && s.scores[q.qid] < qmax(q)) ? `<button class="btn primary" data-a="redo">Refaire les questions ratées</button>` : ""}
        <a class="btn" href="${s.back || "#/"}">Retour</a><a class="btn" href="#/">Accueil</a></div></div>`);
    $("[data-a=redo]")?.addEventListener("click", () => startSession({ title: (s.title || "") + " — reprise", items: items.filter((q) => s.scores[q.qid] !== undefined && s.scores[q.qid] < qmax(q)).map((q) => q.qid), mode: "practice", back: s.back }));
  }

  /* ================================================================ s'entraîner */
  function viewTraining() {
    const prefs = store.get("trainPrefs", { groups: [], years: [], n: 10, filter: "notdone" });
    const counts = (gid) => Object.values(S.Q).filter((q) => groupOf(q.livret.subject) === gid).length;
    render(`<h1>S'entraîner par matière</h1><p class="muted">Les questions des différentes années sont mélangées : idéal pour travailler une compétence précise.</p>
      <div class="card stack">
        ${Object.entries(DISC).map(([d, info]) => `<div><div class="small" style="font-weight:700;margin-bottom:6px"><span class="chip ${info.css}">${info.label}</span></div>
          <div class="row">${GROUPS.filter((g) => g.disc === d).map((g) => `<button class="btn sm ${prefs.groups.includes(g.id) ? "primary" : ""}" data-g="${g.id}">${SUBJECT_ICON[g.id] || ""} ${g.label} <span class="tiny" style="color:inherit;opacity:.7">${counts(g.id)}</span></button>`).join("")}</div></div>`).join("")}
        <div><div class="small muted" style="margin-bottom:6px">Années</div><div class="row">${S.years.map((y) => `<button class="btn sm ${!prefs.years.length || prefs.years.includes(y.id) ? "primary" : ""}" data-y="${y.id}">${y.id}</button>`).join("")}</div></div>
        <div class="row"><div><div class="small muted" style="margin-bottom:6px">Nombre de questions</div><div class="seg-ctl" id="nsel">${[5, 10, 20, 40].map((n) => `<button data-n="${n}" class="${prefs.n === n ? "on" : ""}">${n}</button>`).join("")}</div></div>
          <div><div class="small muted" style="margin-bottom:6px">Lesquelles ?</div><div class="seg-ctl" id="fsel">${[["notdone", "Jamais faites"], ["weak", "Pas encore réussies"], ["all", "Toutes"]].map(([k, l]) => `<button data-f="${k}" class="${prefs.filter === k ? "on" : ""}">${l}</button>`).join("")}</div></div></div>
        <div><button class="btn primary big" id="go">▶ Commencer</button> <span class="small muted" id="avail"></span></div>
      </div>`);
    const pool = () => Object.values(S.Q).filter((q) => (!prefs.groups.length || prefs.groups.includes(groupOf(q.livret.subject))) && (!prefs.years.length || prefs.years.includes(q.year))
      && !q.whole && (prefs.filter === "all" || (prefs.filter === "notdone" ? !S.last[q.qid] : status(q.qid) !== "ok")));
    const upd = () => { store.set("trainPrefs", prefs); $("#avail").textContent = `${pool().length} questions disponibles`; };
    upd();
    $$("[data-g]").forEach((b) => b.addEventListener("click", () => { const g = b.dataset.g; prefs.groups = prefs.groups.includes(g) ? prefs.groups.filter((x) => x !== g) : prefs.groups.concat(g); b.classList.toggle("primary"); upd(); }));
    $$("[data-y]").forEach((b) => b.addEventListener("click", () => {
      const all = S.years.map((y) => y.id); let cur = prefs.years.length ? prefs.years : all.slice(); const y = b.dataset.y;
      cur = cur.includes(y) ? cur.filter((x) => x !== y) : cur.concat(y); prefs.years = cur.length === all.length ? [] : cur;
      $$("[data-y]").forEach((x) => x.classList.toggle("primary", !prefs.years.length || prefs.years.includes(x.dataset.y))); upd();
    }));
    $$("[data-n]").forEach((b) => b.addEventListener("click", () => { prefs.n = +b.dataset.n; $$("[data-n]").forEach((x) => x.classList.toggle("on", x === b)); upd(); }));
    $$("[data-f]").forEach((b) => b.addEventListener("click", () => { prefs.filter = b.dataset.f; $$("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); upd(); }));
    $("#go").addEventListener("click", () => {
      const items = shuffle(pool()).slice(0, prefs.n).map((q) => q.qid);
      const label = prefs.groups.length ? prefs.groups.map((g) => GROUPS.find((x) => x.id === g).label).join(", ") : "Toutes matières";
      startSession({ title: label, items, mode: "practice", back: "#/entrainement" });
    });
  }

  /* ================================================================ à revoir */
  function viewReview() {
    const list = reviewList();
    render(`<h1>À revoir</h1><p class="muted">Les questions ratées reviennent ici. Une fois réussies, elles reviennent encore quelques fois, espacées de quelques jours, pour bien les retenir.</p>
      ${list.length ? `<div class="toolbar" style="margin:14px 0"><button class="btn primary big" id="go">▶ Réviser ${Math.min(list.length, 15)} question${list.length > 1 ? "s" : ""}</button></div>
      <div class="card table-wrap"><table><thead><tr><th>Question</th><th>Matière</th><th>Dernier essai</th><th>Pourquoi</th></tr></thead><tbody>
      ${list.map((r) => { const q = S.Q[r.qid], a = S.last[r.qid]; return `<tr><td><a href="#/q/${r.qid}">${q.year} · L${q.livret.n} · Q${q.n}</a></td><td><span class="chip ${DISC[q.livret.discipline]?.css}">${esc(q.livret.label)}</span></td><td>${a ? `${fmtN(a.score)}/${fmtN(a.max)}` : "–"}</td><td class="small">${r.reason}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="card empty"><div class="celebrate">🎉</div><p>Rien à revoir pour l'instant !</p><a class="btn primary" href="#/entrainement">S'entraîner</a></div>`}`);
    $("#go")?.addEventListener("click", () => startSession({ title: "À revoir", items: list.slice(0, 15).map((r) => r.qid), mode: "review", back: "#/revoir" }));
  }

  /* ================================================================ examen blanc */
  function viewExamSetup() {
    const y = yearOf(store.get("examYear", S.years[S.years.length - 1].id)) || S.years[0];
    const exams = S.state.exams;
    render(`<h1>Examen blanc</h1><p class="muted">Comme le jour J : un livret complet, chronométré avec la durée officielle, sans correction pendant l'épreuve. L'enfant répond sur papier (imprime le livret depuis le PDF si tu veux), puis on corrige ensemble.</p>
      <div class="seg-ctl" id="ysel" style="margin:10px 0 16px">${S.years.map((x) => `<button data-y="${x.id}" class="${x.id === y.id ? "on" : ""}">${esc(x.label)}</button>`).join("")}</div>
      <div class="grid g3">${y.livrets.map((lv) => { const last = exams.filter((e) => e.year === y.id && e.livret === lv.n).slice(-1)[0]; return `<a class="card tile bd-${lv.discipline}" href="#/examen/${y.id}/${lv.n}">
        <b>${SUBJECT_ICON[lv.subject] || ""} Livret ${lv.n} — ${esc(lv.label)}</b><span class="small muted">${lv.minutes} min · /${lv.total || lv.max} points</span>
        <span class="tiny">${last ? `Dernier examen : ${fmtN(last.score)}/${fmtN(last.max)} (${pct(last.score, last.max)}%)` : "Jamais passé"}</span></a>`; }).join("")}</div>
      ${ceb_simulation_html()}`);
    $$("#ysel button").forEach((b) => b.addEventListener("click", () => { store.set("examYear", b.dataset.y); viewExamSetup(); }));
  }
  function ceb_simulation_html() {
    const rows = S.years.map((y) => {
      const cells = Object.keys(DISC).map((d) => {
        const lvs = y.livrets.filter((l) => l.discipline === d);
        let got = 0, max = 0, missing = 0;
        for (const lv of lvs) { const e = S.state.exams.filter((x) => x.year === y.id && x.livret === lv.n).slice(-1)[0]; if (e) { got += e.score; max += e.max; } else missing++; }
        if (missing) return `<td class="tiny">${lvs.length - missing}/${lvs.length} livrets</td>`;
        const p = pct(got, max);
        return `<td><b style="color:${p >= 50 ? "var(--ok)" : "var(--ko)"}">${p}%</b></td>`;
      });
      return `<tr><td>${esc(y.label)}</td>${cells.join("")}</tr>`;
    }).join("");
    return `<div class="section-title"><h2>Simulation du CEB</h2></div><div class="card table-wrap"><table><thead><tr><th>Année</th><th>Français</th><th>Mathématiques</th><th>Éveil</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="tiny" style="margin-bottom:0">Basé sur le dernier examen blanc de chaque livret. Le CEB est réussi avec au moins 50 % dans chacune des trois épreuves (français, mathématiques, éveil) ; vérifie les règles en vigueur auprès de l'école.</p></div>`;
  }
  function viewExamRun(year, n) {
    const lv = livretOf(year, n); if (!lv) return notFound();
    const y = yearOf(year);
    const total = lv.minutes * 60;
    const pages = range(lv.qpages[0] + 1, lv.qpages[1]).filter((p) => lv.questions.some((q) => q.segs.some((s) => s.p === p)));
    const draftKey = `examDraft-${S.profile.id}-${year}-${lv.n}`;
    const draft = store.get(draftKey, null);
    const examAns = (draft && draft.answers) || {};
    const ctx = { questions: lv.questions, answers: examAns, reveal: {} };
    const nAuto = lv.questions.filter((q) => q.ia && q.ia.key).length;
    render(`<a href="#/examen" class="small">← Examen blanc</a>
      <h1>${SUBJECT_ICON[lv.subject] || ""} ${esc(y.label)} — Livret ${lv.n} : ${esc(lv.label)}</h1>
      <div class="card stack" id="intro" style="max-width:760px">
        <p>Durée : <b>${lv.minutes} minutes</b> · ${lv.total || lv.max} points. ${y.pages.p && lv.questions.some((q) => q.portfolio.length) ? "Le portfolio est disponible (bouton en haut)." : ""}</p>
        <ul class="small muted"><li>Prépare une feuille, un crayon${lv.discipline === "math" ? ", une latte, une équerre et un compas" : ""}.</li>
        <li>Le dictionnaire est autorisé${lv.subject === "nombres1" ? " ; la calculatrice est interdite pour ce livret" : lv.discipline === "math" ? " ; la calculatrice est autorisée (sauf indication contraire)" : ""}.</li>
        <li><b>Réponds directement à l'écran</b> : touche les cases pour les cocher, écris sur les lignes ; pour un tableau, un schéma ou un tracé, utilise ✗ (croix), Aa (texte) ou ✏️ (crayon). Tu peux aussi répondre sur papier.</li>
        <li>Pas de correction pendant l'épreuve. À la fin, ${nAuto ? `les cases de ${nAuto} question${nAuto > 1 ? "s" : ""} sont corrigées automatiquement, ` : ""}le reste se corrige question par question avec la correction officielle.</li></ul>
        <div class="row"><button class="btn primary big" id="start">▶ ${draft ? "Reprendre l'épreuve" : "Commencer l'épreuve"}</button>${draft ? `<button class="btn" id="restart">Recommencer à zéro</button>` : ""}</div></div>
      <div id="run" class="hidden">
        <div class="card" style="position:sticky;top:64px;z-index:20;padding:10px 14px;margin-bottom:12px">
          <div class="spread"><span class="timer" id="timer">${mmss(total)}</span>
          <div class="row">${y.pages.p ? `<button class="btn sm" id="pfbtn">🖼️ Portfolio</button>` : ""}<button class="btn sm" id="pause">⏸ Pause</button><button class="btn sm primary" id="end">Terminer et corriger</button></div></div>
          <div class="timebar" style="margin-top:8px"><i id="tbar" style="width:100%"></i></div>
          <div style="margin-top:8px">${IA.toolbarHTML()}</div></div>
        ${lv.subject === "ecouter" ? ttsHTML(year) : ""}
        <div class="stack exam-pages" id="xpages" style="margin-top:12px">${pages.map((p) => `<div class="sheet">${segIA(year, { p, y0: 0, y1: 1 }, ctx)}</div>`).join("")}</div>
        <div style="margin:20px 0"><button class="btn primary big" id="end2">J'ai fini — corriger</button></div>
      </div>`);
    bindTTS(app()); IA.bindToolbar(app());
    let left = draft && draft.left > 0 ? draft.left : total, paused = false, timer = null, t0 = now();
    const saveDraft = () => store.set(draftKey, { answers: examAns, left });
    IA.bind($("#xpages"), ctx, saveDraft);
    $("#timer").textContent = mmss(left);
    const tick = () => {
      if (paused) return;
      left -= 1; if (left % 15 === 0) saveDraft(); $("#timer").textContent = mmss(left); $("#tbar").style.width = `${Math.max(0, (100 * left) / total)}%`;
      $("#timer").classList.toggle("warn", left <= 300);
      if (left === 300) toast("Plus que 5 minutes !");
      if (left <= 0) { clearInterval(timer); toast("Temps écoulé !"); finish(); }
    };
    const finish = () => {
      clearInterval(timer);
      saveDraft();
      S.session = { i: 0, scores: {}, revealed: {}, t0, qt: now(), title: `Correction — ${y.label} · ${lv.label}`, items: lv.questions.map((q) => q.qid), mode: "exam", back: "#/examen", answers: examAns, draftKey, exam: { year, n: lv.n, seconds: Math.round(total - left) } };
      location.hash = "#/session";
    };
    $("#restart")?.addEventListener("click", () => { store.set(draftKey, null); viewExamRun(year, n); });
    $("#start").addEventListener("click", () => { $("#intro").classList.add("hidden"); $("#run").classList.remove("hidden"); timer = setInterval(tick, 1000); S.timers.push(timer); });
    $("#pause").addEventListener("click", (e) => { paused = !paused; e.target.textContent = paused ? "▶ Reprendre" : "⏸ Pause"; });
    $("#end").addEventListener("click", finish); $("#end2").addEventListener("click", finish);
    $("#pfbtn")?.addEventListener("click", () => openLightbox(range(1, y.pages.p.count).map((p) => pageUrl(year, "p", p)), Math.max(0, (lv.questions.flatMap((q) => q.portfolio)[0] || 1) - 1)));
  }
  async function finishExam() {
    const s = S.session; const ex = s.exam;
    const items = s.items.map((id) => S.Q[id]);
    const got = items.reduce((a, q) => a + (s.scores[q.qid] || 0), 0), max = items.reduce((a, q) => a + qmax(q), 0);
    try {
      await api(`profiles/${S.profile.id}/attempts`, { method: "POST", body: { items: items.filter((q) => s.scores[q.qid] !== undefined).map((q) => ({ qid: q.qid, score: s.scores[q.qid], max: qmax(q), mode: "exam", seconds: 0 })) } });
      const lv = livretOf(ex.year, ex.n);
      const light = {}; for (const [k, v] of Object.entries(s.answers || {})) light[k] = { b: v.b, f: v.f, m: v.m, t: v.t };
      await api(`profiles/${S.profile.id}/exams`, { method: "POST", body: { year: ex.year, livret: ex.n, subject: lv.subject, score: got, max, seconds: ex.seconds, detail: { scores: s.scores, auto: s.autoScored || {}, answers: light } } });
      if (s.draftKey) store.set(s.draftKey, null);
      await refreshState();
    } catch (e) { toast("Enregistrement impossible : " + e.message); }
    s.examSaved = true; viewSessionEnd();
  }

  /* ================================================================ exercices générés */
  function viewDrills() {
    const best = {};
    for (const d of S.state.drills) { const p = pct(d.correct, d.total); best[d.kind] = Math.max(best[d.kind] || 0, p); }
    const level = store.get("drillLevel", 2);
    render(`<h1>Exercices rapides</h1><p class="muted">Des séries de 10 calculs ou questions générées à l'infini, avec correction immédiate. Parfait pour 5 minutes par jour.</p>
      <div class="row" style="margin:8px 0 18px"><span class="small muted">Niveau :</span><div class="seg-ctl" id="lvl">${[[1, "Facile"], [2, "Moyen"], [3, "Comme au CEB"]].map(([v, l]) => `<button data-l="${v}" class="${level === v ? "on" : ""}">${l}</button>`).join("")}</div></div>
      ${["math", "francais"].map((g) => `<div class="section-title"><h2><span class="chip ${DISC[g].css}">${DISC[g].label}</span></h2></div>
      <div class="grid g4">${Drills.LIST.filter((d) => d.group === g).map((d) => `<a class="card tile" href="#/exercice/${d.id}"><span class="ico">${d.icon}</span><b>${esc(d.title)}</b><span class="tiny">${best[d.id] !== undefined ? `Meilleur score : ${best[d.id]}%` : "Pas encore essayé"}</span></a>`).join("")}</div>`).join("")}`);
    $$("#lvl button").forEach((b) => b.addEventListener("click", () => { store.set("drillLevel", +b.dataset.l); $$("#lvl button").forEach((x) => x.classList.toggle("on", x === b)); }));
  }
  function viewDrill(id) {
    const d = Drills.LIST.find((x) => x.id === id); if (!d) return notFound();
    const level = store.get("drillLevel", 2), N = 10;
    const st = { k: 0, good: 0, results: [], mistakes: [], t0: now(), q: d.gen(level), answered: false };
    const draw = () => {
      if (st.k >= N) return end();
      const q = st.q;
      render(`<a href="#/exercices" class="small">← Exercices</a>
        <div class="card" style="max-width:760px;margin:12px auto">
          <div class="spread"><b>${d.icon} ${esc(d.title)}</b><span class="small muted">${st.k + 1} / ${N}</span></div>
          <div class="drill-q">${q.sub ? `<span class="sub">${esc(q.sub)}</span>` : ""}${esc(q.prompt)}</div>
          ${q.kind === "choice" ? `<div class="choices">${q.choices.map((c) => `<button data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>`
            : `<form class="drill-input" id="f"><input id="ans" type="text" inputmode="${/^[-\d\s.,]+$/.test(q.answer) ? "decimal" : "text"}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(q.hint || "Ta réponse")}"><button class="btn primary big">Valider</button></form>`}
          <div class="feedback" id="fb"></div>
          <div class="row" style="justify-content:center"><button class="btn hidden" id="nx">Suivant →</button></div>
          <div class="progress-dots">${range(0, N - 1).map((i) => `<i class="${st.results[i] === true ? "good" : st.results[i] === false ? "bad" : i === st.k ? "cur" : ""}"></i>`).join("")}</div>
        </div>`);
      const answer = (txt, btn) => {
        if (st.answered) return; st.answered = true;
        const ok = Drills.checkAnswer(q, txt);
        st.results[st.k] = ok; if (ok) st.good++; else st.mistakes.push({ q: q.prompt, sub: q.sub || "", given: txt, expected: q.answer });
        const fb = $("#fb");
        fb.className = "feedback " + (ok ? "good" : "bad");
        const near = !ok && q.near && q.near(txt);
        fb.innerHTML = ok ? "✔ Bravo !" : `✘ ${near ? "Presque ! Attention aux accents. " : ""}La bonne réponse : <b>${esc(q.answer)}${q.unit ? " " + esc(q.unit) : ""}</b>${q.explain ? `<div class="small muted">${esc(q.explain)}</div>` : ""}`;
        if (btn) { btn.classList.add(ok ? "good" : "bad"); if (!ok) $$("[data-c]").forEach((b) => { if (b.dataset.c === q.answer) b.classList.add("good"); }); }
        $("#nx").classList.remove("hidden"); $("#nx").focus();
        if (ok) setTimeout(() => { if (st.answered && st.q === q) next(); }, 900);
      };
      const next = () => { st.k++; st.answered = false; st.q = d.gen(level); draw(); };
      $$("[data-c]").forEach((b) => b.addEventListener("click", () => answer(b.dataset.c, b)));
      $("#f")?.addEventListener("submit", (e) => { e.preventDefault(); const v = $("#ans").value; if (v.trim()) answer(v); });
      $("#nx").addEventListener("click", next);
      setTimeout(() => $("#ans")?.focus(), 30);
    };
    const end = async () => {
      const secs = Math.round(now() - st.t0);
      try { await api(`profiles/${S.profile.id}/drills`, { method: "POST", body: { kind: d.id, level: String(level), correct: st.good, total: N, seconds: secs, mistakes: st.mistakes } }); S.state.drills.push({ kind: d.id, level: String(level), correct: st.good, total: N, seconds: secs, ts: now() }); } catch (e) { /* hors ligne */ }
      render(`<div class="card stack" style="max-width:720px;margin:20px auto;text-align:center">
        <div class="celebrate">${st.good >= 9 ? "🏆" : st.good >= 6 ? "👍" : "💪"}</div><h1>${st.good} / ${N}</h1><p class="muted">en ${mmss(secs)}</p>
        ${st.mistakes.length ? `<div class="table-wrap" style="text-align:left"><table><thead><tr><th>Question</th><th>Ta réponse</th><th>Correct</th></tr></thead><tbody>${st.mistakes.map((m) => `<tr><td>${esc(m.sub ? m.sub + " — " : "")}${esc(m.q)}</td><td style="color:var(--ko)">${esc(m.given)}</td><td style="color:var(--ok)"><b>${esc(m.expected)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="row" style="justify-content:center"><button class="btn primary" id="again">Encore une série</button><a class="btn" href="#/exercices">Autres exercices</a></div></div>`);
      $("#again").addEventListener("click", () => viewDrill(id));
    };
    draw();
  }

  /* ================================================================ progrès */
  function viewProgress() {
    const disc = Object.entries(DISC).map(([id, d]) => { const s = stats((q) => q.livret.discipline === id); return { id, d, s }; });
    const groups = GROUPS.map((g) => ({ g, s: stats((q) => groupOf(q.livret.subject) === g.id) }));
    // carte d'activité (12 semaines)
    const counts = {}; for (const a of [...S.state.attempts, ...S.state.drills]) counts[dayKey(a.ts)] = (counts[dayKey(a.ts)] || 0) + 1;
    const today = new Date(); today.setHours(12); const start = new Date(today); start.setDate(start.getDate() - 7 * 12 - ((today.getDay() + 6) % 7));
    const cells = []; for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) { const c = counts[dayKey(d / 1000)] || 0; cells.push(`<i class="${c >= 15 ? "l3" : c >= 6 ? "l2" : c > 0 ? "l1" : ""}" title="${d.toLocaleDateString("fr-BE")} : ${c}"></i>`); }
    const totalTime = S.state.attempts.reduce((a, x) => a + (x.seconds || 0), 0) + S.state.drills.reduce((a, x) => a + (x.seconds || 0), 0);
    const drillsByKind = {}; for (const d of S.state.drills) (drillsByKind[d.kind] = drillsByKind[d.kind] || []).push(d);
    render(`<div class="spread"><h1>Progrès de ${esc(S.profile.name)}</h1><a class="btn sm" href="/api/profiles/${S.profile.id}/export" download>⬇️ Exporter (CSV)</a></div>
      <div class="grid g4" style="margin:10px 0 6px">
        <div class="card"><div class="kpi">${Object.keys(S.last).length}</div><div class="small muted">questions travaillées / ${Object.keys(S.Q).length}</div></div>
        <div class="card"><div class="kpi">${S.state.attempts.length}</div><div class="small muted">réponses corrigées</div></div>
        <div class="card"><div class="kpi">${S.state.drills.length}</div><div class="small muted">séries d'exercices</div></div>
        <div class="card"><div class="kpi">${Math.round(totalTime / 60)} min</div><div class="small muted">de travail mesuré · 🔥 ${streak()} j</div></div>
      </div>
      <div class="grid g3" style="margin-top:14px">${disc.map(({ d, s }) => `<div class="card row" style="gap:16px"><div class="ring" style="--p:${s.mastery};--c:${d.color}"><span>${s.max ? s.mastery + "%" : "–"}</span></div><div><b>${d.label}</b><div class="small muted">${s.done}/${s.total} questions · ${fmtN(s.got)}/${fmtN(s.max)} pts</div></div></div>`).join("")}</div>
      <div class="section-title"><h2>Par compétence</h2></div>
      <div class="card table-wrap"><table><thead><tr><th>Matière</th><th>Faites</th><th style="width:40%">Réussite (points)</th><th></th></tr></thead><tbody>
        ${groups.map(({ g, s }) => `<tr><td>${SUBJECT_ICON[g.id] || ""} ${g.label}</td><td class="small">${s.done}/${s.total}</td>
          <td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="flex:1"><i class="${s.mastery >= 75 ? "ok" : s.mastery >= 50 ? "mid" : "ko"}" style="width:${s.max ? s.mastery : 0}%"></i></div><span class="small" style="width:40px">${s.max ? s.mastery + "%" : "–"}</span></div></td>
          <td><button class="btn sm" data-train="${g.id}">S'entraîner</button></td></tr>`).join("")}
      </tbody></table></div>
      <div class="section-title"><h2>Activité (12 semaines)</h2></div>
      <div class="card" style="overflow-x:auto"><div class="heat">${cells.join("")}</div></div>
      <div class="section-title"><h2>Examens blancs</h2></div>
      ${S.state.exams.length ? `<div class="card table-wrap"><table><thead><tr><th>Date</th><th>Épreuve</th><th>Score</th><th>Durée</th></tr></thead><tbody>
        ${S.state.exams.slice().reverse().map((e) => { const lv = livretOf(e.year, e.livret); return `<tr><td class="small">${new Date(e.ts * 1000).toLocaleDateString("fr-BE")}</td><td>${e.year} · ${esc(lv ? lv.label : e.subject)}</td><td><b style="color:${pct(e.score, e.max) >= 50 ? "var(--ok)" : "var(--ko)"}">${fmtN(e.score)}/${fmtN(e.max)}</b> (${pct(e.score, e.max)}%)</td><td class="small">${mmss(e.seconds)}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="card empty small">Aucun examen blanc pour l'instant.</div>`}
      ${ceb_simulation_html()}
      <div class="section-title"><h2>Exercices rapides</h2></div>
      ${Object.keys(drillsByKind).length ? `<div class="card table-wrap"><table><thead><tr><th>Exercice</th><th>Séries</th><th>Moyenne</th><th>Dernier</th></tr></thead><tbody>
        ${Object.entries(drillsByKind).map(([k, arr]) => { const d = Drills.LIST.find((x) => x.id === k); const avg = pct(arr.reduce((a, x) => a + x.correct, 0), arr.reduce((a, x) => a + x.total, 0)); const l = arr[arr.length - 1]; return `<tr><td>${d ? d.icon + " " + esc(d.title) : esc(k)}</td><td>${arr.length}</td><td>${avg}%</td><td>${l.correct}/${l.total}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="card empty small">Aucun exercice rapide pour l'instant.</div>`}
    `);
    $$("[data-train]").forEach((b) => b.addEventListener("click", () => { const p = store.get("trainPrefs", { groups: [], years: [], n: 10, filter: "notdone" }); p.groups = [b.dataset.train]; store.set("trainPrefs", p); location.hash = "#/entrainement"; }));
  }

  /* ================================================================ fichiers CEB (téléversement) */
  const KIND_LABEL = { questionnaire: "Questionnaire", correction: "Correction", portfolio: "Portfolio" };
  async function viewFiles() {
    const st = await api("status"); const settings = await api("settings");
    const byYear = {};
    for (const f of st.files) { const m = f.name.match(/^(\d{4})_CEB_([a-z]+)/i); if (!m) continue; (byYear[m[1]] = byYear[m[1]] || []).push({ ...f, kind: m[2].toLowerCase().replace(/s$/, "") }); }
    const nextYear = String(Math.max(new Date().getFullYear(), ...Object.keys(byYear).map(Number).map((y) => y + 1).filter((y) => y <= new Date().getFullYear() + 1)));
    const mb = (n) => (n / 1048576).toFixed(1).replace(".", ",") + " Mo";
    render(`<h1>Fichiers CEB</h1>
      <p class="muted">Ajoute les épreuves d'une nouvelle année (ou remplace un fichier) : le site les découpe automatiquement en questions, corrections et réponses interactives.</p>
      <div class="grid g2">
        <div class="card stack" id="up">
          <h2>📤 Ajouter une année</h2>
          <label class="row"><span class="small muted" style="width:110px">Année</span><input type="number" id="upyear" min="2000" max="2099" value="${nextYear}" style="width:120px"></label>
          ${Object.entries(KIND_LABEL).map(([k, l]) => `<label class="row"><span class="small muted" style="width:110px">${l}</span><input type="file" accept="application/pdf,.pdf" data-kind="${k}" style="flex:1;min-width:0"></label>`).join("")}
          <p class="tiny" style="margin:0">Les trois PDF officiels sont publiés chaque année par la Fédération Wallonie-Bruxelles. Le portfolio est facultatif mais recommandé. ${settings.pin ? "Le code parent sera demandé." : ""}</p>
          <div class="bar hidden" id="upbar" style="height:10px"><i class="ok" style="width:0%"></i></div>
          <div class="small" id="upmsg"></div>
          <div class="row"><button class="btn primary" id="upgo">Envoyer et analyser</button></div>
        </div>
        <div class="card stack">
          <h2>⚙️ Analyse</h2>
          <p class="small">${S.years.length} années chargées · ${Object.keys(S.Q).length} questions · ${Object.values(S.Q).filter((q) => q.ia && q.ia.key).length} questions à cases corrigées automatiquement.</p>
          <div class="row"><button class="btn" id="rebuild">🔄 Relancer l'analyse</button>${st.building ? `<span class="chip">analyse en cours…</span>` : ""}</div>
          ${st.log.length ? `<pre class="log" id="blog">${esc(st.log.join("\n"))}</pre>` : ""}
          <p class="tiny" style="margin:0">Une année inchangée est reprise du cache : seule la nouvelle année est analysée (de une à quelques minutes, reconnaissance optique comprise).</p>
        </div>
      </div>
      <div class="section-title"><h2>Fichiers disponibles</h2></div>
      <div class="card table-wrap"><table><thead><tr><th>Année</th><th>Fichier</th><th>Origine</th><th>Taille</th><th></th></tr></thead><tbody>
        ${Object.keys(byYear).sort().reverse().map((y) => byYear[y].map((f, i) => `<tr><td>${i === 0 ? `<b>${y}</b>` : ""}</td>
          <td><a href="/pdf/${encodeURIComponent(f.name)}" target="_blank" rel="noopener">${esc(f.name)}</a></td>
          <td class="small">${esc(f.origin)}</td><td class="small">${mb(f.size)}</td>
          <td>${f.origin === "téléversé" ? `<button class="btn sm danger" data-delf="${esc(f.name)}">Supprimer</button>` : ""}</td></tr>`).join("")).join("")}
      </tbody></table></div>
      <div class="section-title"><h2>Réglage fin d'une année</h2></div>
      <div class="card stack">
        <p class="small muted" style="margin:0">Pour une nouvelle année, les pages de correction de chaque livret sont détectées automatiquement. Si une correction ne tombe pas en face de la bonne question, ajuste ici les plages de pages (numéros de pages du PDF de correction), puis relance l'analyse.</p>
        <div class="row"><select id="cfgyear">${S.years.map((y) => `<option value="${y.id}">${esc(y.label)}${y.auto ? " (détection auto)" : ""}</option>`).join("")}</select><button class="btn sm" id="cfgload">Afficher</button></div>
        <textarea id="cfgtext" rows="12" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.85rem;width:100%" class="hidden"></textarea>
        <div class="row hidden" id="cfgbtns"><button class="btn primary" id="cfgsave">Enregistrer et relancer l'analyse</button><button class="btn ghost" id="cfgreset">Revenir à la détection automatique</button></div>
      </div>`);
    const askPin = async () => (settings.pin ? prompt("Code parent :") || "" : "");
    const upload = (file, year, kind, pin, onProgress) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/upload?year=${encodeURIComponent(year)}&kind=${kind}`);
      xhr.setRequestHeader("Content-Type", "application/pdf"); xhr.setRequestHeader("X-Pin", pin);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => { let d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) { /* */ } xhr.status < 300 ? resolve(d) : reject(new Error(d.error || xhr.statusText)); };
      xhr.onerror = () => reject(new Error("connexion interrompue"));
      xhr.send(file);
    });
    $("#upgo").addEventListener("click", async () => {
      const year = $("#upyear").value.trim();
      const files = $$("#up input[type=file]").filter((i) => i.files[0]).map((i) => ({ kind: i.dataset.kind, file: i.files[0] }));
      if (!/^20\d\d$/.test(year)) return toast("Année invalide");
      if (!files.length) return toast("Choisis au moins un fichier PDF");
      if (!files.some((f) => f.kind === "questionnaire") && !(byYear[year] || []).some((f) => f.kind === "questionnaire")) return toast("Le questionnaire est indispensable");
      const pin = await askPin();
      const total = files.reduce((a, f) => a + f.file.size, 0); let done = 0;
      $("#upbar").classList.remove("hidden"); $("#upgo").disabled = true;
      try {
        for (const f of files) {
          $("#upmsg").textContent = `Envoi : ${KIND_LABEL[f.kind]} (${mb(f.file.size)})…`;
          await upload(f.file, year, f.kind, pin, (r) => { $("#upbar i").style.width = `${Math.round(((done + r * f.file.size) / total) * 100)}%`; });
          done += f.file.size;
        }
        $("#upmsg").textContent = "Fichiers reçus. Analyse lancée…";
        await api("rebuild", { method: "POST", body: { pin } });
        pollBuild();
      } catch (e) { $("#upmsg").textContent = "Erreur : " + e.message; $("#upgo").disabled = false; }
    });
    $("#rebuild").addEventListener("click", async () => { try { await api("rebuild", { method: "POST", body: { pin: await askPin() } }); pollBuild(); } catch (e) { toast(e.message); } });
    $$("[data-delf]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm(`Supprimer ${b.dataset.delf} ?`)) return;
      try { await api(`uploads/${encodeURIComponent(b.dataset.delf)}`, { method: "DELETE", body: { pin: await askPin() } }); toast("Fichier supprimé — relance l'analyse pour mettre le site à jour"); viewFiles(); } catch (e) { toast(e.message); }
    }));
    $("#cfgload").addEventListener("click", async () => {
      const y = $("#cfgyear").value; const c = await api(`yearconfig/${y}`); const info = yearOf(y);
      const cur = Object.keys(c.local).length ? c.local : { ...c.base, correction: c.base.correction || info.sections || {} };
      $("#cfgtext").value = JSON.stringify(cur, null, 1); $("#cfgtext").classList.remove("hidden"); $("#cfgbtns").classList.remove("hidden");
    });
    $("#cfgsave").addEventListener("click", async () => {
      let cfg; try { cfg = JSON.parse($("#cfgtext").value); } catch (e) { return toast("JSON invalide : " + e.message); }
      try { const pin = await askPin(); await api(`yearconfig/${$("#cfgyear").value}`, { method: "PUT", body: { pin, config: cfg } }); await api("rebuild", { method: "POST", body: { pin } }); pollBuild(); } catch (e) { toast(e.message); }
    });
    $("#cfgreset").addEventListener("click", async () => {
      try { const pin = await askPin(); await api(`yearconfig/${$("#cfgyear").value}`, { method: "PUT", body: { pin, config: null } }); await api("rebuild", { method: "POST", body: { pin } }); pollBuild(); } catch (e) { toast(e.message); }
    });
  }
  async function pollBuild() {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      let st; try { st = await api("status"); } catch (e) { continue; }
      const box = $("#blog") || (() => { const p = document.createElement("pre"); p.className = "log"; p.id = "blog"; $("#rebuild")?.parentElement.after(p); return p; })();
      box.textContent = st.log.join("\n"); box.scrollTop = box.scrollHeight;
      if (!st.building) {
        if (st.rc === 0) {
          const res = await fetch("/api/catalog"); if (res.ok) indexCatalog(await res.json());
          toast("Analyse terminée ✔"); if (location.hash === "#/fichiers") viewFiles();
        } else toast("L'analyse a rencontré une erreur (voir le journal)");
        return;
      }
    }
  }

  /* ================================================================ espace parent */
  async function viewParent() {
    const st = await api("status"); const settings = await api("settings");
    const theme = store.get("theme", "auto");
    const nq = Object.keys(S.Q).length, nc = Object.values(S.Q).filter((q) => q.corr && q.corr.length).length;
    render(`<h1>Espace parent</h1>
      <div class="grid g2">
        <div class="card stack"><h2>Enfants</h2>
          ${S.profiles.map((p) => `<div class="spread"><div class="row"><span class="avatar" style="background:${esc(p.color)}33">${esc(p.avatar)}</span><b>${esc(p.name)}</b></div>
            <div class="row"><button class="btn sm" data-edit="${p.id}">Modifier</button><a class="btn sm" href="/api/profiles/${p.id}/export">CSV</a><button class="btn sm" data-reset="${p.id}">Remettre à zéro</button><button class="btn sm danger" data-del="${p.id}">Supprimer</button></div></div>`).join("") || `<p class="muted">Aucun profil.</p>`}
          <div><button class="btn primary" id="add">＋ Ajouter un enfant</button></div></div>
        <div class="card stack"><h2>Réglages</h2>
          <div><div class="small muted" style="margin-bottom:6px">Thème</div><div class="seg-ctl" id="theme">${[["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]].map(([k, l]) => `<button data-t="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
          <div><div class="small muted" style="margin-bottom:6px">Code parent ${settings.pin ? "(actif)" : "(aucun)"} — protège la suppression et la remise à zéro</div>
            <div class="row"><input type="password" id="newpin" inputmode="numeric" placeholder="Nouveau code (4-8 chiffres)" style="width:220px"><button class="btn" id="setpin">${settings.pin ? "Changer" : "Définir"}</button>${settings.pin ? `<button class="btn ghost" id="clrpin">Retirer</button>` : ""}</div></div>
        </div>
        <div class="card stack"><h2>Épreuves chargées</h2>
          <p class="small">${S.years.length} années · ${nq} questions · ${nc} avec correction ciblée (${pct(nc, nq)}%). Construit le ${esc(S.catalog.built)}.</p>
          <p class="small muted">Dossier PDF : <code>${esc(st.pdf_dir)}</code><br>${st.pdfs.length} fichiers : ${st.pdfs.map(esc).join(", ")}</p>
          <p class="small muted">Pour ajouter une année, dépose ses trois PDF (<code>AAAA_CEB_questionnaire.pdf</code>, <code>AAAA_CEB_correction.pdf</code>, <code>AAAA_CEB_portfolio.pdf</code>) dans ce dossier puis reconstruis.</p>
          <div class="row"><a class="btn primary" href="#/fichiers">📤 Ajouter / gérer les fichiers CEB</a><button class="btn" id="rebuild">🔄 Reconstruire le catalogue</button>${st.building ? `<span class="chip">construction en cours…</span>` : ""}</div>
          ${st.log.length ? `<pre class="log">${esc(st.log.join("\n"))}</pre>` : ""}</div>
        <div class="card stack"><h2>Conseils</h2>
          <ul class="small" style="margin:0;padding-left:18px">
            <li>Les questions viennent des épreuves officielles du CEB (Fédération Wallonie-Bruxelles). L'enfant répond sur papier, puis compare avec la correction et note ses points.</li>
            <li>Pour « Écouter », la lecture se fait par la voix de synthèse de l'appareil ; un adulte peut aussi lire le texte affiché.</li>
            <li>Ajoute le site à l'écran d'accueil de la tablette pour l'utiliser comme une application.</li>
            <li>Les données restent sur ton serveur local (aucun compte, aucun envoi externe).</li></ul></div>
      </div>`);
    const askPin = async () => (settings.pin ? prompt("Code parent :") : "");
    $("#add").addEventListener("click", () => editProfile());
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => editProfile(S.profiles.find((p) => p.id === +b.dataset.edit))));
    $$("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      const p = S.profiles.find((x) => x.id === +b.dataset.del);
      if (!confirm(`Supprimer définitivement le profil de ${p.name} et toute sa progression ?`)) return;
      try { await api(`profiles/${p.id}`, { method: "DELETE", body: { pin: await askPin() } }); await loadProfiles(); if (S.profile?.id === p.id) { S.profile = null; store.set("profile", null); paintWho(); } viewParent(); } catch (e) { toast(e.message); }
    }));
    $$("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
      const p = S.profiles.find((x) => x.id === +b.dataset.reset);
      if (!confirm(`Effacer toute la progression de ${p.name} ?`)) return;
      try { await api(`profiles/${p.id}/reset`, { method: "POST", body: { pin: await askPin() } }); await refreshState(); toast("Progression effacée"); } catch (e) { toast(e.message); }
    }));
    $$("#theme button").forEach((b) => b.addEventListener("click", () => { store.set("theme", b.dataset.t); applyTheme(); $$("#theme button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#setpin").addEventListener("click", async () => { try { await api("settings", { method: "PUT", body: { pin: await askPin(), new_pin: $("#newpin").value } }); toast("Code enregistré"); viewParent(); } catch (e) { toast(e.message); } });
    $("#clrpin")?.addEventListener("click", async () => { try { await api("settings", { method: "PUT", body: { pin: await askPin(), new_pin: "" } }); toast("Code retiré"); viewParent(); } catch (e) { toast(e.message); } });
    $("#rebuild").addEventListener("click", async () => { try { await api("rebuild", { method: "POST", body: { pin: await askPin() } }); toast("Reconstruction lancée"); setTimeout(viewParent, 1500); } catch (e) { toast(e.message); } });
  }
  function applyTheme() { const t = store.get("theme", "auto"); if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); }

  /* ================================================================ routeur */
  function notFound() { render(`<div class="empty"><h1>Page introuvable</h1><a class="btn" href="#/">Accueil</a></div>`); }
  function route() {
    S.timers.forEach(clearInterval); S.timers = [];
    S.sessionActive = false;
    window.speechSynthesis?.cancel();
    const h = location.hash.replace(/^#\/?/, ""); const [r, a, b] = h.split("/");
    $$("#nav a").forEach((x) => x.classList.toggle("active", x.dataset.r === (r || "home") || (r === "livret" && x.dataset.r === "epreuves") || (r === "exercice" && x.dataset.r === "exercices")));
    if (r === "parent") return viewParent();
    if (r === "fichiers") return viewFiles();
    if (r === "profils") return viewProfiles();
    if (!S.profile) return viewProfiles();
    switch (r || "") {
      case "": return viewHome();
      case "epreuves": return viewEpreuves();
      case "livret": return viewLivret(a, b);
      case "portfolio": return viewPortfolio(a);
      case "q": return directQuestion(a);
      case "session": return viewSession();
      case "entrainement": return viewTraining();
      case "revoir": return viewReview();
      case "examen": return a ? viewExamRun(a, b) : viewExamSetup();
      case "exercices": return viewDrills();
      case "exercice": return viewDrill(a);
      case "progres": return viewProgress();
      default: return notFound();
    }
  }
  document.addEventListener("keydown", (e) => {
    if (!location.hash.startsWith("#/session") || /input|textarea|select/i.test(document.activeElement?.tagName)) return;
    if (e.key === "ArrowRight") $("[data-a=next]")?.click();
    if (e.key === "ArrowLeft") $("[data-a=prev]")?.click();
    if (e.key === " " && $("[data-a=reveal]")) { e.preventDefault(); $("[data-a=reveal]").click(); }
  });

  async function waitCatalog() {
    for (;;) {
      try { const res = await fetch("/api/catalog"); if (res.ok) return await res.json(); } catch (e) { /* serveur indisponible */ }
      let st = {}; try { st = await api("status"); } catch (e) { /* */ }
      render(`<div class="loading"><div class="card stack" style="max-width:640px">
        <h1>Préparation des épreuves…</h1>
        <p class="muted">${st.pdfs && !st.pdfs.length ? `Aucun PDF trouvé dans <code>${esc(st.pdf_dir)}</code>. Dépose-y les fichiers <code>AAAA_CEB_questionnaire.pdf</code>, <code>AAAA_CEB_correction.pdf</code> et <code>AAAA_CEB_portfolio.pdf</code>, puis redémarre le conteneur.` : "Les PDF sont découpés en pages et en questions. La première fois, cela prend quelques minutes."}</p>
        ${st.log && st.log.length ? `<pre class="log">${esc(st.log.slice(-12).join("\n"))}</pre>` : ""}</div></div>`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async function boot() {
    applyTheme();
    $("#who").addEventListener("click", () => { location.hash = "#/profils"; });
    app().addEventListener("click", (e) => { if (S.sessionActive) sessionClick(e); });
    const cat = await waitCatalog();
    indexCatalog(cat);
    await loadProfiles();
    const pid = store.get("profile", null);
    if (pid && S.profiles.some((p) => p.id === pid)) await selectProfile(pid); else paintWho();
    window.addEventListener("hashchange", route);
    route();
  }
  boot().catch((e) => { console.error(e); render(`<div class="empty"><h1>Oups</h1><p>${esc(e.message)}</p></div>`); });
})();
