#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Apply the built migrations (adapters/cloudflare/migrations/*.sql, in order) to a database. Idempotent: every migration is
IF NOT EXISTS. Two targets (no single route): --sqlite FILE applies directly; --d1 NAME prints (or with --run executes) the
wrangler command per file. A failing file stops the run with its name; nothing is swallowed.

Export before drop (US-01-R04): a file that drops or rewrites data is classified like core/export (the same reading, default-deny,
with SQLite's own statement boundaries) and is applied only after every table it touches was exported and read back. --export-dir DIR
names where the exports go; without it such a file stops the run, naming the file. --sqlite also runs each file once in a rolled-back
savepoint and exports every table SQLite reports a delete, update or drop on, then runs the statements it classified one at a time in
one transaction; it writes each table as JSON lines, reads it back, compares the row count and the sha-256 and records the proof in the
table export_ledger (created if absent). --d1 prints (or with --run executes) `wrangler d1 export NAME --remote --table T --output
DIR/T.sql` before the file and, with --run, checks the dump is not empty; the schema earlier files build (triggers, REPLACE clauses, foreign keys) counts in later ones.
  python tools/apply_migrations.py --sqlite local.db [--export-dir DIR]
  python tools/apply_migrations.py --d1 my-db [--run] [--export-dir DIR]"""
from __future__ import annotations
import argparse, hashlib, json, re, sqlite3, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "adapters" / "cloudflare" / "migrations"

# The reading of core/export/index.js, step for step (a test keeps the two equal on every shipped migration and the hard cases).
# Three rounds of residuals came from one deny-list over a splitter that knew two of SQLite's four quoting forms. So now: the lexer knows all four
# ('...', "...", `...`, [...]) and reads a comment as whitespace only outside them; a statement ends where SQLite says it does
# (sqlite3.complete_statement, the C library's own sqlite3_complete); classification is default-deny (a statement counts as additive only on the
# allow-list in _analyze_tokens); what SQLite does past a statement's text counts, read from the schema the database holds and the file builds (a
# trigger a write fires, a REPLACE conflict clause in a table, a foreign key ON DELETE or ON UPDATE action). On the sqlite path the file also runs once in a savepoint that is always rolled back, and every table SQLite reports a delete, update or drop on is
# exported too (touched()); then the very statements that were classified run, one at a time, in one transaction.
_SPACE = " \t\n\f\r"  # SQLite's whitespace; a vertical tab is not
_UPPER = str.maketrans("abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")  # SQLite folds ASCII only
_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
_PLAIN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _is_id(ch):
    return ("a" <= ch <= "z") or ("A" <= ch <= "Z") or ("0" <= ch <= "9") or ch in "_$" or ord(ch) >= 0x80


def _norm(s):
    return re.sub(r"[ \t\n\f\r]+", " ", s)[:160]


def lex(s):
    """SQLite's tokens of s: [(kind, start, end)], kind one of ws, comment, quote, word, semi, other."""
    out = []; n = len(s); i = 0
    while i < n:
        c = s[i]; j = i + 1
        if c in _SPACE:
            while j < n and s[j] in _SPACE: j += 1
            k = "ws"
        elif c == "-" and s[i + 1:i + 2] == "-":
            j = s.find("\n", i + 2); j = n if j < 0 else j; k = "comment"
        elif c == "/" and s[i + 1:i + 2] == "*":
            j = s.find("*/", i + 2); j = n if j < 0 else j + 2; k = "comment"
        elif c in "'\"`":
            while True:
                e = s.find(c, j)
                if e < 0: j = n; break
                j = e + 1
                if s[j:j + 1] == c: j += 1; continue
                break
            k = "quote"
        elif c == "[":
            e = s.find("]", j); j = n if e < 0 else e + 1; k = "quote"
        elif c == ";": k = "semi"
        elif _is_id(c):
            while j < n and _is_id(s[j]): j += 1
            k = "word"
        else: k = "other"
        out.append((k, i, j)); i = j
    return out


def split_statements(sql):
    """Split a migration into statements where SQLite does: a `;` outside quotes and comments ends one when sqlite3.complete_statement says the
    text so far is complete (inside CREATE TRIGGER ... BEGIN only `; END ;` is). Each piece keeps its text, with every comment read as one space."""
    s = str(sql); out = []; start = 0; code = []

    def push():
        t = "".join(code).strip(_SPACE)
        if t: out.append(t)
        code.clear()
    for k, a, b in lex(s):
        if k == "semi" and sqlite3.complete_statement(s[start:b]):
            push(); start = b
            continue
        code.append(" " if k == "comment" else s[a:b])
    push()
    return out


def _unquote(t):
    """A quoted name as SQLite reads it; one left unterminated is kept as written, so it never reads as a plain name."""
    q = t[:1]
    if not q or q not in "\"'`[": return t
    if len(t) < 2 or t[-1] != ("]" if q == "[" else q): return t
    inner = t[1:-1]
    return inner if q == "[" else inner.replace(q * 2, q)


_CONFLICT = {"ROLLBACK", "ABORT", "FAIL", "IGNORE", "REPLACE"}
_TAIL = {"SELECT", "VALUES", "INSERT", "REPLACE", "UPDATE", "DELETE"}
_BODY_START = {"INSERT", "UPDATE", "DELETE", "SELECT", "REPLACE", "WITH", "VALUES"}
_EVENTS = {"DELETE", "INSERT", "UPDATE"}
_LOSS_ACTION = {"CASCADE", "SET NULL", "SET DEFAULT"}


def _analyze_tokens(src, toks_all, frm=0, to=None):
    """One statement, as tokens [frm, to) of src: {statement, findings, writes, and what it does to the schema: trigger?, dropTrigger?, table?,
    alterAdd?, rename?, dropTable?} (see analyzeTokens in core/export)."""
    toks = toks_all[frm:len(toks_all) if to is None else to]
    R = {"statement": _norm(src[toks[0][1]:toks[-1][2]]) if toks else "", "findings": [], "writes": []}
    n = len(toks)
    txt = lambda i: src[toks[i][1]:toks[i][2]]
    W = lambda i: txt(i).translate(_UPPER) if 0 <= i < n and toks[i][0] == "word" else None
    P = lambda i: txt(i) if 0 <= i < n and toks[i][0] == "other" else None

    def bad():
        return {"statement": R["statement"], "findings": [{"table": None, "kind": "unreadable", "statement": R["statement"], "unresolved": "statement"}], "writes": []}
    is_name = lambda i: 0 <= i < n and toks[i][0] in ("word", "quote")

    def name(i):
        if not is_name(i): return None
        if P(i + 1) == "." and is_name(i + 2): return {"schema": _unquote(txt(i)), "table": _unquote(txt(i + 2)), "next": i + 3}
        return {"schema": None, "table": _unquote(txt(i)), "next": i + 1}
    home = lambda q: q["schema"] is None or q["schema"].translate(_LOWER) in ("main", "temp")
    key_of = lambda q: ("" if home(q) else q["schema"].translate(_LOWER) + ".") + q["table"].translate(_LOWER)

    def shown(q):
        # a table in the main or temp schema is the bare name; one in an attached schema keeps its schema, so it cannot be exported and is refused
        d = {"table": q["table"] if home(q) else f"{q['schema']}.{q['table']}"}
        if not home(q): d["unresolved"] = "schema"
        elif not _PLAIN.fullmatch(q["table"]): d["unresolved"] = "name"
        return d

    def write(q, events, plain):
        R["writes"].append({"key": key_of(q), "events": events, "plain": plain, **shown(q)})
        return R

    def lose(kind, q, events=None, plain=False):
        d = shown(q)
        f = {"table": d["table"], "kind": kind, "statement": R["statement"]}
        if "unresolved" in d: f["unresolved"] = d["unresolved"]
        R["findings"].append(f)
        return write(q, events, plain) if events else R

    def references(frm, child):
        out = []
        for i in range(frm, n):
            if W(i) != "REFERENCES": continue
            p = name(i + 1)
            if not p: continue
            on_delete = on_update = None; d = 0
            for k in range(p["next"], n):
                c = P(k)
                if c == "(": d += 1
                elif c == ")":
                    if d == 0: break
                    d -= 1
                elif c == "," and d == 0: break
                elif d == 0 and W(k) == "ON" and W(k + 1) in ("DELETE", "UPDATE"):
                    act = f"SET {W(k + 3)}" if W(k + 2) == "SET" else W(k + 2)
                    if W(k + 1) == "DELETE": on_delete = act
                    else: on_update = act
            out.append({"parent": key_of(p), "child": key_of(child), "childLabel": child["table"], **shown(child), "onDelete": on_delete, "onUpdate": on_update})
        return out
    if not toks: return R
    s = 0
    if W(0) == "WITH":
        depth = 0; s = 1
        while s < n:
            p = P(s)
            if p == "(": depth += 1
            elif p == ")": depth -= 1
            elif depth == 0 and W(s) in _TAIL: break
            s += 1
        if s >= n: return bad()
    h = W(s)
    if h in ("SELECT", "VALUES"): return R
    if h == "CREATE" and s == 0:
        j = 1; temp = W(j) in ("TEMP", "TEMPORARY")
        if temp: j += 1
        if W(j) == "TABLE":
            k = j + 1; if_not_exists = W(k) == "IF" and W(k + 1) == "NOT" and W(k + 2) == "EXISTS"
            if if_not_exists: k += 3
            q = name(k)
            if q:
                replace = any(W(i) == "ON" and W(i + 1) == "CONFLICT" and W(i + 2) == "REPLACE" for i in range(q["next"], n))
                R["table"] = {"key": key_of(q), "ifNotExists": if_not_exists, "replace": replace, "fks": references(q["next"], q)}
            return R
        if W(j) == "VIEW": return R
        if not temp and W(j) == "VIRTUAL" and W(j + 1) == "TABLE": return R
        if not temp and (W(j) == "INDEX" or (W(j) == "UNIQUE" and W(j + 1) == "INDEX")): return R
        if W(j) != "TRIGGER": return bad()
        j += 1
        if W(j) == "IF" and W(j + 1) == "NOT" and W(j + 2) == "EXISTS": j += 3
        nm = name(j)
        if not nm: return bad()
        j = nm["next"]
        if W(j) in ("BEFORE", "AFTER"): j += 1
        elif W(j) == "INSTEAD" and W(j + 1) == "OF": j += 2
        event = W(j)
        if event not in _EVENTS: return bad()
        while j < n and W(j) != "ON": j += 1
        on = name(j + 1)
        if not on: return bad()
        b = next((k for k in range(on["next"], n) if W(k) == "BEGIN" and P(k - 1) != "." and W(k + 1) in _BODY_START), -1)
        last = n - 1
        if b < 0 or W(last) != "END" or b + 1 >= last: return bad()
        findings = []; writes = []; st = b + 1
        for k in range(b + 1, last + 1):
            if k != last and toks[k][0] != "semi": continue
            if k > st:
                r = _analyze_tokens(src, toks, st, k)
                if r.get("trigger") or r.get("dropTrigger") or any(f.get("unresolved") == "statement" for f in r["findings"]): return bad()
                findings += r["findings"]; writes += r["writes"]
            st = k + 1
        R["trigger"] = {"name": nm["table"].translate(_LOWER), "label": nm["table"], "key": key_of(on), "event": event, "findings": findings, "writes": writes}
        return R
    if h == "DROP" and s == 0:
        if W(1) in ("INDEX", "VIEW"): return R
        j = 2
        if W(j) == "IF" and W(j + 1) == "EXISTS": j += 2
        q = name(j)
        if W(1) == "TRIGGER" and q: R["dropTrigger"] = q["table"].translate(_LOWER); return R
        # with foreign keys on, a dropped table is emptied first, so its children's ON DELETE actions run (its triggers do not)
        if W(1) == "TABLE" and q: R["dropTable"] = key_of(q); return lose("drop table", q, ["DROP"])
        return bad()
    if h == "ALTER" and s == 0:
        q = name(2) if W(1) == "TABLE" else None
        if not q: return bad()
        v = W(q["next"])
        if v == "ADD": R["alterAdd"] = {"fks": references(q["next"] + 1, q)}; return R
        if v == "DROP": return lose("drop column", q)
        if v == "RENAME":
            to = name(q["next"] + 2) if W(q["next"] + 1) == "TO" else None
            if to: R["rename"] = {"from": key_of(q), "to": key_of(to), "label": to["table"], **shown(to)}
            return lose("rename", q)
        return bad()
    if h == "DELETE":
        q = name(s + 2) if W(s + 1) == "FROM" else None
        return lose("delete rows", q, ["DELETE"]) if q else bad()
    if h == "UPDATE":
        j = s + 1; verb = None
        if W(j) == "OR":
            verb = W(j + 1); j += 2
            if verb not in _CONFLICT: return bad()
        q = name(j)
        return lose("rewrite rows", q, ["UPDATE", "DELETE"] if verb == "REPLACE" else ["UPDATE"], verb is None) if q else bad()
    if h in ("INSERT", "REPLACE"):
        j = s + 1; verb = "REPLACE" if h == "REPLACE" else None
        if h == "INSERT" and W(j) == "OR":
            verb = W(j + 1); j += 2
            if verb not in _CONFLICT: return bad()
        q = name(j + 1) if W(j) == "INTO" else None
        if not q: return bad()
        if verb == "REPLACE": return lose("replace rows", q, ["INSERT", "DELETE"])
        if any(W(i) == "DO" and W(i + 1) == "UPDATE" for i in range(q["next"], n)): return lose("upsert rows", q, ["INSERT", "UPDATE"], verb is None)
        return write(q, ["INSERT"], verb is None)
    if h == "TRUNCATE":
        q = name(s + 2 if W(s + 1) == "TABLE" else s + 1)
        return lose("truncate", q, ["DELETE"]) if q else bad()
    return bad()


def _analyze(st):
    return _analyze_tokens(st, [t for t in lex(st) if t[0] not in ("ws", "comment")])


def one_statement(piece):
    """Whether a piece is one statement: no `;` outside quotes and comments, or one whole trigger whose body was read."""
    s = str(piece)
    return not any(t[0] == "semi" for t in lex(s)) or bool(_analyze(s).get("trigger"))


def schema_after(sql, known=()):
    """The schema statements (CREATE TABLE, CREATE TRIGGER, ALTER TABLE ... ADD and RENAME, drops) in force after sql runs, given those before it."""
    keep = ("table", "trigger", "dropTrigger", "alterAdd", "rename", "dropTable")
    return list(known) + [st for st in split_statements(sql) if any(_analyze(st).get(k) for k in keep)]


def _learn(reg, a):
    if a.get("trigger"): reg["triggers"][a["trigger"]["name"]] = a["trigger"]
    elif a.get("dropTrigger"): reg["triggers"].pop(a["dropTrigger"], None)
    t = a.get("table")
    if t and not (t["ifNotExists"] and t["key"] in reg["tables"]):
        reg["tables"][t["key"]] = {"replace": t["replace"]}
        reg["fks"] = [e for e in reg["fks"] if e["child"] != t["key"]] + t["fks"]
    if a.get("alterAdd"): reg["fks"] = reg["fks"] + a["alterAdd"]["fks"]
    rn = a.get("rename")
    if rn:
        frm, to = rn["from"], rn["to"]
        if frm in reg["tables"]: reg["tables"][to] = reg["tables"].pop(frm)
        for nm, tr in list(reg["triggers"].items()):
            if tr["key"] == frm: reg["triggers"][nm] = {**tr, "key": to}
        fks = []
        for e in reg["fks"]:
            out = dict(e)
            if out["parent"] == frm: out["parent"] = to
            if out["child"] == frm:
                out.update({"child": to, "childLabel": rn["label"], "table": rn["table"]}); out.pop("unresolved", None)
                if rn.get("unresolved"): out["unresolved"] = rn["unresolved"]
            fks.append(out)
        reg["fks"] = fks
    if a.get("dropTable"):
        k = a["dropTable"]
        reg["tables"].pop(k, None)
        reg["fks"] = [e for e in reg["fks"] if e["child"] != k]
        for nm, tr in list(reg["triggers"].items()):
            if tr["key"] == k: del reg["triggers"][nm]


def _effects(reg, w, statement, seen, findings):
    tag = lambda d: {"unresolved": d["unresolved"]} if d.get("unresolved") else {}
    events = w["events"]
    if w.get("plain") and reg["tables"].get(w["key"], {}).get("replace") and f"replace:{w['key']}" not in seen:
        findings.append({"table": w["table"], "kind": "replace rows", "statement": statement, **tag(w), "via": "ON CONFLICT REPLACE"})
        if "DELETE" not in events: events = events + ["DELETE"]
        seen = seen | {f"replace:{w['key']}"}
    for t in list(reg["triggers"].values()):
        if t["key"] != w["key"] or t["event"] not in events or t["name"] in seen: continue
        nxt = seen | {t["name"]}
        for f in t["findings"]: findings.append({**f, "statement": statement, "via": t["label"]})
        for w2 in t["writes"]: _effects(reg, w2, statement, nxt, findings)
    dele = "DELETE" in events or "DROP" in events; upd = "UPDATE" in events
    for e in list(reg["fks"]):
        if e["parent"] != w["key"] or f"fk:{e['child']}" in seen: continue
        kind = ("delete rows" if dele and e["onDelete"] == "CASCADE"
                else "rewrite rows" if (dele and e["onDelete"] in _LOSS_ACTION) or (upd and e["onUpdate"] in _LOSS_ACTION) else None)
        if not kind: continue
        findings.append({"table": e["table"], "kind": kind, "statement": statement, **tag(e), "via": f"foreign key of {e['childLabel']}"})
        child = {"key": e["child"], "events": ["DELETE"] if kind == "delete rows" else ["UPDATE"], "plain": False, "table": e["table"], **tag(e)}
        _effects(reg, child, statement, seen | {f"fk:{e['child']}"}, findings)


def classify(sql, schema=()):
    """What a migration would drop or rewrite: {destructive, tables, unresolved, findings}. A view, index or trigger drop loses no data. `schema`
    holds the CREATE TABLE and CREATE TRIGGER statements the database already has; with it and the file's own, a trigger a write fires, a REPLACE
    clause in a table and a foreign key action count, and "via" names what does the loss. `unresolved` lists the tables that cannot be exported
    (another schema, a name that is not a plain identifier) and, for a statement on no allow-list, the statement itself; such a finding carries
    "unresolved": "schema" | "name" | "statement"."""
    reg = {"triggers": {}, "tables": {}, "fks": []}
    for t in schema:
        for st in split_statements(t): _learn(reg, _analyze(st))
    findings = []
    for st in split_statements(sql):
        a = _analyze(st)
        findings += a["findings"]
        for w in a["writes"]: _effects(reg, w, a["statement"], frozenset(), findings)
        _learn(reg, a)
    tables = list(dict.fromkeys(f["table"] for f in findings if f["table"] is not None))
    unresolved = list(dict.fromkeys(f["table"] if f["table"] is not None else f["statement"] for f in findings if f.get("unresolved")))
    return {"destructive": bool(findings), "tables": tables, "unresolved": unresolved, "findings": findings}


def unresolved_reason(name, c):
    """The refusal for a file with a table that cannot be exported, in the words core/export uses (US-01-R04)."""
    out = []
    for f in c["findings"]:
        if not f.get("unresolved"): continue
        r = (f"{f['table']} is in another schema and cannot be exported" if f["unresolved"] == "schema"
             else f"{f['table']} cannot be resolved to a table name and cannot be exported" if f["unresolved"] == "name"
             else f'no table can be read from "{f["statement"]}"')
        if r not in out: out.append(r)
    return f"{name}: {'; '.join(out)}, so the migration is refused (US-01-R04)"


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


def _read(f):
    """A migration file's text. A NUL character is refused: SQLite reads it as the end of the text, so what runs would not be what was read."""
    sql = f.read_text(encoding="utf8")
    if "\x00" in sql: raise SystemExit(f"{f.name}: holds a NUL character, which SQLite reads as the end of the text; the migration is refused (US-01-R04)")
    return sql


_LOSS = {sqlite3.SQLITE_DELETE: "delete rows", sqlite3.SQLITE_UPDATE: "rewrite rows", sqlite3.SQLITE_DROP_TABLE: "drop table"}
_VIEW_ACTIONS = {sqlite3.SQLITE_CREATE_VIEW, sqlite3.SQLITE_DROP_VIEW, sqlite3.SQLITE_CREATE_TEMP_VIEW, sqlite3.SQLITE_DROP_TEMP_VIEW}


def touched(con, statements):
    """Run the statements once inside a savepoint that is always rolled back, with an authorizer that records every table SQLite reports a delete,
    an update or a table drop on, trigger bodies included: [{table, kind, via?}] in first-seen order (via: the trigger that does it). SQLite's own
    tables (sqlite_*), temp tables and views are left out (a dropped view, or a delete through a view's INSTEAD OF trigger, is reported as a delete
    on the view, which holds no rows; the trigger's own actions are reported on their tables); a table in an attached schema keeps its schema. A
    statement that fails raises sqlite3.Error, and nothing it did is kept. The connection must be in autocommit mode (isolation_level=None)."""
    seen = {}
    views = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'view'")}

    def auth(action, arg1, arg2, dbname, source):
        if action in _VIEW_ACTIONS and arg1: views.add(arg1)
        kind = _LOSS.get(action)
        if kind and arg1 and not arg1.translate(_LOWER).startswith("sqlite_") and dbname != "temp":
            table = arg1 if dbname in (None, "main") else f"{dbname}.{arg1}"
            if (table, kind) not in seen:
                f = {"table": table, "kind": kind}
                if source: f["via"] = source
                seen[(table, kind)] = f
        return sqlite3.SQLITE_OK
    con.execute("SAVEPOINT us_r04_dry_run")
    con.set_authorizer(auth)
    try:
        for st in statements: con.execute(st)
    finally:
        con.set_authorizer(lambda *a: sqlite3.SQLITE_OK)
        con.execute("ROLLBACK TO us_r04_dry_run"); con.execute("RELEASE us_r04_dry_run")
    return [f for f in seen.values() if f["table"] not in views]


def _run(con, name, statements):
    """Run the statements that were classified, one at a time, in one transaction: the file lands whole or not at all, and a piece that holds
    more than one statement is refused by sqlite3 itself."""
    con.execute("BEGIN")
    try:
        for st in statements: con.execute(st)
    except sqlite3.Error as e:
        con.execute("ROLLBACK")
        raise SystemExit(f"{name}: {e}")
    con.execute("COMMIT")


def apply_sqlite(db, d=DEFAULT_DIR, export_dir=None):
    # no statement cache, so every statement of the dry run is prepared, and so authorized, afresh
    con = sqlite3.connect(db, isolation_level=None, cached_statements=0)
    try:
        for f in files(d):
            sql = _read(f)
            statements = split_statements(sql)
            known = [r[0] for r in con.execute("SELECT sql FROM sqlite_master WHERE type IN ('table', 'trigger') AND sql IS NOT NULL")]
            c = classify(sql, known)
            if c["destructive"]:
                if not export_dir: raise _refuse_destructive(f.name, c)
                if c["unresolved"]: raise SystemExit(unresolved_reason(f.name, c))
            # what SQLite itself reports the file drops or rewrites, read in a run that is rolled back; any table it names is exported too
            try: reported = touched(con, statements)
            except sqlite3.Error as e: raise SystemExit(f"{f.name}: {e}")
            extra = [x for x in reported if x["table"] not in c["tables"]]
            if extra:
                c = {**c, "destructive": True, "tables": c["tables"] + list(dict.fromkeys(x["table"] for x in extra)),
                     "findings": c["findings"] + [{**x, "statement": "reported by SQLite in a rolled-back run of the file"} for x in extra]}
                if not export_dir: raise _refuse_destructive(f.name, c)
                odd = [t for t in c["tables"] if not _PLAIN.fullmatch(t)]
                if odd: raise SystemExit(f"{f.name}: {', '.join(odd)} cannot be resolved to a table name and cannot be exported, so the migration is refused (US-01-R04)")
            for t in c["tables"]:
                if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone():
                    export_table(con, t, export_dir, f.name)
            _run(con, f.name, statements)
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
    known = []  # the schema the earlier files build: a trigger, a REPLACE clause or a foreign key counts in a later file
    for f in files(a.dir):
        sql = _read(f)
        c = classify(sql, known)
        known = schema_after(sql, known)
        exports = []
        if c["destructive"]:
            if not a.export_dir: print(str(_refuse_destructive(f.name, c)), file=sys.stderr); return 1
            if c["unresolved"]: print(unresolved_reason(f.name, c), file=sys.stderr); return 1
            for t in c["tables"]:
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
