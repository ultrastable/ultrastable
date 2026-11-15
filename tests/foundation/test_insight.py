"""INSIGHT-1: analytics as a feedback loop. Synthetic first-party hits drive the real functions: classification, the daily cap and cooldown, settlement against what a page really got,
and the self-tuned threshold. Nothing is stubbed except the hits rows."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import insight as I  # noqa: E402

NOW = 1_800_000_000.0
D = 86400


def hits(path, n, days_ago, ref="", host="ultrastable.io", bot=0, vids=None):
    return [{"at": NOW - days_ago * D - i, "host": host, "path": path, "ref": ref, "bot": bot, "vid": (vids or {}).get(i, f"{path}-{i}"), "name": "pageview"} for i in range(n)]


def world():
    rows = []
    rows += hits("/use-cases", 51, 2)                                           # rising: 0 before, 51 now
    rows += hits("/pilot", 12, 2, ref="https://news.example.org/x")            # external pull
    rows += hits("/pilot", 4, 3)                                               # ... plus own traffic
    rows += hits("/old-post", 76, 10) + hits("/old-post", 14, 2)               # fading: 76 -> 14
    rows += hits("/steady", 30, 10) + hits("/steady", 28, 2)                   # steady
    rows += hits("/tiny", 4, 2)                                                # under the knob
    rows += hits("/api/feed", 90, 2)                                           # not content
    rows += hits("/use-cases", 99, 2, bot=1)                                   # bots never count
    return rows


class Insight(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.cfg = I.load()

    def test_declaration_is_complete(self):
        self.assertEqual(I.check(), [])

    def test_classes(self):
        by = {t["path"]: I.classify(t, 20, self.cfg) for t in I.RowsSource(world()).trends(NOW, self.cfg)}
        self.assertEqual(by["/use-cases"], "rising")
        self.assertEqual(by["/pilot"], "external_pull")
        self.assertEqual(by["/old-post"], "fading")
        self.assertIsNone(by["/steady"])
        self.assertIsNone(by["/tiny"])
        self.assertIsNone(by["/api/feed"])

    def test_bots_and_visitors(self):
        t = {x["path"]: x for x in I.RowsSource(world()).trends(NOW, self.cfg)}
        self.assertEqual(t["/use-cases"]["v7"], 51)          # the 99 bot hits are not counted
        self.assertEqual(t["/pilot"]["ext7"], 12)
        self.assertEqual(t["/pilot"]["visitors7"], 12)       # the 4 own-traffic hits reuse four visitor ids: returning visitors count once

    def test_run_files_capped_growth_items_and_is_idempotent(self):
        rows = world() + hits("/third", 40, 2)
        rep = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))
        self.assertTrue(rep["measured"])
        self.assertEqual(len(rep["filed"]), 2)                                   # cap: two a day, the third waits
        items = [json.loads(p.read_text()) for p in sorted((self.root / "docs/issues").glob("Q-INSIGHT-*.json"))]
        self.assertEqual(len(items), 2)
        self.assertTrue(all("growth" in i["labels"] and "agent-ready" in i["labels"] for i in items))
        self.assertTrue(all("insight --settled" in i["body"] for i in items))
        again = I.run(self.root, apply=True, now=NOW + 3600, source=I.RowsSource(rows))
        self.assertEqual(again["new"], [])                                      # same findings inside 7 days are not recorded again
        self.assertEqual(again["filed"], [])                                    # and the day's budget is spent
        st = I.read_state(self.root)
        self.assertEqual(len([f for f in st["findings"] if f["item"]]), 2)
        self.assertEqual([f["status"] for f in st["findings"] if f["kind"] == "fading"], ["acted"])

    def test_next_day_takes_the_waiting_finding(self):
        rows = world() + hits("/third", 40, 2)
        I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))
        nxt = NOW + D
        rows2 = [dict(r, at=r["at"] + D) for r in rows]
        rep = I.run(self.root, apply=True, now=nxt, source=I.RowsSource(rows2))
        self.assertEqual(len(rep["filed"]), 1)                                  # the third rising page, within cooldown for the first two

    def test_settle_held_and_missed(self):
        rows = world()
        I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))
        later = NOW + 9 * D
        # /use-cases keeps 40 of 51 views in the week after the finding; /pilot gets nothing
        after = [{"at": NOW + 2 * D + i, "host": "ultrastable.io", "path": "/use-cases", "ref": "", "bot": 0, "vid": f"a{i}", "name": "pageview"} for i in range(40)]
        rep = I.run(self.root, apply=True, now=later, source=I.RowsSource(after))
        self.assertGreaterEqual(len(rep["settled"]), 2)
        f = {x["path"]: x for x in I.read_state(self.root)["findings"] if x["kind"] != "fading" and x["status"] == "settled"}
        self.assertEqual((f["/use-cases"]["outcome"], f["/use-cases"]["observed"]), ("held", 40))
        self.assertEqual(f["/pilot"]["outcome"], "missed")
        self.assertEqual(I.main(["--settled", f["/use-cases"]["id"]]), 1)       # the real repo's ledger does not hold this id: exit 1 means not settled there

    def test_threshold_tunes_once_and_inside_bounds(self):
        st = {"rise_min_views": None, "knob_log": [], "findings": [
            {"id": f"x{i}", "kind": "rising", "path": f"/p{i}", "at": NOW - 20 * D, "v7": 30, "status": "settled", "outcome": "missed", "settled_at": NOW - 3600 + i, "observed": 0}
            for i in range(12)]}
        e = I.tune(st, self.cfg, NOW)
        self.assertEqual((e["from"], e["to"]), (20, 25))
        self.assertIsNone(I.tune(st, self.cfg, NOW + 1))                          # no new settled finding: no second change
        for f in st["findings"]:
            f["outcome"], f["settled_at"] = "held", NOW + 10
        e2 = I.tune(st, self.cfg, NOW + 20)
        self.assertEqual((e2["from"], e2["to"]), (25, 22))                       # lowered 10 percent when almost all held
        st["rise_min_views"] = self.cfg["knob"]["min"]
        for f in st["findings"]:
            f["settled_at"] = NOW + 30
        self.assertIsNone(I.tune(st, self.cfg, NOW + 40))                         # already at the floor: held stays put
        self.assertEqual(st["rise_min_views"], self.cfg["knob"]["min"])

    def test_no_source_is_reported_not_crashed(self):
        rep = I.run(self.root, apply=True, now=NOW, source=None, use_live=False)
        self.assertFalse(rep["measured"])
        self.assertFalse((self.root / "ops/insight/findings.json").exists())

    def test_pm_runs_the_stage(self):
        self.assertIn("insight", Path(I.REPO / "foundation/pm.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
