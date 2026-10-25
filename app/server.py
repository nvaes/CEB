#!/usr/bin/env python3
"""
Serveur du site « Révision CEB » — bibliothèque standard Python uniquement.

- sert l'interface web (app/web), les pages rendues (/data/pages) et les PDF d'origine
- expose une petite API JSON pour les profils enfants et leur progression (SQLite)
- lance la (re)construction du catalogue en arrière-plan au démarrage
"""
import hashlib
import hmac
import ipaddress
import json
import secrets
import mimetypes
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "app", "web")
BUILDER = os.path.join(ROOT, "builder", "build.py")
PDF_DIR = os.environ.get("CEB_PDF_DIR", os.path.join(ROOT, "pdf"))
DATA_DIR = os.environ.get("CEB_DATA_DIR", os.path.join(ROOT, "data"))
PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = os.path.join(DATA_DIR, "ceb.sqlite")
UPLOAD_DIR = os.path.join(DATA_DIR, "pdf")
MAX_UPLOAD = int(os.environ.get("CEB_MAX_UPLOAD_MB", "250")) * 1024 * 1024
KINDS = {"questionnaire": "questionnaire", "correction": "correction", "portfolio": "portfolio"}
CATALOG = os.path.join(DATA_DIR, "catalog.json")
# sécurité : journal des authentifications (lu par fail2ban sur l'hôte) et état fail2ban (écrit par l'hôte)
SEC_DIR = os.path.join(DATA_DIR, "security")
AUTH_LOG = os.path.join(SEC_DIR, "auth.log")
F2B_STATUS = os.path.join(SEC_DIR, "fail2ban.json")
F2B_UNBAN = os.path.join(SEC_DIR, "unban.json")
TRUST_PROXY = os.environ.get("CEB_TRUST_PROXY", "").lower() in ("1", "true", "yes", "oui")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")

# ------------------------------------------------------------------ construction
BUILD = {"running": False, "log": [], "started": None, "finished": None, "rc": None}
_build_lock = threading.Lock()


def run_build(force=False):
    with _build_lock:
        if BUILD["running"]:
            return False
        BUILD.update(running=True, log=[], started=time.time(), finished=None, rc=None)

    def work():
        cmd = [sys.executable, "-u", BUILDER, "--pdf", PDF_DIR + os.pathsep + UPLOAD_DIR, "--out", DATA_DIR]
        if force:
            cmd.append("--force")
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                 cwd=os.path.dirname(BUILDER))
            for line in p.stdout:
                print(line, end="", flush=True)
                BUILD["log"] = (BUILD["log"] + [line.rstrip()])[-200:]
            BUILD["rc"] = p.wait()
        except Exception as e:  # pragma: no cover
            BUILD["log"].append(f"ERREUR : {e!r}")
            BUILD["rc"] = -1
        finally:
            BUILD["running"] = False
            BUILD["finished"] = time.time()
            _catalog_cache.clear()

    threading.Thread(target=work, daemon=True).start()
    return True


_catalog_cache = {}


def catalog_bytes():
    try:
        st = os.stat(CATALOG)
    except FileNotFoundError:
        return None, None
    key = (st.st_mtime, st.st_size)
    if _catalog_cache.get("key") != key:
        with open(CATALOG, "rb") as f:
            data = f.read()
        _catalog_cache.update(key=key, data=data, etag=hashlib.md5(data).hexdigest())
    return _catalog_cache["data"], _catalog_cache["etag"]


# ------------------------------------------------------------------ base de données
SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, avatar TEXT, color TEXT,
  created REAL NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS attempts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile INTEGER NOT NULL, qid TEXT NOT NULL,
  score REAL NOT NULL, max REAL NOT NULL, mode TEXT, seconds INTEGER, ts REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_att ON attempts(profile, qid);
