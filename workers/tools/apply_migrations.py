#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Apply the built migrations (adapters/cloudflare/migrations/*.sql, in order) to a database. Idempotent: every migration is
IF NOT EXISTS. Two targets (no single route): --sqlite FILE applies directly; --d1 NAME prints (or with --run executes) the
wrangler command per file. A failing file stops the run with its name; nothing is swallowed.

Export before drop (US-01-R04): a file that drops or rewrites data is classified like core/export (same rules) and is applied
only after every table it touches was exported and read back. --export-dir DIR names where the exports go; without it such a
file stops the run, naming the file. --sqlite writes each table as JSON lines, reads it back, compares the row count and the
sha-256 and records the proof in the table export_ledger (created if absent). --d1 prints (or with --run executes)
`wrangler d1 export NAME --remote --table T --output DIR/T.sql` before the file and, with --run, checks the dump is not empty.
  python tools/apply_migrations.py --sqlite local.db [--export-dir DIR]
  python tools/apply_migrations.py --d1 my-db [--run] [--export-dir DIR]"""
from __future__ import annotations
import argparse, hashlib, json, re, sqlite3, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "adapters" / "cloudflare" / "migrations"

# The classifier of core/export/index.js, rule for rule (a test keeps the two equal).
# An identifier, optionally schema-qualified (`main.items`): group 1 is the schema when written, group 2 the table. Without the schema part,
# `DROP TABLE main.items` read as a table called `main`, found no such table and ran with nothing exported.
ID = r'["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?'
IDENT = rf"(?:{ID}\s*\.\s*)?{ID}"
RULES = [
    (re.compile(rf"^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?{IDENT}", re.I), "drop table"),
    (re.compile(rf"^ALTER\s+TABLE\s+{IDENT}\s+DROP\b", re.I), "drop column"),
    (re.compile(rf"^ALTER\s+TABLE\s+{IDENT}\s+RENAME\b", re.I), "rename"),
    (re.compile(rf"^DELETE\s+FROM\s+{IDENT}", re.I), "delete rows"),
    (re.compile(rf"^UPDATE\s+(?:OR\s+\w+\s+)?{IDENT}", re.I), "rewrite rows"),
    (re.compile(rf"^(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+{IDENT}", re.I), "replace rows"),
    (re.compile(rf"^INSERT\s+INTO\s+{IDENT}[\s\S]*?\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b", re.I), "upsert rows"),
    (re.compile(rf"^TRUNCATE\s+(?:TABLE\s+)?{IDENT}", re.I), "truncate"),
]
# A statement that starts with a common table expression (`WITH x AS (...) DELETE FROM t`) is judged by the statement after the list.
_CTE_TAIL = re.compile(r"\)\s*(?=(?:DELETE\s+FROM|UPDATE\b|REPLACE\s+INTO|INSERT\s+(?:OR\s+REPLACE\s+)?INTO)\b)", re.I)
_TRIGGER = re.compile(r"^\s*CREATE\s+(TEMP\w*\s+)?TRIGGER\b", re.I)
_WORD = re.compile(r"[A-Za-z_]+")


def split_statements(sql):
    """Split a migration into statements: understands quotes, line and block comments and trigger bodies (BEGIN ... END)."""
    s = str(sql); n = len(s); out = []; cur = ""; depth = 0; i = 0
    while i < n:
        c = s[i]
        if c == "-" and s[i + 1:i + 2] == "-":
            while i < n and s[i] != "\n": i += 1
            continue
        if c == "/" and s[i + 1:i + 2] == "*":
            i = s.find("*/", i + 2); i = n if i < 0 else i + 2
            continue
        if c in ("'", '"'):
            j = i + 1
            while j < n:
                if s[j] == c:
                    if s[j + 1:j + 2] == c: j += 2
                    else: break
                else: j += 1
            cur += s[i:j + 1]; i = j + 1
            continue
        prev = s[i - 1] if i > 0 else " "
        if (c.isascii() and (c.isalpha() or c == "_")) and not re.match(r"[A-Za-z0-9_]", prev):
            w = _WORD.match(s, i).group(0)
            u = w.upper()
            if u == "BEGIN" and _TRIGGER.match(cur): depth += 1
            elif u == "CASE" and depth: depth += 1
            elif u == "END" and depth: depth -= 1
            cur += w; i += len(w)
            continue
        if c == ";" and depth == 0:
            if cur.strip(): out.append(cur.strip())
            cur = ""; i += 1
            continue
        cur += c; i += 1
    if cur.strip(): out.append(cur.strip())
    return out


def classify(sql):
    """What a migration would drop or rewrite: {destructive, tables, findings}. A view, index or trigger drop loses no data."""
    findings = []
    for st in split_statements(sql):
        if _TRIGGER.match(st): continue
        body = st
        if re.match(r"WITH\b", st, re.I):
            tail = _CTE_TAIL.search(st)
            if tail: body = st[tail.end():].strip()
        for rx, kind in RULES:
            m = rx.match(body)
            if m:
                # a table in the main or temp schema is the bare name; one in an attached schema keeps its schema, so it cannot be exported and is refused
                schema = m.group(1) if m.group(1) and m.group(1).lower() not in ("main", "temp") else None
                findings.append({"table": f"{schema}.{m.group(2)}" if schema else m.group(2), "kind": kind, "statement": re.sub(r"\s+", " ", st)[:160]})
                break
    tables = list(dict.fromkeys(f["table"] for f in findings))
    return {"destructive": bool(findings), "tables": tables, "findings": findings}


def files(d):
    fs = sorted(Path(d).glob("*.sql"))
    if not fs: raise SystemExit(f"no migrations in {d}")
    return fs


def _stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def export_table(con, table, export_dir, migration):
    """Export one table as JSON lines, read it back, compare the row count and the sha-256, record the proof in export_ledger.
    Returns the proof; raises SystemExit when the export cannot be read back and matched (nothing has been dropped yet)."""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table): raise SystemExit(f"not a table name: {table}")
    cur = con.execute(f'SELECT * FROM "{table}"')
    cols = [c[0] for c in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    body = "\n".join(json.dumps(r, separators=(",", ":"), default=str) for r in rows)
    sha = hashlib.sha256(body.encode("utf8")).hexdigest()
    at = _stamp()
    path = Path(export_dir) / migration / f"{table}-{re.sub(r'[^0-9]', '', at)}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf8")
    back = path.read_text(encoding="utf8")
    parsed = [] if back == "" else [json.loads(line) for line in back.split("\n")]
    verified = len(parsed) == len(rows) and hashlib.sha256(back.encode("utf8")).hexdigest() == sha
    con.execute("""CREATE TABLE IF NOT EXISTS export_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, migration TEXT NOT NULL, table_name TEXT NOT NULL,
        object_key TEXT NOT NULL, row_count INTEGER NOT NULL, sha256 TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL)""")
    con.execute("INSERT INTO export_ledger (migration, table_name, object_key, row_count, sha256, verified, at) VALUES (?,?,?,?,?,?,?)",
                (migration, table, str(path), len(rows), sha, 1 if verified else 0, at))
    con.commit()
    if not verified: raise SystemExit(f"{migration}: export of {table} not verified (read back {len(parsed)} rows, wrote {len(rows)}); migration refused")
    return {"table": table, "rows": len(rows), "sha256": sha, "path": str(path)}


def _refuse_destructive(name, c):
    return SystemExit(f"{name}: destructive migration ({', '.join(sorted({f['kind'] for f in c['findings']}))} on {', '.join(c['tables'])}) needs --export-dir: "
                      "it is applied only after every table it touches was exported and read back (US-01-R04)")


def apply_sqlite(db, d=DEFAULT_DIR, export_dir=None):
    con = sqlite3.connect(db)
    try:
        for f in files(d):
            sql = f.read_text(encoding="utf8")
            c = classify(sql)
            if c["destructive"]:
                if not export_dir: raise _refuse_destructive(f.name, c)
                for t in c["tables"]:
                    if "." in t: raise SystemExit(f"{f.name}: {t} is in another schema and cannot be exported, so the migration is refused (US-01-R04)")
                    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone():
                        export_table(con, t, export_dir, f.name)
            try: con.executescript(sql)
            except sqlite3.Error as e: raise SystemExit(f"{f.name}: {e}")
        con.commit()
    finally: con.close()
    return len(files(d))


def remote_has_table(d1, table, runner=subprocess.run):
    """Whether the remote D1 database has the table, read with wrangler. `wrangler d1 export --table` fails for a table that is not there yet, which
    used to refuse a destructive file that touches a table created in the same run; a table that is not there has nothing to lose. A read that fails
    or cannot be parsed raises: it is never read as "not there" (US-01-R04)."""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table): raise SystemExit(f"not a table name: {table}")
    cmd = ["npx", "wrangler", "d1", "execute", d1, "--remote", "--json", "--command", f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'"]
    r = runner(cmd, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"could not read whether {table} exists on {d1}: {(r.stderr or '').strip()[:200]}")
    try: data = json.loads(r.stdout)
    except ValueError as e: raise SystemExit(f"could not read whether {table} exists on {d1}: the answer is not JSON ({e})")
    return any(res.get("results") for res in (data if isinstance(data, list) else [data]))


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--sqlite"); ap.add_argument("--d1"); ap.add_argument("--run", action="store_true")
    ap.add_argument("--dir", default=str(DEFAULT_DIR)); ap.add_argument("--export-dir", default=None)
    a = ap.parse_args(argv)
    if bool(a.sqlite) == bool(a.d1): ap.error("give exactly one of --sqlite or --d1")
    if a.sqlite:
        print(f"applied {apply_sqlite(a.sqlite, a.dir, a.export_dir)} migrations to {a.sqlite}"); return 0
    for f in files(a.dir):
        c = classify(f.read_text(encoding="utf8"))
        exports = []
        if c["destructive"]:
            if not a.export_dir: print(str(_refuse_destructive(f.name, c)), file=sys.stderr); return 1
            for t in c["tables"]:
                if "." in t: print(f"{f.name}: {t} is in another schema and cannot be exported, so the migration is refused (US-01-R04)", file=sys.stderr); return 1
                if a.run and not remote_has_table(a.d1, t): continue  # nothing to lose: the table is not there yet
                out = Path(a.export_dir) / f.name / f"{t}.sql"
                exports.append((out, ["npx", "wrangler", "d1", "export", a.d1, "--remote", "--table", t, "--output", str(out)]))
        for out, cmd in exports:
            print(" ".join(cmd))
            if a.run:
                out.parent.mkdir(parents=True, exist_ok=True)
                if subprocess.run(cmd).returncode: print(f"failed: export of {out.stem} before {f.name}; migration refused", file=sys.stderr); return 1
                if not out.exists() or out.stat().st_size == 0: print(f"failed: export of {out.stem} before {f.name} is missing or empty; migration refused", file=sys.stderr); return 1
        cmd = ["npx", "wrangler", "d1", "execute", a.d1, "--remote", "--file", str(f)]
        print(" ".join(cmd))
        if a.run and subprocess.run(cmd).returncode: print(f"failed: {f.name}", file=sys.stderr); return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
