"""Storage behind one thin interface (q/one/x/scalar). SQLite is the default; a postgres:// URL selects PgStore."""
from __future__ import annotations
import json, re, sqlite3, threading
from decimal import Decimal
from datetime import datetime, timedelta, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS org (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, outcome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', weight REAL NOT NULL DEFAULT 1.0);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY, role TEXT NOT NULL, project TEXT, tick_every INTEGER NOT NULL DEFAULT 1,
  model TEXT NOT NULL, last_tick_at TEXT);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work',
  project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL,
  closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'open', disposition TEXT, blocker TEXT,
  surface TEXT, action_class TEXT, attempts INTEGER NOT NULL DEFAULT 0, evidence TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (
  item_id TEXT PRIMARY KEY REFERENCES items(id), agent TEXT NOT NULL,
  claimed_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gate_cards (
  id TEXT PRIMARY KEY, item_id TEXT, what TEXT NOT NULL, why_gated TEXT NOT NULL,
  default_in_effect TEXT NOT NULL, prepared_by_fleet TEXT, closing_probe TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', opened_at TEXT, closed_at TEXT);
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY, item_id TEXT, agent TEXT, metric TEXT NOT NULL, op TEXT NOT NULL,
  target REAL NOT NULL, due_at TEXT NOT NULL, observed REAL, verdict TEXT);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT, agent TEXT, surface TEXT NOT NULL,
  action_class TEXT NOT NULL, result TEXT NOT NULL, evidence TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trust_ledger (
  surface TEXT NOT NULL, action_class TEXT NOT NULL, rung TEXT NOT NULL, reliability REAL NOT NULL,
  outcomes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (surface, action_class));
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tick_id INTEGER NOT NULL, role_id TEXT NOT NULL,
  item_id TEXT, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tick_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
  steps_completed INTEGER NOT NULL DEFAULT 0, steps_total INTEGER NOT NULL, report TEXT, errors TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL,
  kind TEXT NOT NULL, item_id TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS amendments (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, pattern TEXT NOT NULL, proposal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', evidence TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status, priority);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(id DESC);
"""

FMT = "%Y-%m-%d %H:%M:%S"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(FMT)


def parse(s: str) -> datetime:
    return datetime.strptime(s, FMT).replace(tzinfo=timezone.utc)


class Store:
    def __new__(cls, path: str = ":memory:"):
        if cls is Store and str(path).startswith(("postgres://", "postgresql://")):
            return object.__new__(PgStore)
        return object.__new__(cls)

    def __init__(self, path: str = ":memory:"):
        self.path = path
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL" if path != ":memory:" else "PRAGMA journal_mode=MEMORY")
        self.db.executescript(SCHEMA)

    def q(self, sql, *args):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def one(self, sql, *args):
        rows = self.q(sql, *args)
        return rows[0] if rows else None

    def x(self, sql, *args):
        with self.lock:
            cur = self.db.execute(sql, args)
            return cur.lastrowid if cur.lastrowid else cur.rowcount

    def scalar(self, sql, *args):
        r = self.one(sql, *args)
        return next(iter(r.values())) if r else None

    def event(self, now: str, actor: str, kind: str, item_id=None, detail=None):
        self.x("INSERT INTO events (at, actor, kind, item_id, detail) VALUES (?,?,?,?,?)",
               now, actor, kind, item_id, detail if isinstance(detail, str) or detail is None else json.dumps(detail))

    def get(self, key, default=None):
        r = self.one("SELECT value FROM org WHERE key=?", key)
        return json.loads(r["value"]) if r else default

    def put(self, key, value):
        self.x("INSERT INTO org (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
               key, json.dumps(value))

    def backup(self, dest: str):
        with self.lock:
            self.db.execute("VACUUM INTO ?", (dest,))


# --- Postgres adapter -------------------------------------------------------
_SERIAL_TABLES = {"outcomes", "dispatches", "tick_runs", "events"}


def pg_translate(sql: str) -> str:
    """Rewrite the SQLite-flavoured SQL the engine emits into Postgres: ? -> %s, literal % escaped,
    INSERT OR IGNORE -> ON CONFLICT DO NOTHING. Quoted string literals are copied verbatim (with % escaped)."""
    out, i, n = [], 0, len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append(sql[i:j + 1].replace("%", "%%"))
            i = j + 1
            continue
        out.append("%s" if ch == "?" else "%%" if ch == "%" else ch)
        i += 1
    res = "".join(out)
    if re.match(r"\s*INSERT\s+OR\s+IGNORE\b", res, re.I):
        res = re.sub(r"INSERT\s+OR\s+IGNORE", "INSERT", res, count=1, flags=re.I).rstrip().rstrip(";") + " ON CONFLICT DO NOTHING"
    return res


def pg_schema() -> str:
    return SCHEMA.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY").replace(" REAL", " DOUBLE PRECISION")


class PgStore(Store):
    """Same contract as Store, over psycopg 3 (pip install 'psycopg[binary]'). One autocommit connection,
    serialized by an RLock like the SQLite path; run several replicas by giving each its own PgStore."""

    def __init__(self, path: str):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("Postgres store needs psycopg: pip install 'psycopg[binary]'") from e
        self.path = path
        self.lock = threading.RLock()
        self.db = psycopg.connect(path, autocommit=True, row_factory=dict_row)
        with self.lock:
            for stmt in filter(None, (t.strip() for t in pg_schema().split(";"))):
                self.db.execute(stmt)

    @staticmethod
    def _norm(v):
        return int(v) if isinstance(v, Decimal) and v == v.to_integral_value() else float(v) if isinstance(v, Decimal) else v

    def q(self, sql, *args):
        with self.lock:
            rows = self.db.execute(pg_translate(sql), args).fetchall()
        return [{k: self._norm(v) for k, v in r.items()} for r in rows]

    def x(self, sql, *args):
        t = pg_translate(sql)
        m = re.match(r"\s*INSERT\s+INTO\s+(\w+)", t, re.I)
        with self.lock:
            if m and m.group(1).lower() in _SERIAL_TABLES:
                row = self.db.execute(t.rstrip().rstrip(";") + " RETURNING id", args).fetchone()
                return row["id"] if row else 0
            return self.db.execute(t, args).rowcount

    def reset(self):
        """Drop every table (tests only)."""
        with self.lock:
            self.db.execute("DROP SCHEMA public CASCADE")
            self.db.execute("CREATE SCHEMA public")
            for stmt in filter(None, (t.strip() for t in pg_schema().split(";"))):
                self.db.execute(stmt)

    def backup(self, dest: str):
        raise NotImplementedError("Postgres backups: use Cloud SQL automated backups / pg_dump")