CREATE TABLE IF NOT EXISTS exams(
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile INTEGER NOT NULL, year TEXT, livret INTEGER,
  subject TEXT, score REAL, max REAL, seconds INTEGER, detail TEXT, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS drills(
  id INTEGER PRIMARY KEY AUTOINCREMENT, profile INTEGER NOT NULL, kind TEXT, level TEXT,
  correct INTEGER, total INTEGER, seconds INTEGER, mistakes TEXT, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS notes(
  profile INTEGER NOT NULL, qid TEXT NOT NULL, flag INTEGER DEFAULT 0, note TEXT,
  ts REAL, PRIMARY KEY(profile, qid));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS parents(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, pin TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent', created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS devices(
  key TEXT PRIMARY KEY, parent INTEGER NOT NULL, created REAL NOT NULL, label TEXT);
CREATE TABLE IF NOT EXISTS tokens(
  token TEXT PRIMARY KEY, profile INTEGER NOT NULL, created REAL NOT NULL, last REAL);
CREATE TABLE IF NOT EXISTS answers(
  profile INTEGER NOT NULL, qid TEXT NOT NULL, data TEXT, ts REAL, PRIMARY KEY(profile, qid));
"""
_db_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(SEC_DIR, exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)
        cols = [r[1] for r in con.execute("PRAGMA table_info(profiles)")]
        if "code" not in cols:  # migration : code secret par enfant
            con.execute("ALTER TABLE profiles ADD COLUMN code TEXT")
        if "family" not in cols:  # migration : enfant rattaché à une famille (compte parent)
            con.execute("ALTER TABLE profiles ADD COLUMN family INTEGER")
        if "parent" not in [r[1] for r in con.execute("PRAGMA table_info(tokens)")]:
            con.execute("ALTER TABLE tokens ADD COLUMN parent INTEGER")
        # migration : l'ancien code parent unique devient le compte administrateur
        if not con.execute("SELECT id FROM parents LIMIT 1").fetchone():
            old = con.execute("SELECT value FROM settings WHERE key='pin'").fetchone()
            if old and old[0]:
                cur = con.execute("INSERT INTO parents(name,pin,role,created) VALUES(?,?,?,?)",
                                  ("Administrateur", "sha256$" + old[0], "admin", time.time()))
                con.execute("UPDATE profiles SET family=? WHERE family IS NULL", (cur.lastrowid,))
                con.execute("DELETE FROM tokens WHERE profile=0")


def rows(sql, args=()):
    with db() as con:
        return [dict(r) for r in con.execute(sql, args).fetchall()]


def execute(sql, args=()):
    with _db_lock, db() as con:
        cur = con.execute(sql, args)
        return cur.lastrowid


def get_setting(key, default=None):
    r = rows("SELECT value FROM settings WHERE key=?", (key,))
    return r[0]["value"] if r else default


def set_setting(key, value):
    execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value))


def list_pdfs():
    out = []
    for origin, d in (("dossier", PDF_DIR), ("téléversé", UPLOAD_DIR)):
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.lower().endswith(".pdf"):
                    st = os.stat(os.path.join(d, f))
                    out.append({"name": f, "origin": origin, "size": st.st_size, "mtime": st.st_mtime})
    return out


def pdf_path(name):
    for d in (UPLOAD_DIR, PDF_DIR):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            return p
    return None


# ------------------------------------------------------------------ codes enfants
CODE_RE = re.compile(r"\d{6}")  # tout nouveau code (enfant ou parent) : exactement 6 chiffres
TOKEN_DAYS = int(os.environ.get("CEB_TOKEN_DAYS", "60"))
_fails = {}  # profil -> (nombre d'échecs, verrouillé jusqu'à)
PUBLIC_PROFILE = "id, name, avatar, color, created, (code IS NOT NULL AND code <> '') AS has_code"


def code_hash(code, salt=None):
    salt = salt or secrets.token_hex(8)
    h = hashlib.pbkdf2_hmac("sha256", str(code).encode(), bytes.fromhex(salt), 60000).hex()
    return f"{salt}${h}"


def code_ok(code, stored):
    if not stored or "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(code_hash(code, salt), stored)


def new_token(pid):
    tok = secrets.token_urlsafe(24)
    execute("INSERT INTO tokens(token,profile,created,last) VALUES(?,?,?,?)", (tok, pid, time.time(), time.time()))
    return tok


PARENT_HOURS = float(os.environ.get("CEB_PARENT_HOURS", "4"))


def token_profile(tok):
    """Profil associé à un jeton (0 = session parent), ou None si invalide/expiré."""
    if not tok:
        return None
    r = rows("SELECT profile, created FROM tokens WHERE token=?", (tok,))
    if not r:
        return None
    ttl = PARENT_HOURS * 3600 if r[0]["profile"] == 0 else TOKEN_DAYS * 86400
    if time.time() - r[0]["created"] > ttl:
        execute("DELETE FROM tokens WHERE token=?", (tok,))
        return None
    return r[0]["profile"]


def public_profile(pid):
    r = rows(f"SELECT {PUBLIC_PROFILE} FROM profiles WHERE id=?", (pid,))
    if r:
        r[0]["has_code"] = bool(r[0]["has_code"])
    return r[0] if r else None


def pin_hash(pin):
    return hashlib.sha256(("ceb-local:" + str(pin)).encode()).hexdigest()


# ------------------------------------------------------------------ comptes parents (familles)
PIN_RE = CODE_RE
CODE_MSG = "le code doit contenir exactement 6 chiffres"


def verify_pin(pin, stored):
    if not stored or not pin:
        return False
    if stored.startswith("sha256$"):  # ancien code parent (avant les familles)
        return hmac.compare_digest(pin_hash(pin), stored[7:])
    return code_ok(pin, stored)


def find_parent_by_pin(pin):
    if not pin:
        return None
    for p in rows("SELECT id, name, role, pin FROM parents"):
        if verify_pin(pin, p["pin"]):
            if p["pin"].startswith("sha256$"):  # renforce le hachage au passage
                execute("UPDATE parents SET pin=? WHERE id=?", (code_hash(pin), p["id"]))
            return {k: p[k] for k in ("id", "name", "role")}
    return None


def parent_info(pid):
    r = rows("SELECT id, name, role FROM parents WHERE id=?", (pid,))
    return r[0] if r else None


def new_parent_token(parent_id):
    tok = secrets.token_urlsafe(24)
    execute("INSERT INTO tokens(token,profile,parent,created,last) VALUES(?,?,?,?,?)",
            (tok, 0, parent_id, time.time(), time.time()))
    return tok


def token_parent(tok):
    if not tok or token_profile(tok) != 0:
        return None
    r = rows("SELECT parent FROM tokens WHERE token=?", (tok,))
    return parent_info(r[0]["parent"]) if r and r[0]["parent"] else None


# ------------------------------------------------------------------ journal de sécurité (fail2ban)
_log_lock = threading.Lock()
AUTH_RE = re.compile(r"^(\S+ \S+) CEB-AUTH (OK|FAIL) ip=(\S+) kind=(\S+) who=(.*)$")


def auth_event(ok, ip, kind, who=""):
    """Une ligne par tentative ; fail2ban (sur l'hôte) bannit les IP qui accumulent les FAIL."""
    who = re.sub(r"[^\w .@#'-]", "?", str(who or "-"))[:60]
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} CEB-AUTH {'OK' if ok else 'FAIL'} ip={ip} kind={kind} who={who}\n"
    if not ok:
        print("[auth] " + line, end="", flush=True)
    try:
        with _log_lock, open(AUTH_LOG, "a") as f:
            f.write(line)
    except OSError as e:  # pragma: no cover
        print(f"[auth] journal indisponible : {e!r}", flush=True)


def tail_lines(path, n=400, block=65536):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - block * 4))
            return f.read().decode("utf-8", "replace").splitlines()[-n:]
    except FileNotFoundError:
        return []


