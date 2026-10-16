/* Exercices générés à l'infini — calcul, grandeurs, conjugaison, homophones.
   Chaque générateur renvoie { prompt, sub?, kind: 'input'|'choice', answer, choices?, check?(txt), explain? } */
(function () {
  "use strict";
  const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- nombres décimaux exacts (chaînes) ---------- */
  // représente un décimal par {i: BigInt, s: échelle} -> valeur = i / 10^s
  function dec(str) {
    str = String(str).replace(/\s/g, "").replace(",", ".");
    const neg = str.startsWith("-"); if (neg) str = str.slice(1);
    const [a, b = ""] = str.split(".");
    return { i: BigInt((neg ? "-" : "") + (a || "0") + b), s: b.length };
  }
  function decShift(d, k) { // multiplie par 10^k
    if (k >= 0) { const take = Math.min(k, d.s); return { i: d.i * 10n ** BigInt(k - take), s: d.s - take }; }
    return { i: d.i, s: d.s - k };
  }
  function decStr(d) {
    let neg = d.i < 0n, digits = (neg ? -d.i : d.i).toString();
    if (d.s > 0) {
      digits = digits.padStart(d.s + 1, "0");
      let ip = digits.slice(0, -d.s), fp = digits.slice(-d.s).replace(/0+$/, "");
      return (neg ? "-" : "") + group(ip) + (fp ? "," + fp : "");
    }
    return (neg ? "-" : "") + group(digits);
  }
  function group(ip) { return ip.replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
  const fmt = (n) => decStr(dec(Number.isInteger(n) ? String(n) : String(+n.toFixed(6))));
  function numEq(txt, expected) {
    const t = String(txt).trim().replace(/\s/g, "").replace(",", ".");
    if (!/^-?\d*\.?\d+$/.test(t)) return false;
    const a = dec(t), b = dec(String(expected).replace(/\s/g, ""));
    const s = Math.max(a.s, b.s);
    return a.i * 10n ** BigInt(s - a.s) === b.i * 10n ** BigInt(s - b.s);
  }
  function randDec(intMax, decimals) {
    const ip = R(0, intMax); if (!decimals) return String(ip);
    let fp = ""; for (let k = 0; k < decimals; k++) fp += R(0, 9);
    if (/^0+$/.test(fp)) fp = fp.slice(0, -1) + R(1, 9);
    return ip + "," + fp;
  }

  /* ---------- calcul ---------- */
  function tables(level) {
    const max = level === 1 ? 10 : 12;
    const a = R(2, max), b = R(2, 10);
    if (level >= 2 && Math.random() < 0.4) return { prompt: `${a * b} : ${a} = ?`, kind: "input", answer: String(b) };
    return { prompt: `${a} × ${b} = ?`, kind: "input", answer: String(a * b) };
  }
  function mental(level) {
    const op = pick(["+", "−", "+", "−", "×"]);
    if (level === 1) {
      if (op === "×") { const a = R(11, 25), b = R(2, 5); return { prompt: `${a} × ${b} = ?`, kind: "input", answer: String(a * b) }; }
      const a = R(20, 99), b = R(11, 59);
      return op === "+" ? { prompt: `${a} + ${b} = ?`, kind: "input", answer: String(a + b) }
        : { prompt: `${Math.max(a, b)} − ${Math.min(a, b)} = ?`, kind: "input", answer: String(Math.abs(a - b)) };
    }
    if (level === 2) {
      if (op === "×") { const a = R(12, 99), b = pick([4, 5, 9, 11, 20, 25, 50]); return { prompt: `${a} × ${b} = ?`, kind: "input", answer: String(a * b), explain: b === 9 ? `astuce : ×10 puis −${a}` : b === 11 ? `astuce : ×10 puis +${a}` : "" }; }
      const a = R(120, 999), b = R(101, 499);
      return op === "+" ? { prompt: `${fmt(a)} + ${fmt(b)} = ?`, kind: "input", answer: String(a + b) }
        : { prompt: `${fmt(Math.max(a, b))} − ${fmt(Math.min(a, b))} = ?`, kind: "input", answer: String(Math.abs(a - b)) };
    }
    // niveau 3 : décimaux
    const a = dec(randDec(60, pick([1, 2]))), b = dec(randDec(30, 1));
    const s = Math.max(a.s, b.s), ai = a.i * 10n ** BigInt(s - a.s), bi = b.i * 10n ** BigInt(s - b.s);
    if (op === "×") { const x = dec(randDec(9, 1)), k = R(2, 9); return { prompt: `${decStr(x)} × ${k} = ?`, kind: "input", answer: decStr({ i: x.i * BigInt(k), s: x.s }) }; }
    if (op === "+") return { prompt: `${decStr(a)} + ${decStr(b)} = ?`, kind: "input", answer: decStr({ i: ai + bi, s }) };
    const [hi, lo] = ai >= bi ? [a, b] : [b, a];
    return { prompt: `${decStr(hi)} − ${decStr(lo)} = ?`, kind: "input", answer: decStr({ i: (ai >= bi ? ai - bi : bi - ai), s }) };
  }
  function pow10(level) {
    const k = pick([10, 100, 1000]), e = String(k).length - 1;
    const x = dec(randDec(level === 1 ? 99 : 999, level === 1 ? R(0, 1) : R(1, 3)));
    const small = "0," + "0".repeat(e - 1) + "1";
    const ops = [["×", fmt(k), e], [":", fmt(k), -e]];
    if (level === 3) ops.push(["×", small, -e], [":", small, e]);
    const [sym, by, shift] = pick(ops);
    return { prompt: `${decStr(x)} ${sym} ${by} = ?`, kind: "input", answer: decStr(decShift(x, shift)),
      explain: by.startsWith("0,") ? `${sym} ${by} revient à ${sym === "×" ? ":" : "×"} ${fmt(k)}` : "" };
  }
  function fractions(level) {
    const t = level === 1 ? 0 : R(0, 2);
    if (t === 0) {
      const d = pick([2, 3, 4, 5, 6, 8, 10]), n = R(1, d - 1), q = d * R(2, level === 1 ? 10 : 25);
      return { prompt: `${n}/${d} de ${q} = ?`, kind: "input", answer: String(q / d * n), explain: `${q} : ${d} = ${q / d}, puis × ${n}` };
    }
    if (t === 1) {
      const eq = [["1/2", "0,5", "50 %"], ["1/4", "0,25", "25 %"], ["3/4", "0,75", "75 %"], ["1/5", "0,2", "20 %"],
        ["2/5", "0,4", "40 %"], ["1/10", "0,1", "10 %"], ["3/10", "0,3", "30 %"], ["1/100", "0,01", "1 %"], ["7/10", "0,7", "70 %"]];
      const row = pick(eq), from = R(0, 2), to = (from + R(1, 2)) % 3;
      const wrong = shuffle(eq.filter((r) => r !== row)).slice(0, 3).map((r) => r[to]);
      return { prompt: `${row[from]} = ?`, sub: ["Fraction", "Nombre décimal", "Pourcentage"][to] + " équivalent(e)", kind: "choice", answer: row[to], choices: shuffle([row[to], ...wrong]) };
    }
    const d1 = pick([2, 3, 4, 5, 6, 8]), d2 = pick([2, 3, 4, 5, 6, 8]), n1 = R(1, d1 - 1), n2 = R(1, d2 - 1);
    const v1 = n1 / d1, v2 = n2 / d2;
    if (Math.abs(v1 - v2) < 1e-9) return fractions(level);
    return { prompt: `${n1}/${d1}  ?  ${n2}/${d2}`, sub: "Quelle fraction est la plus grande ?", kind: "choice", answer: v1 > v2 ? `${n1}/${d1}` : `${n2}/${d2}`, choices: [`${n1}/${d1}`, `${n2}/${d2}`] };
  }
  function rounding(level) {
    if (level >= 2 && Math.random() < 0.5) {
      const x = dec(randDec(99, 2)), to = pick(["à l'unité", "au dixième"]);
      const s = to === "à l'unité" ? 0 : 1;
      const v = Number(decStr(x).replace(/\s/g, "").replace(",", "."));
      const r = Math.round(v * 10 ** s + 1e-9) / 10 ** s;
      return { prompt: `Arrondis ${decStr(x)} ${to}`, kind: "input", answer: fmt(r) };
    }
    const n = R(1000, level === 1 ? 9999 : 999999), to = pick([["à la dizaine", 10], ["à la centaine", 100], ["au millier", 1000]]);
    const r = Math.round(n / to[1]) * to[1];
    return { prompt: `Arrondis ${fmt(n)} ${to[0]}`, kind: "input", answer: fmt(r) };
  }
  function compare(level) {
    const base = R(0, level === 1 ? 9 : 20);
    const set = new Set();
    while (set.size < 4) set.add(decStr(dec(base + "," + R(1, 9) + (Math.random() < 0.6 ? String(R(0, 9)) : "") + (level === 3 && Math.random() < 0.5 ? String(R(1, 9)) : ""))));
    const arr = [...set];
    const val = (s) => Number(s.replace(/\s/g, "").replace(",", "."));
    const big = Math.random() < 0.5;
    const ans = arr.slice().sort((a, b) => big ? val(b) - val(a) : val(a) - val(b))[0];
    return { prompt: big ? "Quel est le plus grand nombre ?" : "Quel est le plus petit nombre ?", kind: "choice", answer: ans, choices: arr };
  }

  /* ---------- grandeurs ---------- */
  const UNITS = {
    longueur: ["mm", "cm", "dm", "m", "dam", "hm", "km"],
    masse: ["mg", "cg", "dg", "g", "dag", "hg", "kg"],
    capacité: ["ml", "cl", "dl", "l", "dal", "hl"],
  };
  function convert(level) {
    const kind = pick(Object.keys(UNITS));
    let units = UNITS[kind];
    if (level === 1) units = kind === "longueur" ? ["mm", "cm", "m", "km"] : kind === "masse" ? ["g", "kg"] : ["cl", "l", "ml"];
    let a = R(0, units.length - 1), b = R(0, units.length - 1);
    while (b === a) b = R(0, units.length - 1);
    const ua = units[a], ub = units[b];
    const ia = UNITS[kind].indexOf(ua), ib = UNITS[kind].indexOf(ub);
    const x = dec(randDec(level === 1 ? 50 : 999, level === 1 ? 0 : R(0, 2)));
    if (x.i === 0n) x.i = 7n;
    const y = decShift(x, ia - ib);
    return { prompt: `${decStr(x)} ${ua} = ? ${ub}`, kind: "input", answer: decStr(y), unit: ub };
  }
  function durations(level) {
    const t = R(0, level === 1 ? 1 : 3);
    if (t === 0) { const h = R(1, 5), m = pick([5, 10, 15, 20, 30, 40, 45, 50]); return { prompt: `${h} h ${m} min = ? min`, kind: "input", answer: String(h * 60 + m) }; }
    if (t === 1) { const m = R(2, 9), s = R(5, 55); return { prompt: `${m} min ${s} s = ? s`, kind: "input", answer: String(m * 60 + s) }; }
    if (t === 2) {
      const h = R(7, 20), m = pick([0, 10, 15, 25, 30, 40, 45, 50]), add = pick([25, 35, 45, 50, 75, 90, 105, 135]);
      const tot = h * 60 + m + add, H = Math.floor(tot / 60) % 24, M = tot % 60;
      const ans = `${H} h ${String(M).padStart(2, "0")}`;
      return { prompt: `Il est ${h} h ${String(m).padStart(2, "0")}. Quelle heure sera-t-il dans ${add} min ?`, kind: "input", answer: ans,
        check: (txt) => { const mm = String(txt).toLowerCase().replace(/\s/g, "").match(/^(\d{1,2})(?:h|:)(\d{1,2})?(?:min)?$/); return !!mm && +mm[1] === H && +(mm[2] || 0) === M; },
        hint: "Écris par exemple 14 h 05" };
    }
    const d = pick([["1 jour", "h", 24], ["2 jours", "h", 48], ["1 semaine", "jours", 7], ["3 semaines", "jours", 21], ["1 heure", "s", 3600], ["1 an (non bissextile)", "jours", 365], ["1 siècle", "ans", 100]]);
    return { prompt: `${d[0]} = ? ${d[1]}`, kind: "input", answer: String(d[2]) };
  }
  function areas(level) {
    const sq = Math.random() < 0.3, a = R(2, level === 1 ? 10 : 25), b = sq ? a : R(2, level === 1 ? 10 : 20);
    const unit = pick(["cm", "m"]);
    const fig = sq ? `Un carré de ${a} ${unit} de côté` : `Un rectangle de ${a} ${unit} sur ${b} ${unit}`;
    if (Math.random() < 0.5) return { prompt: `${fig} : périmètre = ? ${unit}`, kind: "input", answer: String(2 * (a + b)) };
    return { prompt: `${fig} : aire = ? ${unit}²`, kind: "input", answer: String(a * b) };
  }

  /* ---------- conjugaison ---------- */
  const P = ["je", "tu", "il", "nous", "vous", "ils"];
  const IRR = {
    "être": { pr: "suis es est sommes êtes sont", im: "étais étais était étions étiez étaient", fu: "serai seras sera serons serez seront", pp: "été", aux: "avoir" },
    "avoir": { pr: "ai as a avons avez ont", im: "avais avais avait avions aviez avaient", fu: "aurai auras aura aurons aurez auront", pp: "eu", aux: "avoir" },
    "aller": { pr: "vais vas va allons allez vont", im: "allais allais allait allions alliez allaient", fu: "irai iras ira irons irez iront", pp: "allé", aux: "être" },
    "faire": { pr: "fais fais fait faisons faites font", im: "faisais faisais faisait faisions faisiez faisaient", fu: "ferai feras fera ferons ferez feront", pp: "fait", aux: "avoir" },
    "dire": { pr: "dis dis dit disons dites disent", im: "disais disais disait disions disiez disaient", fu: "dirai diras dira dirons direz diront", pp: "dit", aux: "avoir" },
    "venir": { pr: "viens viens vient venons venez viennent", im: "venais venais venait venions veniez venaient", fu: "viendrai viendras viendra viendrons viendrez viendront", pp: "venu", aux: "être" },
    "prendre": { pr: "prends prends prend prenons prenez prennent", im: "prenais prenais prenait prenions preniez prenaient", fu: "prendrai prendras prendra prendrons prendrez prendront", pp: "pris", aux: "avoir" },
    "pouvoir": { pr: "peux peux peut pouvons pouvez peuvent", im: "pouvais pouvais pouvait pouvions pouviez pouvaient", fu: "pourrai pourras pourra pourrons pourrez pourront", pp: "pu", aux: "avoir" },
    "vouloir": { pr: "veux veux veut voulons voulez veulent", im: "voulais voulais voulait voulions vouliez voulaient", fu: "voudrai voudras voudra voudrons voudrez voudront", pp: "voulu", aux: "avoir" },
    "voir": { pr: "vois vois voit voyons voyez voient", im: "voyais voyais voyait voyions voyiez voyaient", fu: "verrai verras verra verrons verrez verront", pp: "vu", aux: "avoir" },
    "mettre": { pr: "mets mets met mettons mettez mettent", im: "mettais mettais mettait mettions mettiez mettaient", fu: "mettrai mettras mettra mettrons mettrez mettront", pp: "mis", aux: "avoir" },
    "partir": { pr: "pars pars part partons partez partent", im: "partais partais partait partions partiez partaient", fu: "partirai partiras partira partirons partirez partiront", pp: "parti", aux: "être" },
    "savoir": { pr: "sais sais sait savons savez savent", im: "savais savais savait savions saviez savaient", fu: "saurai sauras saura saurons saurez sauront", pp: "su", aux: "avoir" },
    "devoir": { pr: "dois dois doit devons devez doivent", im: "devais devais devait devions deviez devaient", fu: "devrai devras devra devrons devrez devront", pp: "dû", aux: "avoir" },
  };
  const ER = ["chanter", "jouer", "parler", "regarder", "manger", "nager", "commencer", "lancer", "danser", "marcher",
    "travailler", "aimer", "écouter", "dessiner", "ranger", "avancer", "trouver", "donner", "demander", "porter", "arriver", "tomber", "rentrer"];
  const IR = ["finir", "choisir", "grandir", "réussir", "remplir", "obéir", "réfléchir", "applaudir"];
  const ETRE_ER = new Set(["arriver", "tomber", "rentrer"]);

  function conjForms(verb) {
    if (IRR[verb]) { const v = IRR[verb]; return { pr: v.pr.split(" "), im: v.im.split(" "), fu: v.fu.split(" "), pp: v.pp, aux: v.aux }; }
    if (verb.endsWith("ir") && IR.includes(verb)) {
      const st = verb.slice(0, -2);
      return { pr: ["is", "is", "it", "issons", "issez", "issent"].map((e) => st + e),
        im: ["issais", "issais", "issait", "issions", "issiez", "issaient"].map((e) => st + e),
        fu: ["ai", "as", "a", "ons", "ez", "ont"].map((e) => verb + e), pp: st + "i", aux: "avoir" };
    }
    const st = verb.slice(0, -2);
    const soft = (end) => { // manger -> mangeons ; commencer -> commençons (devant a, o)
      if (/^[ao]/.test(end)) { if (st.endsWith("g")) return st + "e" + end; if (st.endsWith("c")) return st.slice(0, -1) + "ç" + end; }
      return st + end;
    };
    return { pr: ["e", "es", "e", "ons", "ez", "ent"].map(soft), im: ["ais", "ais", "ait", "ions", "iez", "aient"].map(soft),
      fu: ["ai", "as", "a", "ons", "ez", "ont"].map((e) => verb + e), pp: st + "é", aux: ETRE_ER.has(verb) ? "être" : "avoir" };
  }
  const AUX = { avoir: "ai as a avons avez ont".split(" "), "être": "suis es est sommes êtes sont".split(" ") };
  const pron = (p, form) => (p === "je" && /^[aeiouyéèêâîô]/i.test(form) ? "j'" : p + " ");
  const normTxt = (s) => String(s).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
  const stripAcc = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  function conjugaison(level) {
    const tenses = level === 1 ? ["pr", "fu"] : level === 2 ? ["pr", "im", "fu"] : ["pr", "im", "fu", "pc"];
    const pool = level === 1 ? ER.slice(0, 12).concat(["être", "avoir", "aller", "faire"]) : ER.concat(IR, Object.keys(IRR));
    const verb = pick(pool), t = pick(tenses), i = R(0, 5), f = conjForms(verb);
    const label = { pr: "au présent", im: "à l'imparfait", fu: "au futur simple", pc: "au passé composé" }[t];
    let answers;
    if (t === "pc") {
      const aux = AUX[f.aux][i];
      if (f.aux === "être") {
        const pp = f.pp, plural = i >= 3;
        const forms = i === 2 ? [pp] : i === 5 ? [pp + "s"] : i === 4 ? [pp, pp + "e", pp + "s", pp + "es"] : plural ? [pp + "s", pp + "es"] : [pp, pp + "e"];
        answers = forms.map((x) => `${aux} ${x}`);
      } else answers = [`${aux} ${f.pp}`];
    } else answers = [f[t][i]];
    const shown = pron(P[i], answers[0]);
    return {
      prompt: `${shown.trim() === "j'" ? "j'…" : P[i] + " …"}`, sub: `Conjugue « ${verb} » ${label}`, kind: "input",
      answer: (shown === "j'" ? "j'" : P[i] + " ") + answers[0],
      check: (txt) => {
        let x = normTxt(txt).replace(/^(je |j'|tu |il |elle |on |nous |vous |ils |elles )/, "");
        return answers.some((a) => normTxt(a) === x);
      },
      near: (txt) => { const x = stripAcc(normTxt(txt).replace(/^(je |j'|tu |il |elle |nous |vous |ils |elles )/, "")); return answers.some((a) => stripAcc(normTxt(a)) === x); },
      hint: "Écris seulement le verbe conjugué (ex. : chantons)",
    };
  }

  /* ---------- homophones ---------- */
  const HOMO = [
    ["Léa ___ un nouveau vélo.", "a", ["a", "à"], "On peut dire « avait » → a"],
    ["Nous allons ___ la piscine.", "à", ["a", "à"], "On ne peut pas dire « avait » → à"],
    ["Il ___ mangé toute la tarte.", "a", ["a", "à"], "« Il avait mangé » → a"],
    ["Je pense ___ mes vacances.", "à", ["a", "à"], ""],
    ["Mon frère ___ peur du noir.", "a", ["a", "à"], "« Mon frère avait peur » → a"],
    ["Elle habite ___ Liège.", "à", ["a", "à"], ""],
    ["Le chat ___ sur le canapé.", "est", ["et", "est"], "« Le chat était » → est"],
    ["J'ai acheté du pain ___ du fromage.", "et", ["et", "est"], "« et puis » → et"],
    ["Ma sœur ___ plus grande que moi.", "est", ["et", "est"], "« Ma sœur était » → est"],
    ["Tom ___ Lina jouent au parc.", "et", ["et", "est"], ""],
    ["Ce livre ___ passionnant.", "est", ["et", "est"], ""],
    ["Les enfants ___ dans la cour.", "sont", ["son", "sont"], "« Les enfants étaient » → sont"],
    ["Il range ___ cartable.", "son", ["son", "sont"], "« le sien » → son"],
    ["Mes parents ___ partis tôt.", "sont", ["son", "sont"], ""],
    ["Elle a perdu ___ parapluie.", "son", ["son", "sont"], ""],
    ["Les élèves ___ terminé leur travail.", "ont", ["on", "ont"], "« Les élèves avaient » → ont"],
    ["___ ira au cinéma demain.", "On", ["On", "Ont"], "« Il ira » → on"],
    ["Mes cousins ___ un grand jardin.", "ont", ["on", "ont"], ""],
    ["Le soir, ___ regarde un film.", "on", ["on", "ont"], "« il regarde » → on"],
    ["Lucas range ___ jouets dans sa chambre.", "ses", ["ses", "ces", "c'est", "s'est"], "les siens → ses"],
    ["Regarde ___ nuages, il va pleuvoir !", "ces", ["ses", "ces", "c'est", "s'est"], "ceux-là → ces"],
    ["___ mon meilleur ami.", "C'est", ["Ses", "Ces", "C'est", "S'est"], "« Cela est » → c'est"],
    ["Elle ___ levée très tôt.", "s'est", ["ses", "ces", "c'est", "s'est"], "verbe « se lever » → s'est"],
    ["Il ___ lave les mains.", "se", ["ce", "se"], "verbe « se laver » → se"],
    ["___ matin, il fait froid.", "Ce", ["Ce", "Se"], "« ce matin-là » → ce"],
    ["Ils ___ promènent au bord de l'eau.", "se", ["ce", "se"], ""],
    ["J'aime beaucoup ___ dessin.", "ce", ["ce", "se"], ""],
    ["Veux-tu de l'eau ___ du jus ?", "ou", ["ou", "où"], "« ou bien » → ou"],
    ["___ as-tu caché la clé ?", "Où", ["Ou", "Où"], "question de lieu → où"],
    ["La ville ___ je suis né est petite.", "où", ["ou", "où"], "lieu → où"],
    ["Tu viens à pied ___ à vélo ?", "ou", ["ou", "où"], ""],
    ["Le chien est ___, sous la table.", "là", ["la", "l'a", "là"], "lieu → là"],
    ["Ferme ___ porte, s'il te plaît.", "la", ["la", "l'a", "là"], "déterminant → la"],
    ["Il voulait venir, ___ il était malade.", "mais", ["mes", "mais", "met"], "opposition → mais"],
    ["J'ai oublié ___ lunettes.", "mes", ["mes", "mais", "met"], "les miennes → mes"],
    ["Elle ___ la table pour le souper.", "met", ["mes", "mais", "met"], "verbe mettre → met"],
    ["Nous avons rendu ___ livres à la bibliothèque.", "leurs", ["leur", "leurs"], "plusieurs livres → leurs"],
    ["Je ___ ai donné un conseil.", "leur", ["leur", "leurs"], "devant un verbe : leur (invariable)"],
  ];
  function homophones() {
    const h = pick(HOMO);
    return { prompt: h[0].replace("___", "……"), sub: "Choisis le bon mot", kind: "choice", answer: h[1], choices: h[2], explain: h[3] };
  }

  const LIST = [
    { id: "tables", title: "Tables de multiplication", icon: "✖️", group: "math", gen: tables },
    { id: "mental", title: "Calcul mental", icon: "🧠", group: "math", gen: mental },
    { id: "pow10", title: "× et : par 10, 100, 1 000", icon: "🔟", group: "math", gen: pow10 },
    { id: "fractions", title: "Fractions et pourcentages", icon: "🍕", group: "math", gen: fractions },
    { id: "rounding", title: "Arrondis", icon: "🎯", group: "math", gen: rounding },
    { id: "compare", title: "Comparer des décimaux", icon: "⚖️", group: "math", gen: compare },
    { id: "convert", title: "Conversions (m, g, l)", icon: "📏", group: "math", gen: convert },
    { id: "durations", title: "Durées et heures", icon: "⏰", group: "math", gen: durations },
    { id: "areas", title: "Périmètres et aires", icon: "⬛", group: "math", gen: areas },
    { id: "conjugaison", title: "Conjugaison", icon: "✍️", group: "francais", gen: conjugaison },
    { id: "homophones", title: "Homophones (a/à, et/est…)", icon: "🔤", group: "francais", gen: homophones },
  ];

  function checkAnswer(q, txt) {
    if (q.check) return q.check(txt);
    if (q.kind === "choice") return txt === q.answer;
    const clean = String(txt).replace(/[a-zA-Zµ²³]+$/g, "").trim();
    if (/^[-\d\s.,]+$/.test(String(q.answer))) return numEq(clean, q.answer);
    return normTxt(txt) === normTxt(q.answer);
  }

  window.Drills = { LIST, checkAnswer, _test: { dec, decStr, decShift, numEq, conjForms } };
})();
