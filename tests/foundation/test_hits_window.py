# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""The 7-day reads of the first-party hits table (growth.hits_metrics, reach.live_rows) bound `at` in epoch milliseconds, the unit
seed/analytics record() writes (Date.now()). With a bound in seconds every raw row up to the retention limit was read as the last 7 days.
The SQL each function sends is run against a real SQLite hits table with the analytics schema, so the window is the one the database applies."""
import sqlite3, sys, unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import clock, growth, reach  # noqa: E402

NOW = 1_795_000_000  # seconds
DAY_MS = 86_400_000


def table(rows):
    db = sqlite3.connect(":memory:"); db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE hits (at INTEGER, host TEXT, path TEXT, ref TEXT, country TEXT, device TEXT, bot INTEGER, vid TEXT, name TEXT)")
    db.executemany("INSERT INTO hits (at, host, path, ref, country, device, bot, vid, name) VALUES (?,?,?,?,?,?,?,?,?)", rows)
    return db


def cf_over(db):
    def cf(path, body, token, acct):
        return {"result": [{"results": [dict(r) for r in db.execute(body["sql"]).fetchall()]}]}
    return cf


class HitsWindowIsMilliseconds(unittest.TestCase):
    def rows(self):
        now_ms = NOW * 1000
        hit = lambda days_ago, path="/a", bot=0, vid="v1", name="pageview": (now_ms - int(days_ago * DAY_MS), "ultrastable.io", path, "", "", "d", bot, vid, name)
        return [hit(1), hit(2, vid="v2"), hit(3, path="/pilot/x", vid="v3"), hit(1, bot=1),  # inside the week
                hit(10), hit(20, vid="v4"), hit(30, path="/pilot/y"), hit(12, bot=1)]          # older than the week

    def test_growth_hits_metrics_counts_only_the_last_seven_days(self):
        with mock.patch.object(clock, "_cf", cf_over(table(self.rows()))):
            m = growth.hits_metrics("t", "a", "db", now=NOW)
        self.assertEqual(m, {"pageviews_7d": 3, "visitors_7d": 3, "agent_hits_7d": 1, "pilot_page_views_7d": 1})

    def test_reach_live_rows_reads_only_the_last_seven_days(self):
        with mock.patch.object(clock, "_cf", cf_over(table(self.rows()))):
            rows = reach.live_rows({"CLOUDFLARE_API_TOKEN": "t"}, now=NOW)
        self.assertEqual(sorted(r["path"] for r in rows), ["/a", "/a", "/pilot/x"], "the human rows of the week; a bot hit off the feed is left out")


if __name__ == "__main__":
    unittest.main()