def security_report():
    events = []
    for line in tail_lines(AUTH_LOG, 2000):
        m = AUTH_RE.match(line)
        if m:
            events.append({"ts": m[1], "ok": m[2] == "OK", "ip": m[3], "kind": m[4], "who": m[5]})
    since = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(time.time() - 86400))
    day = [e for e in events if e["ts"] >= since]
    top = {}
    for e in day:
        if not e["ok"]:
            top[e["ip"]] = top.get(e["ip"], 0) + 1
    f2b, age = None, None
    try:
        with open(F2B_STATUS) as f:
            f2b = json.load(f)
        age = int(time.time() - os.stat(F2B_STATUS).st_mtime)
    except (OSError, ValueError):
        pass
    try:
        with open(F2B_UNBAN) as f:
            pending = json.load(f)
    except (OSError, ValueError):
        pending = []
    return {"fail2ban": f2b, "age": age, "events": events[-150:][::-1], "pending": pending,
            "day": {"fail": sum(not e["ok"] for e in day), "ok": sum(e["ok"] for e in day),
                    "top": sorted(top.items(), key=lambda kv: -kv[1])[:10]}}


def request_unban(ip, by):
    with _log_lock:
        try:
            with open(F2B_UNBAN) as f:
                pending = json.load(f)
        except (OSError, ValueError):
            pending = []
        if ip not in [p.get("ip") for p in pending]:
            pending.append({"ip": ip, "ts": time.time(), "by": by})
        tmp = F2B_UNBAN + ".part"
        with open(tmp, "w") as f:
            json.dump(pending, f)
        os.replace(tmp, F2B_UNBAN)


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "RevisionCEB/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # journal discret
        if os.environ.get("CEB_ACCESS_LOG"):
            super().log_message(fmt, *args)

    # -- réponses
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def error(self, status, msg):
        self.send_json({"error": msg}, status)

    def send_file(self, path, cache="no-cache"):
        try:
            st = os.stat(path)
        except (FileNotFoundError, NotADirectoryError):
            return self.error(404, "introuvable")
        etag = f'"{int(st.st_mtime)}-{st.st_size}"'
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript") or ctype.endswith("json"):
            ctype += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(st.st_size))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if self.command != "HEAD":
            with open(path, "rb") as f:
                while chunk := f.read(256 * 1024):
                    self.wfile.write(chunk)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("requête trop volumineuse")
        raw = self.rfile.read(n) if n else b"{}"
        return json.loads(raw or b"{}")

    def client_ip(self):
        ip = self.client_address[0]
        if TRUST_PROXY and self.headers.get("X-Forwarded-For"):
            ip = self.headers["X-Forwarded-For"].split(",")[-1].strip()  # ajouté par le proxy de confiance
        if ip.startswith("::ffff:"):
            ip = ip[7:]
        try:
            return str(ipaddress.ip_address(ip))
        except ValueError:
            return "0.0.0.0"

    def auth(self, ok, kind, who=""):
        auth_event(ok, self.client_ip(), kind, who)

    def parent(self):
        """Compte parent de la session (jeton X-Parent-Token ou ?ptoken=), ou None."""
        if not hasattr(self, "_parent"):
            tok = self.headers.get("X-Parent-Token") or (getattr(self, "_qs", {}).get("ptoken") or [""])[0]
            self._parent = token_parent(tok)
        return self._parent

    def parent_ok(self, data=None):
        """Session parent, ou code parent fourni dans la requête (compatibilité)."""
        p = self.parent()
        if p or not data or not data.get("pin"):
            return p
        p = find_parent_by_pin(str(data["pin"]))
        self.auth(bool(p), "parent-pin", p["name"] if p else "")
        return p

    def is_admin(self, data=None):
        p = self.parent_ok(data)
        return bool(p) and p["role"] == "admin"

    def can_access(self, prof):
        """Un parent ne voit que les enfants de sa famille ; l'administrateur voit tout."""
        p = self.parent()
        return bool(p) and (p["role"] == "admin" or prof["family"] == p["id"])

    def device_family(self):
        key = self.headers.get("X-Family-Key") or (getattr(self, "_qs", {}).get("fkey") or [""])[0]
        if not key:
            return None
        r = rows("SELECT parent FROM devices WHERE key=?", (key,))
        return r[0]["parent"] if r else None

    def profile_token(self, qs=None):
        tok = self.headers.get("X-Profile-Token") or ""
        if not tok and qs:
            tok = (qs.get("token") or [""])[0]
        return tok

    # -- routage
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p = urllib.parse.unquote(u.path)
        if p.startswith("/api/"):
            return self.api("GET", p, urllib.parse.parse_qs(u.query))
        if p.startswith("/pages/"):
            rel = os.path.normpath(p[len("/pages/"):])
            if rel.startswith("..") or not re.fullmatch(r"\d{4}/[qcp]/\d+\.jpg", rel):
                return self.error(404, "introuvable")
            return self.send_file(os.path.join(DATA_DIR, "pages", rel), "public, max-age=604800")
        if p.startswith("/pdf/"):
            name = os.path.basename(p)
            if not re.fullmatch(r"\d{4}_CEB_\w+\.pdf", name, re.I):
                return self.error(404, "introuvable")
            return self.send_file(pdf_path(name) or os.path.join(PDF_DIR, name), "public, max-age=86400")
        if p in ("/", "") or not os.path.splitext(p)[1]:
            return self.send_file(os.path.join(WEB, "index.html"))
        rel = os.path.normpath(p.lstrip("/"))
        if rel.startswith(".."):
            return self.error(404, "introuvable")
        return self.send_file(os.path.join(WEB, rel))

    def do_POST(self):
        self.api("POST", urllib.parse.urlparse(self.path).path, {})

    def do_PUT(self):
        self.api("PUT", urllib.parse.urlparse(self.path).path, {})

    def do_DELETE(self):
        self.api("DELETE", urllib.parse.urlparse(self.path).path, {})

    def api(self, method, path, qs):
        self.__dict__.pop("_parent", None)  # connexion keep-alive : rien ne doit survivre d'une requête à l'autre
        self._qs = qs
        if method == "POST" and path.rstrip("/") == "/api/upload":
            return self.upload(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
        try:
            data = self.body() if method in ("POST", "PUT", "DELETE") else (
                {"pin": qs["pin"][0]} if qs.get("pin") else {})
        except Exception:
            return self.error(400, "JSON invalide")
        try:
            return self.route(method, path.rstrip("/"), data, qs)
        except Exception as e:  # pragma: no cover
            import traceback
            traceback.print_exc()
            return self.error(500, str(e))

    def upload(self, qs):
        """Téléversement brut d'un PDF : POST /api/upload?year=2026&kind=questionnaire (corps = PDF)."""
        year = (qs.get("year") or [""])[0]
        kind = KINDS.get((qs.get("kind") or [""])[0])
        n = int(self.headers.get("Content-Length") or 0)
        self._qs = qs
        if not self.is_admin({"pin": self.headers.get("X-Pin", "")}):
            self.rfile.read(n)
            return self.error(403, "réservé à l'administrateur")
        if not re.fullmatch(r"20\d\d", year) or not kind:
            self.rfile.read(n)
            return self.error(400, "année (AAAA) et type (questionnaire, correction, portfolio) requis")
        if n <= 0 or n > MAX_UPLOAD:
            self.rfile.read(n)
            return self.error(413, f"fichier vide ou trop volumineux (max {MAX_UPLOAD // 1048576} Mo)")
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        name = f"{year}_CEB_{kind}.pdf"
        tmp = os.path.join(UPLOAD_DIR, "." + name + ".part")
        left, head = n, b""
        with open(tmp, "wb") as f:
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                if not head:
                    head = chunk[:5]
                f.write(chunk)
                left -= len(chunk)
        if left or head != b"%PDF-":
            os.remove(tmp)
            return self.error(400, "ce fichier n'est pas un PDF valide")
        # remplace une éventuelle version téléversée précédente (casse différente comprise)
        for f in os.listdir(UPLOAD_DIR):
            if f.lower() == name.lower():
                os.remove(os.path.join(UPLOAD_DIR, f))
        os.replace(tmp, os.path.join(UPLOAD_DIR, name))
        return self.send_json({"ok": True, "name": name, "size": n}, 201)

    def route(self, method, path, data, qs):
        parts = path.split("/")[2:]  # après /api
        head = parts[0] if parts else ""
        self._qs = qs

        if head == "status" and method == "GET":
            cat = os.path.exists(CATALOG)
            return self.send_json({"ready": cat, "building": BUILD["running"], "log": BUILD["log"][-30:],
                                   "rc": BUILD["rc"], "pdf_dir": PDF_DIR,
                                   "upload_dir": UPLOAD_DIR, "pdfs": [p["name"] for p in list_pdfs()],
                                   "files": list_pdfs()})
        if head == "catalog" and method == "GET":
            data_, etag = catalog_bytes()
            if data_ is None:
                return self.error(503, "catalogue en préparation")
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data_)))
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data_)
            return

        # ------------------------------------------------------------ comptes parents / familles
        if head == "parent" and len(parts) == 2:
            act = parts[1]
            if act == "setup" and method == "POST":  # premier compte = administrateur
                if rows("SELECT id FROM parents LIMIT 1"):
                    return self.error(409, "un code parent existe déjà")
                np_ = str(data.get("new_pin") or "")
                if not PIN_RE.fullmatch(np_):
                    return self.error(400, CODE_MSG)
                name = (str(data.get("name") or "").strip() or "Administrateur")[:40]
                aid = execute("INSERT INTO parents(name,pin,role,created) VALUES(?,?,?,?)",
                              (name, code_hash(np_), "admin", time.time()))
                execute("UPDATE profiles SET family=? WHERE family IS NULL", (aid,))
                return self.send_json({"token": new_parent_token(aid), "parent": parent_info(aid)})
            if act == "login" and method == "POST":
                if not rows("SELECT id FROM parents LIMIT 1"):
                    return self.error(412, "aucun code parent défini")
                n, until = _fails.get("parent", (0, 0))
                if until > time.time():
                    self.auth(False, "parent-blocked")
                    return self.error(429, f"trop d'essais : réessaie dans {int(until - time.time()) + 1} s")
                pin = str(data.get("pin") or "")
                p = find_parent_by_pin(pin)
                self.auth(bool(p), "parent", p["name"] if p else "")
                if p:
                    _fails.pop("parent", None)
                    # ancien code (autre que 6 chiffres) : accepté, mais il faut en choisir un nouveau
                    return self.send_json({"token": new_parent_token(p["id"]), "parent": parent_info(p["id"]),
                                           "hours": PARENT_HOURS, "upgrade": not CODE_RE.fullmatch(pin)})
                n += 1
                _fails["parent"] = (n, time.time() + 30 * (n - 4)) if n >= 5 else (n, 0)
                return self.error(403, "code parent incorrect")
            if act == "logout" and method == "POST":
                tok = self.headers.get("X-Parent-Token", "")
                if tok:
                    execute("DELETE FROM tokens WHERE token=? AND profile=0", (tok,))
                return self.send_json({"ok": True})
            if act == "check" and method == "POST":
                p = self.parent()
                return self.send_json({"ok": bool(p), "parent": parent_info(p["id"]) if p else None})
            if act == "children" and method == "GET":
                p = self.parent()
                if not p:
                    return self.error(403, "code parent incorrect")
                sql = "SELECT p.id, p.name, p.avatar, p.color, p.created, (p.code IS NOT NULL AND p.code <> '') AS has_code, " \
                      "p.family AS family, pa.name AS family_name FROM profiles p " \
                      "LEFT JOIN parents pa ON pa.id = p.family WHERE p.archived=0"
                out = rows(sql + " ORDER BY pa.name, p.id") if p["role"] == "admin" else \
                    rows(sql + " AND p.family=? ORDER BY p.id", (p["id"],))
                for c in out:
                    c["has_code"] = bool(c["has_code"])
                return self.send_json(out)

        if head == "parents":
            p = self.parent()
            if not p:
                return self.error(403, "code parent incorrect")
            if len(parts) == 1:
                if p["role"] != "admin":
                    return self.error(403, "réservé à l'administrateur")
                if method == "GET":
                    return self.send_json(rows("SELECT pa.id, pa.name, pa.role, pa.created, "
                                               "(SELECT COUNT(*) FROM profiles WHERE family=pa.id) AS children "
                                               "FROM parents pa ORDER BY pa.role, pa.name"))
                if method == "POST":
                    name = str(data.get("name") or "").strip()[:40]
                    np_ = str(data.get("pin") or "")
                    if not name:
                        return self.error(400, "nom de la famille requis")
                    if not PIN_RE.fullmatch(np_):
                        return self.error(400, CODE_MSG)
                    if find_parent_by_pin(np_):
                        return self.error(409, "ce code est déjà utilisé par une autre famille, choisis-en un autre")
                    nid = execute("INSERT INTO parents(name,pin,role,created) VALUES(?,?,?,?)",
                                  (name, code_hash(np_), "parent", time.time()))
                    return self.send_json(parent_info(nid), 201)
            tid = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            if tid is None or not rows("SELECT id FROM parents WHERE id=?", (tid,)):
                return self.error(404, "famille inconnue")
            if p["role"] != "admin" and tid != p["id"]:
                return self.error(403, "réservé à l'administrateur")
            if method == "PUT":
                if data.get("name"):
                    execute("UPDATE parents SET name=? WHERE id=?", (str(data["name"]).strip()[:40], tid))
                if data.get("pin") is not None and data.get("pin") != "":
                    np_ = str(data["pin"])
                    if not PIN_RE.fullmatch(np_):
                        return self.error(400, CODE_MSG)
                    other = find_parent_by_pin(np_)
                    if other and other["id"] != tid:
                        return self.error(409, "ce code est déjà utilisé par une autre famille, choisis-en un autre")
                    execute("UPDATE parents SET pin=? WHERE id=?", (code_hash(np_), tid))
                    execute("DELETE FROM tokens WHERE profile=0 AND parent=? AND token<>?",
                            (tid, self.headers.get("X-Parent-Token", "")))
                return self.send_json(parent_info(tid))
            if method == "DELETE":
                if p["role"] != "admin" or tid == p["id"]:
                    return self.error(403, "impossible de supprimer ce compte")
                if rows("SELECT id FROM profiles WHERE family=? LIMIT 1", (tid,)):
                    return self.error(409, "supprime d'abord les enfants de cette famille")
                execute("DELETE FROM tokens WHERE profile=0 AND parent=?", (tid,))
                execute("DELETE FROM devices WHERE parent=?", (tid,))
                execute("DELETE FROM parents WHERE id=?", (tid,))
                return self.send_json({"ok": True})

        if head == "family" and len(parts) == 2:
            act = parts[1]
            if act == "bind" and method == "POST":  # associe cette tablette à la famille du parent connecté
                p = self.parent() or find_parent_by_pin(str(data.get("pin") or ""))
                if not p:
                    return self.error(403, "code parent incorrect")
                key = secrets.token_urlsafe(24)
                execute("INSERT INTO devices(key,parent,created,label) VALUES(?,?,?,?)",
                        (key, p["id"], time.time(), str(data.get("label") or "")[:60]))
                return self.send_json({"key": key, "family": parent_info(p["id"])})
            if act == "info" and method == "GET":
                fam = self.device_family()
                if fam is None:
                    return self.error(404, "tablette non associée")
                return self.send_json({"family": parent_info(fam)})
            if act == "unbind" and method == "POST":
                execute("DELETE FROM devices WHERE key=?", (self.headers.get("X-Family-Key", ""),))
                return self.send_json({"ok": True})

        if head == "security":
            if not self.is_admin():
                return self.error(403, "réservé à l'administrateur")
            if len(parts) == 1 and method == "GET":
                return self.send_json(security_report())
            if len(parts) == 2 and parts[1] == "unban" and method == "POST":
                ip = str(data.get("ip") or "").strip()
                if ip != "all":  # « all » : débloque toutes les adresses de toutes les prisons
                    try:
                        ip = str(ipaddress.ip_address(ip))
                    except ValueError:
                        return self.error(400, "adresse IP invalide")
                request_unban(ip, self.parent()["name"])
                return self.send_json({"ok": True, "ip": ip})

        if head == "rebuild" and method == "POST":
            if not self.is_admin(data):
                return self.error(403, "réservé à l'administrateur")
            return self.send_json({"started": run_build(force=True)})

        if head == "settings":
            if method == "GET":
                return self.send_json({"pin": bool(rows("SELECT id FROM parents LIMIT 1")),
                                       "prefs": json.loads(get_setting("prefs", "{}"))})
            if method == "PUT":
                p = self.parent_ok(data)
                if not p:
                    return self.error(403, "code parent incorrect")
                if data.get("new_pin"):
                    np_ = str(data["new_pin"])
                    if not PIN_RE.fullmatch(np_):
                        return self.error(400, CODE_MSG)
                    other = find_parent_by_pin(np_)
                    if other and other["id"] != p["id"]:
                        return self.error(409, "ce code est déjà utilisé par une autre famille, choisis-en un autre")
                    execute("UPDATE parents SET pin=? WHERE id=?", (code_hash(np_), p["id"]))
                if "prefs" in data and p["role"] == "admin":
                    set_setting("prefs", json.dumps(data["prefs"]))
                return self.send_json({"ok": True})
        if head == "uploads" and method == "DELETE" and len(parts) == 2:
            if not self.is_admin(data):
                return self.error(403, "réservé à l'administrateur")
            name = os.path.basename(parts[1])
            fp = os.path.join(UPLOAD_DIR, name)
            if not os.path.isfile(fp):
                return self.error(404, "fichier téléversé introuvable")
            os.remove(fp)
            return self.send_json({"ok": True})

        if head == "yearconfig" and len(parts) == 2 and re.fullmatch(r"\d{4}", parts[1]):
            y = parts[1]
            local_path = os.path.join(DATA_DIR, "years.local.json")
            local = json.load(open(local_path)) if os.path.exists(local_path) else {}
            if method == "GET":
                base = json.load(open(os.path.join(ROOT, "builder", "years.json"))).get(y, {})
                return self.send_json({"base": base, "local": local.get(y, {})})
            if method == "PUT":
                if not self.is_admin(data):
                    return self.error(403, "réservé à l'administrateur")
                cfg = data.get("config")
                if cfg is None:
                    local.pop(y, None)
                elif not isinstance(cfg, dict):
                    return self.error(400, "configuration invalide")
                else:
                    local[y] = cfg
                with open(local_path, "w") as f:
                    json.dump(local, f, ensure_ascii=False, indent=1)
                return self.send_json({"ok": True})
        if head == "profiles":
            if len(parts) == 1:
                if method == "GET":  # enfants de la famille associée à cette tablette
                    fam = self.device_family()
                    if fam is None:
                        return self.send_json([])
                    out = rows(f"SELECT {PUBLIC_PROFILE} FROM profiles WHERE archived=0 AND family=? ORDER BY id", (fam,))
                    for c in out:
                        c["has_code"] = bool(c["has_code"])
                    return self.send_json(out)
                if method == "POST":
                    p = self.parent_ok(data)
                    if not p:
                        return self.error(403, "code parent requis pour ajouter un enfant")
                    name = (data.get("name") or "").strip()[:40]
                    code = str(data.get("code") or "")
                    if not name:
                        return self.error(400, "prénom requis")
                    if not CODE_RE.fullmatch(code):
                        return self.error(400, "le code de l'enfant doit contenir exactement 6 chiffres")
                    fam = p["id"]
                    if p["role"] == "admin" and str(data.get("family") or "").isdigit() and \
                            rows("SELECT id FROM parents WHERE id=?", (int(data["family"]),)):
                        fam = int(data["family"])
                    pid = execute("INSERT INTO profiles(name,avatar,color,created,code,family) VALUES(?,?,?,?,?,?)",
                                  (name, str(data.get("avatar", "🦊"))[:8], str(data.get("color", "#4f6df5"))[:16],
                                   time.time(), code_hash(code), fam))
                    return self.send_json({**public_profile(pid), "token": new_token(pid)}, 201)
            pid = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            if pid is None or not rows("SELECT id FROM profiles WHERE id=?", (pid,)):
                return self.error(404, "profil inconnu")
            sub = parts[2] if len(parts) > 2 else ""
            prof = rows("SELECT code, family FROM profiles WHERE id=?", (pid,))[0]
            parent_access = self.can_access(prof)
            if sub == "login" and method == "POST":
                if self.device_family() != prof["family"] and not parent_access:
                    return self.error(403, "ce profil n'appartient pas à la famille de cette tablette")
                n, until = _fails.get(pid, (0, 0))
                if until > time.time():
                    self.auth(False, "child-blocked", f"#{pid}")
                    return self.error(429, f"trop d'essais : réessaie dans {int(until - time.time()) + 1} s")
                code = str(data.get("code") or "")
                if not prof["code"]:
                    # code réinitialisé par un parent : accès accordé, l'enfant doit choisir un nouveau code
                    return self.send_json({"token": new_token(pid), "needs_code": True})
                ok = code_ok(code, prof["code"])
                self.auth(ok, "child", f"#{pid}")
                if ok:
                    _fails.pop(pid, None)
                    up = not CODE_RE.fullmatch(code)  # ancien code à 4 ou 5 chiffres : à remplacer
                    return self.send_json({"token": new_token(pid), "needs_code": up, "upgrade": up})
                n += 1
                _fails[pid] = (n, time.time() + 30 * (n - 4)) if n >= 5 else (n, 0)
                return self.error(403, "code incorrect" + (" — accès bloqué 30 s" if n >= 5 else ""))
            if sub == "resetcode" and method == "POST":
                if not parent_access:
                    return self.error(403, "code parent incorrect")
                execute("UPDATE profiles SET code=NULL WHERE id=?", (pid,))
                execute("DELETE FROM tokens WHERE profile=?", (pid,))
                _fails.pop(pid, None)
                return self.send_json({"ok": True})
            parent_only = (sub == "" and method == "DELETE") or (sub == "reset" and method == "POST")
            authed = (token_profile(self.profile_token(qs)) == pid and not parent_only) or parent_access
            if not authed:
                return self.error(403 if parent_only else 401,
                                  "code parent incorrect" if parent_only else "code de l'enfant requis")
            if sub == "logout" and method == "POST":
                execute("DELETE FROM tokens WHERE token=?", (self.profile_token(qs),))
                return self.send_json({"ok": True})
            if sub == "setcode" and method == "POST":
                code = str(data.get("code") or "")
                if not CODE_RE.fullmatch(code):
                    return self.error(400, CODE_MSG)
                if prof["code"] and not code_ok(str(data.get("old") or ""), prof["code"]):
                    self.auth(False, "child-oldcode", f"#{pid}")
                    return self.error(403, "ancien code incorrect")
                execute("UPDATE profiles SET code=? WHERE id=?", (code_hash(code), pid))
                return self.send_json({"ok": True})
            if sub == "" and method == "PUT":
                execute("UPDATE profiles SET name=COALESCE(?,name), avatar=COALESCE(?,avatar), color=COALESCE(?,color) WHERE id=?",
                        (data.get("name"), data.get("avatar"), data.get("color"), pid))
                return self.send_json(public_profile(pid))
            if sub == "" and method == "DELETE":
                for t in ("attempts", "exams", "drills", "notes", "answers", "tokens"):
                    execute(f"DELETE FROM {t} WHERE profile=?", (pid,))
                execute("DELETE FROM profiles WHERE id=?", (pid,))
                return self.send_json({"ok": True})
            if sub == "reset" and method == "POST":
                for t in ("attempts", "exams", "drills", "notes", "answers"):
                    execute(f"DELETE FROM {t} WHERE profile=?", (pid,))
                return self.send_json({"ok": True})
            if sub == "state" and method == "GET":
                return self.send_json({
                    "attempts": rows("SELECT qid,score,max,mode,seconds,ts FROM attempts WHERE profile=? ORDER BY ts", (pid,)),
                    "exams": rows("SELECT id,year,livret,subject,score,max,seconds,detail,ts FROM exams WHERE profile=? ORDER BY ts", (pid,)),
                    "drills": rows("SELECT kind,level,correct,total,seconds,ts FROM drills WHERE profile=? ORDER BY ts", (pid,)),
                    "notes": rows("SELECT qid,flag,note,ts FROM notes WHERE profile=?", (pid,)),
                    "answers": {r["qid"]: json.loads(r["data"] or "{}") for r in
                                rows("SELECT qid,data FROM answers WHERE profile=?", (pid,))},
                })
            if sub == "answers" and method == "PUT":
                qid = str(data.get("qid", ""))
                if not re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", qid):
                    return self.error(400, "qid invalide")
                payload = json.dumps(data.get("data") or {}, ensure_ascii=False)
                if len(payload) > 200_000:
                    return self.error(413, "réponse trop volumineuse")
                execute("INSERT INTO answers(profile,qid,data,ts) VALUES(?,?,?,?) "
                        "ON CONFLICT(profile,qid) DO UPDATE SET data=excluded.data, ts=excluded.ts",
                        (pid, qid, payload, time.time()))
                return self.send_json({"ok": True})
            if sub == "attempts" and method == "POST":
                items = data.get("items") or [data]
                now = time.time()
                for it in items:
                    if not re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", str(it.get("qid", ""))):
                        return self.error(400, "qid invalide")
                    execute("INSERT INTO attempts(profile,qid,score,max,mode,seconds,ts) VALUES(?,?,?,?,?,?,?)",
                            (pid, it["qid"], float(it.get("score", 0)), float(it.get("max", 0)),
                             str(it.get("mode", ""))[:20], int(it.get("seconds") or 0), now))
                return self.send_json({"ok": True, "ts": now}, 201)
            if sub == "exams" and method == "POST":
                now = time.time()
                eid = execute("INSERT INTO exams(profile,year,livret,subject,score,max,seconds,detail,ts) VALUES(?,?,?,?,?,?,?,?,?)",
                              (pid, str(data.get("year")), int(data.get("livret") or 0), str(data.get("subject", "")),
                               float(data.get("score", 0)), float(data.get("max", 0)), int(data.get("seconds") or 0),
                               json.dumps(data.get("detail", {}))[:400000], now))
                return self.send_json({"ok": True, "id": eid, "ts": now}, 201)
            if sub == "drills" and method == "POST":
                now = time.time()
                execute("INSERT INTO drills(profile,kind,level,correct,total,seconds,mistakes,ts) VALUES(?,?,?,?,?,?,?,?)",
                        (pid, str(data.get("kind", ""))[:40], str(data.get("level", ""))[:20],
                         int(data.get("correct", 0)), int(data.get("total", 0)), int(data.get("seconds") or 0),
                         json.dumps(data.get("mistakes", []))[:5000], now))
                return self.send_json({"ok": True, "ts": now}, 201)
            if sub == "notes" and method == "PUT":
                qid = str(data.get("qid", ""))
                if not re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", qid):
                    return self.error(400, "qid invalide")
                execute("INSERT INTO notes(profile,qid,flag,note,ts) VALUES(?,?,?,?,?) "
                        "ON CONFLICT(profile,qid) DO UPDATE SET flag=excluded.flag, note=excluded.note, ts=excluded.ts",
                        (pid, qid, int(bool(data.get("flag"))), str(data.get("note", ""))[:2000], time.time()))
                return self.send_json({"ok": True})
            if sub == "export" and method == "GET":
                att = rows("SELECT qid,score,max,mode,seconds,ts FROM attempts WHERE profile=? ORDER BY ts", (pid,))
                csv = "date;question;points;max;mode;secondes\n" + "".join(
                    f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(a['ts']))};{a['qid']};{a['score']:g};{a['max']:g};{a['mode']};{a['seconds']}\n"
                    for a in att)
                body = csv.encode("utf-8-sig")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="progression-{pid}.csv"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
        return self.error(404, "route inconnue")


def main():
    init_db()
    run_build()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print(f"[web] Révision CEB disponible sur http://0.0.0.0:{PORT}  (PDF : {PDF_DIR}, données : {DATA_DIR})",
          flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
