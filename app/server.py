#!/usr/bin/env python3
"""
Serveur du site « Révision CEB » — bibliothèque standard Python uniquement.

- sert l'interface web (app/web), les pages rendues (/data/pages) et les PDF d'origine
- expose une petite API JSON pour les profils enfants et leur progression (SQLite)
- lance la (re)construction du catalogue en arrière-plan au démarrage
"""
import hashlib
import json
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
CATALOG = os.path.join(DATA_DIR, "catalog.json")

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
        cmd = [sys.executable, "-u", BUILDER, "--pdf", PDF_DIR, "--out", DATA_DIR]
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
"""
_db_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)


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


def pin_hash(pin):
    return hashlib.sha256(("ceb-local:" + str(pin)).encode()).hexdigest()


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

    def check_pin(self, data):
        h = get_setting("pin")
        return not h or pin_hash(data.get("pin", "")) == h

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
            if not re.fullmatch(r"\d{4}_CEB_\w+\.pdf", name):
                return self.error(404, "introuvable")
            return self.send_file(os.path.join(PDF_DIR, name), "public, max-age=86400")
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
        try:
            data = self.body() if method in ("POST", "PUT", "DELETE") else {}
        except Exception:
            return self.error(400, "JSON invalide")
        try:
            return self.route(method, path.rstrip("/"), data, qs)
        except Exception as e:  # pragma: no cover
            import traceback
            traceback.print_exc()
            return self.error(500, str(e))

    def route(self, method, path, data, qs):
        parts = path.split("/")[2:]  # après /api
        head = parts[0] if parts else ""

        if head == "status" and method == "GET":
            cat = os.path.exists(CATALOG)
            return self.send_json({"ready": cat, "building": BUILD["running"], "log": BUILD["log"][-30:],
                                   "rc": BUILD["rc"], "pdf_dir": PDF_DIR,
                                   "pdfs": sorted(f for f in os.listdir(PDF_DIR) if f.endswith(".pdf"))
                                   if os.path.isdir(PDF_DIR) else []})
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
        if head == "rebuild" and method == "POST":
            if not self.check_pin(data):
                return self.error(403, "code parent incorrect")
            return self.send_json({"started": run_build(force=True)})

        if head == "settings":
            if method == "GET":
                return self.send_json({"pin": bool(get_setting("pin")),
                                       "prefs": json.loads(get_setting("prefs", "{}"))})
            if method == "PUT":
                if not self.check_pin(data):
                    return self.error(403, "code parent incorrect")
                if "new_pin" in data:
                    np_ = str(data["new_pin"] or "")
                    if np_ and not re.fullmatch(r"\d{4,8}", np_):
                        return self.error(400, "le code doit contenir 4 à 8 chiffres")
                    set_setting("pin", pin_hash(np_) if np_ else "")
                if "prefs" in data:
                    set_setting("prefs", json.dumps(data["prefs"]))
                return self.send_json({"ok": True})
        if head == "pin" and method == "POST":
            return self.send_json({"ok": self.check_pin(data)})

        if head == "profiles":
            if len(parts) == 1:
                if method == "GET":
                    return self.send_json(rows("SELECT * FROM profiles WHERE archived=0 ORDER BY id"))
                if method == "POST":
                    name = (data.get("name") or "").strip()[:40]
                    if not name:
                        return self.error(400, "prénom requis")
                    pid = execute("INSERT INTO profiles(name,avatar,color,created) VALUES(?,?,?,?)",
                                  (name, data.get("avatar", "🦊")[:8], data.get("color", "#4f6df5")[:16],
                                   time.time()))
                    return self.send_json(rows("SELECT * FROM profiles WHERE id=?", (pid,))[0], 201)
            pid = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            if pid is None or not rows("SELECT id FROM profiles WHERE id=?", (pid,)):
                return self.error(404, "profil inconnu")
            sub = parts[2] if len(parts) > 2 else ""
            if sub == "" and method == "PUT":
                execute("UPDATE profiles SET name=COALESCE(?,name), avatar=COALESCE(?,avatar), color=COALESCE(?,color) WHERE id=?",
                        (data.get("name"), data.get("avatar"), data.get("color"), pid))
                return self.send_json(rows("SELECT * FROM profiles WHERE id=?", (pid,))[0])
            if sub == "" and method == "DELETE":
                if not self.check_pin(data):
                    return self.error(403, "code parent incorrect")
                for t in ("attempts", "exams", "drills", "notes"):
                    execute(f"DELETE FROM {t} WHERE profile=?", (pid,))
                execute("DELETE FROM profiles WHERE id=?", (pid,))
                return self.send_json({"ok": True})
            if sub == "reset" and method == "POST":
                if not self.check_pin(data):
                    return self.error(403, "code parent incorrect")
                for t in ("attempts", "exams", "drills", "notes"):
                    execute(f"DELETE FROM {t} WHERE profile=?", (pid,))
                return self.send_json({"ok": True})
            if sub == "state" and method == "GET":
                return self.send_json({
                    "attempts": rows("SELECT qid,score,max,mode,seconds,ts FROM attempts WHERE profile=? ORDER BY ts", (pid,)),
                    "exams": rows("SELECT id,year,livret,subject,score,max,seconds,detail,ts FROM exams WHERE profile=? ORDER BY ts", (pid,)),
                    "drills": rows("SELECT kind,level,correct,total,seconds,ts FROM drills WHERE profile=? ORDER BY ts", (pid,)),
                    "notes": rows("SELECT qid,flag,note,ts FROM notes WHERE profile=?", (pid,)),
                })
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
                               json.dumps(data.get("detail", {}))[:20000], now))
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
