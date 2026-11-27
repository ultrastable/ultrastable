# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""Ledger: one SQLite file holding task/token logs, EV readings, conclusions, action classes.

Stdlib only so it runs anywhere (local, container, CI). The schema is the contract;
a D1 adapter can mirror it table-for-table.
"""
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS token_log(
  id INTEGER PRIMARY KEY, ts REAL, task_id TEXT, module TEXT,
  kind TEXT CHECK(kind IN ('read','execute','edit','other')),
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ev_reading(
  id INTEGER PRIMARY KEY, ts REAL, scope TEXT, name TEXT, value REAL);
CREATE TABLE IF NOT EXISTS step_change(
  id INTEGER PRIMARY KEY, ts REAL, scope TEXT, ev TEXT, action TEXT,
  prediction TEXT, outcome TEXT);
CREATE TABLE IF NOT EXISTS conclusion(
  key TEXT PRIMARY KEY, question TEXT, answer TEXT, evidence TEXT, ts REAL,
  hits INTEGER DEFAULT 0, audited_ok INTEGER DEFAULT 0, audited_bad INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS action_outcome(
  id INTEGER PRIMARY KEY, ts REAL, action_class TEXT, window INTEGER,
  effectiveness REAL, efficiency REAL);
CREATE TABLE IF NOT EXISTS file_state(
  path TEXT PRIMARY KEY, sha TEXT, module TEXT, symbols TEXT, imports TEXT);
"""


class Store:
    def __init__(self, path=":memory:"):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        self.db.close()

    def log_tokens(self, task_id, module, kind, input_tokens, output_tokens, cache_read=0):
        self.db.execute(
            "INSERT INTO token_log(ts,task_id,module,kind,input_tokens,output_tokens,cache_read_tokens)"
            " VALUES(?,?,?,?,?,?,?)",
            (time.time(), task_id, module, kind, input_tokens, output_tokens, cache_read))
        self.db.commit()

    def token_share_by_kind(self):
        rows = self.db.execute(
            "SELECT kind, SUM(input_tokens+output_tokens) t FROM token_log GROUP BY kind").fetchall()
        total = sum(r["t"] for r in rows) or 1
        return {r["kind"]: r["t"] / total for r in rows}

    def tokens_per_task(self):
        rows = self.db.execute(
            "SELECT task_id, SUM(input_tokens+output_tokens) t FROM token_log GROUP BY task_id").fetchall()
        return {r["task_id"]: r["t"] for r in rows}

    def cache_read_share(self):
        r = self.db.execute(
            "SELECT SUM(cache_read_tokens) c, SUM(input_tokens) i FROM token_log").fetchone()
        return (r["c"] or 0) / (r["i"] or 1)


def schema_sql():
    """The ledger contract as plain SQL, for a D1 mirror (`wrangler d1 execute --file`)."""
    return SCHEMA.strip() + "\n"
