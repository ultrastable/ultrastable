# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AUDIENCE-1: the audience loop measures supply, promotion, attention and return, files and closes its own items, ratchets its targets
and runs the producer of a stale section. Ultrastable is the foundation for any autonomous system."""
import json, sqlite3, tempfile, unittest
from pathlib import Path
from foundation import audience as A

core = A.core
RULES = {"window_days": 28, "ratchet_days": 14,
         "sections": [{"id": "papers", "kind": "json", "path": "papers.json", "list": "items", "date": "at", "text": ["title"], "url_field": "url", "max_fresh_days": 7, "producer": "research --run --apply"},
                      {"id": "notes", "kind": "json", "path": "notes.json", "list": "items", "date": "at", "text": ["title"], "url_field": "url", "max_fresh_days": 30, "producer": "reach --run --apply"}],
         "promotion": {"calendar": "cal.json"}, "hooks": [{"id": "q", "event": "quiz-complete"}],
         "metrics": [{"id": "breadth", "stage": "supply", "op": ">=", "target": 1, "remedy": "r"},
                     {"id": "cadence_per_week", "stage": "supply", "op": ">=", "target": 0.5, "ratchet": 2, "remedy": "r"},
                     {"id": "promoted_share", "stage": "promote", "op": ">=", "target": 0.5, "remedy": "r"},
                     {"id": "engagement_7d", "stage": "hook", "op": ">=", "target": 0.1, "remedy": "r"},
                     {"id": "depth_7d", "stage": "attention", "op": ">=", "target": 1.2, "remedy": "r"},
                     {"id": "followers", "stage": "return", "op": "grows", "remedy": "r"}]}


def repo(papers, notes, cal=""):
    d = Path(tempfile.mkdtemp()); import atexit, shutil; atexit.register(shutil.rmtree, d, True)
    (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    (d / "doctrine/audience.json").write_text(json.dumps(RULES))
    (d / "papers.json").write_text(json.dumps({"items": papers}))
    (d / "notes.json").write_text(json.dumps({"items": notes}))
    (d / "cal.json").write_text(cal)
    return d


class Audience(unittest.TestCase):
    def test_supply_promotion_and_breaches(self):
        d = repo([{"at": "2026-11-20", "title": "a paper on loops", "url": "https://x/p/1"}], [{"at": "2026-09-01", "title": "old", "url": "https://x/n/1"}], cal="https://x/p/1")
        r = core.run(d, today="2026-11-22", live=False)
        self.assertEqual(r["values"]["breadth"], 0.5)
        self.assertEqual(r["values"]["promoted_share"], 1.0)
        ids = {f["id"] for f in r["findings"]}
        self.assertIn("breadth", ids)
        self.assertIn("fresh:notes", ids)
        self.assertNotIn("fresh:papers", ids)
        self.assertIn("depth_7d", r["unmeasured"])   # no analytics source: unmeasured, never met

    def test_attention_from_the_analytics_tables(self):
        db = sqlite3.connect(":memory:"); db.row_factory = sqlite3.Row
        db.executescript(Path("seed/analytics/schema.sql").read_text())
        now = 1795000000
        for p, ref in [("/", "x.test"), ("/research", ""), ("/research/a", "")]:
            db.execute("INSERT INTO hits(at,host,path,ref,bot,vid,name) VALUES(?,?,?,?,0,'v','pageview')", ((now - 3600) * 1000, "h", p, ref))
        db.execute("INSERT INTO hits(at,host,path,bot,vid,name) VALUES(?,?,?,0,'f','feed')", ((now - 3600) * 1000, "h", "/research.atom"))
        db.execute("INSERT INTO analytics_meta VALUES('subs:/research.atom:feedly', ?)", (json.dumps({"n": 9, "at": (now - 60) * 1000}),))
        q = lambda sql: [dict(r) for r in db.execute(sql).fetchall()]
        v = core.attention(q, now)
        self.assertEqual((v["pageviews_7d"], v["depth_7d"], v["feed_fetches_7d"], v["feed_subscribers"]), (3, 3.0, 1, 9))
        self.assertEqual(v["direct_deep_share_7d"], 0.667)

    def test_items_close_and_the_target_ratchets(self):
        d = repo([{"at": "2026-11-20", "title": "p", "url": "u1"}], [{"at": "2026-11-21", "title": "n", "url": "u2"}], cal="u1 u2")
        r = A.run(d, apply=True, today="2026-11-01", live=False, runner=lambda c: 0)
        self.assertTrue(any(i.startswith("Q-AUD-breadth") for i in r["filed"]))  # nothing published yet on Nov 1
        self.assertEqual(r["refreshed"][0]["producer"], "research --run --apply")
        self.assertEqual(A.run(d, apply=True, today="2026-11-01", live=False, runner=lambda c: 0)["refreshed"], [])  # once a day
        r = A.run(d, apply=True, today="2026-11-22", live=False, runner=lambda c: 0)
        self.assertIn("Q-AUD-breadth", r["closed"])
        self.assertEqual(core.probe(d, "breadth")[0], True)
        A.run(d, apply=True, today="2026-12-07", live=False, runner=lambda c: 0)
        st = json.loads((d / "ops/audience/state.json").read_text())
        self.assertEqual(st["targets"]["cadence_per_week"], 1.0)  # met for 14 days, raised by x2

    def test_followers_are_read_from_public_profiles_and_unknown_is_unmeasured(self):
        cfg = {"followers": [{"channel": "bluesky", "handle": "a.test"}, {"channel": "mastodon", "handle": "b@m.test"}]}
        def get(url):
            if "bsky" in url:
                return {"followersCount": 5}
            raise OSError("down")
        self.assertEqual(core.followers(cfg, get), {"bluesky:a.test": 5, "mastodon:b@m.test": None})

    def test_platform_rules_and_seed_rules_pass(self):
        self.assertEqual(A.check(), [])
        self.assertEqual(core.check(Path("seed")), [])


if __name__ == "__main__":
    unittest.main()
