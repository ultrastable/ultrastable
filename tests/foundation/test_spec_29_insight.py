# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the analytics feedback loop, `python3 -m foundation insight` (INSIGHT-1).

US-29-R78 what is read and how a page is classified, US-29-R79 the daily cap, the cooldown and the item, US-29-R80 settlement, US-29-R81 the self-tuned threshold,
US-29-R82 the unmeasured case and the declaration check, US-29-R84 an empty window is unmeasured, and the scenario US-29-T10. Synthetic hit rows drive the real
functions; the live source runs its own SQL against the real hits schema in SQLite (D1 is SQLite); nothing else is replaced."""
import contextlib, io, json, sqlite3, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import insight as I  # noqa: E402

NOW = 1_800_000_000.0
D = 86400


def hits(path, n, days_ago, ref="", host="ultrastable.io", bot=0, name="pageview"):
    return [{"at": NOW - days_ago * D - i, "host": host, "path": path, "ref": ref, "bot": bot, "vid": f"{path}-{days_ago}-{i}", "name": name} for i in range(n)]


class SqliteLive(I.LiveSource):
    """The live source with its D1 call replaced by the same SQL on SQLite, over the hits table of seed/analytics/schema.sql."""

    def __init__(self, rows):
        self.con = sqlite3.connect(":memory:")
        self.con.executescript((ROOT / "seed/analytics/schema.sql").read_text(encoding="utf-8"))
        for r in rows:   # as seed/analytics record() writes a hit: `at` is Date.now(), in milliseconds
            self.con.execute("INSERT INTO hits(at,host,path,ref,bot,vid,name) VALUES(?,?,?,?,?,?,?)", (int(r["at"] * 1000), r["host"], r["path"], r["ref"], r["bot"], r["vid"], r["name"]))

    def _q(self, sql):
        cur = self.con.execute(sql)
        return [dict(zip([c[0] for c in cur.description], row)) for row in cur.fetchall()]


class Insight(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.cfg = I.load()

    def classes(self, rows, knob=20):
        return {t["path"]: I.classify(t, knob, self.cfg) for t in I.RowsSource(rows).trends(NOW, self.cfg)}

    def test_us_29_r78_a_page_is_read_over_the_last_seven_days_against_the_seven_before_and_classified(self):
        self.assertEqual((self.cfg["window_days"], self.cfg["rise_min_views"], self.cfg["rise_ratio"], self.cfg["fade_ratio"], self.cfg["external_pull_min"]), (7, 20, 2.0, 0.4, 3))
        rows = (hits("/rise", 40, 2) + hits("/rise", 10, 9)                                   # 40 against 10: at least the knob and at least twice the week before
                + hits("/rise-low", 39, 2) + hits("/rise-low", 20, 9)                         # 39 against 20: not twice
                + hits("/fade", 10, 2) + hits("/fade", 40, 9)                                 # 10 against 40: under 0.4 of the week before
                + hits("/pull", 3, 1, ref="https://news.example.org/a") + hits("/pull", 40, 2) + hits("/pull", 5, 9)   # outside readers win over rising
                + hits("/own-ref", 5, 1, ref="https://sub.ultrastable.io/x")                  # a referrer on the site's own host is not an outside reader
                + hits("/old", 50, 20))                                                       # older than 14 days: not read at all
        got = self.classes(rows)
        self.assertEqual(got["/rise"], "rising")
        self.assertIsNone(got["/rise-low"])
        self.assertEqual(got["/fade"], "fading")
        self.assertEqual(got["/pull"], "external_pull")
        self.assertIsNone(got["/own-ref"])
        self.assertNotIn("/old", got)

    def test_us_29_r78_bots_other_events_future_hits_and_non_content_paths_are_left_out(self):
        rows = (hits("/page", 15, 2) + hits("/page", 99, 2, bot=1) + hits("/page", 99, 2, name="click") + [dict(r, at=NOW + 100 + r["at"] - NOW) for r in hits("/page", 99, 0)])
        t = {x["path"]: x for x in I.RowsSource(rows).trends(NOW, self.cfg)}
        self.assertEqual((t["/page"]["v7"], t["/page"]["visitors7"]), (15, 15))
        for p in ("/api/x", "/_next/a", "/health", "/llms.txt", "/app.js", "/data.json", "/style.css"):
            self.assertFalse(I.content(p, self.cfg), p)
        self.assertTrue(I.content("/use-cases", self.cfg))
        self.assertIsNone(I.classify({"path": "/api/x", "v7": 500, "prev7": 0, "ext7": 50}, 20, self.cfg), "a page that is not content is never classified")

    def test_us_29_r79_at_most_two_items_a_day_best_first_none_for_a_fading_page_and_each_item_closes_by_its_own_settlement(self):
        rows = hits("/a", 41, 2) + hits("/b", 60, 2) + hits("/c", 30, 2) + hits("/x", 20, 2, ref="https://o.example/") + hits("/f", 10, 2) + hits("/f", 50, 9)
        rep = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))
        self.assertEqual(len(rep["filed"]), self.cfg["max_actions_per_day"])
        st = I.read_state(self.root)
        paths = {f["path"]: f for f in st["findings"] if f["item"]}
        self.assertEqual(sorted(paths), ["/b", "/x"], "ranked by three times the outside views plus the views: /x scores 60 plus 20, /b 60, /a 41, /c 30")
        self.assertEqual({f["path"]: f["status"] for f in st["findings"] if f["kind"] == "fading"}, {"/f": "acted"}, "decay is recorded and no item is filed for it")
        item = json.loads((self.root / "docs/issues" / f"{paths['/b']['item']}.json").read_text())
        self.assertTrue(paths["/b"]["item"].startswith("Q-INSIGHT-"))
        self.assertEqual(item["labels"], ["p1", "growth", "agent-ready"])
        self.assertIn(f"cmd:python3 -m foundation insight --settled {paths['/b']['id']}", item["body"])
        self.assertIn("keeps at least 50 percent of 60 views", item["body"], "the prediction is in the item")

    def test_us_29_r79_a_page_acted_on_inside_the_cooldown_is_recorded_again_but_not_filed_again(self):
        st = {"rise_min_views": None, "knob_log": [], "findings": [{"id": "old1", "kind": "rising", "path": "/a", "at": NOW - 10 * D, "v7": 30, "prev7": 1, "ext7": 0, "status": "acted", "item": "Q-INSIGHT-old1"}]}
        I.write_state(self.root, st)
        rep = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(hits("/a", 45, 2)))
        self.assertEqual(len(rep["new"]), 1, "ten days on, the page is a new finding (the record repeats only inside 7 days)")
        self.assertEqual(rep["filed"], [], "inside the 14 days of cooldown no second item is filed")
        later = I.run(self.root, apply=True, now=NOW + 5 * D, source=I.RowsSource([dict(r, at=r["at"] + 5 * D) for r in hits("/a", 45, 2)]))
        self.assertEqual(later["new"], [], "the same class for the same page is not recorded twice inside 7 days")

    def test_us_29_r80_a_finding_settles_only_after_eight_days_against_the_next_seven_and_is_held_or_missed(self):
        self.assertEqual((self.cfg["settle_after_days"], self.cfg["hold_ratio"], self.cfg["fade_hold_ratio"]), (8, 0.5, 1.5))
        f = lambda i, kind, path, v7: {"id": i, "kind": kind, "path": path, "at": NOW, "v7": v7, "prev7": 0, "ext7": 0, "status": "acted", "item": None}
        st = {"rise_min_views": None, "knob_log": [], "findings": [f("r1", "rising", "/held", 40), f("r2", "rising", "/missed", 40), f("f1", "fading", "/fade-held", 14), f("f2", "fading", "/fade-missed", 14)]}
        after = lambda path, n: [{"at": NOW + D + i, "host": "h", "path": path, "ref": "", "bot": 0, "vid": f"{path}{i}", "name": "pageview"} for i in range(n)]
        src = I.RowsSource(after("/held", 20) + after("/missed", 19) + after("/fade-held", 21) + after("/fade-missed", 22))
        self.assertEqual(I.settle(st, src, NOW + 7.9 * D, self.cfg), [], "nothing settles before the 8 days are up")
        self.assertEqual(sorted(I.settle(st, src, NOW + 8 * D, self.cfg)), ["f1", "f2", "r1", "r2"])
        got = {x["id"]: (x["status"], x["outcome"], x["observed"]) for x in st["findings"]}
        self.assertEqual(got, {"r1": ("settled", "held", 20), "r2": ("settled", "missed", 19), "f1": ("settled", "held", 21), "f2": ("settled", "missed", 22)},
                         "a rising page is held at half of its views or more, a fading page at one and a half times its views or less")
        self.assertEqual(I.settle(st, src, NOW + 30 * D, self.cfg), [], "a settled finding is not settled again")

    def test_us_29_r81_the_threshold_is_raised_or_lowered_from_the_settled_rising_findings_once_and_inside_its_bounds(self):
        k = self.cfg["knob"]
        self.assertEqual((k["min"], k["max"], k["raise"], k["lower"], k["min_settled"], k["raise_below"], k["lower_above"]), (5, 200, 1.25, 0.9, 10, 0.5, 0.8))
        mk = lambda n, outcome, at: [{"id": f"x{i}", "kind": "rising", "path": f"/p{i}", "at": 0, "v7": 30, "status": "settled", "outcome": outcome, "settled_at": at + i} for i in range(n)]
        few = {"rise_min_views": None, "knob_log": [], "findings": mk(9, "missed", NOW)}
        self.assertIsNone(I.tune(few, self.cfg, NOW + 100), "under ten settled rising findings the threshold stays")
        st = {"rise_min_views": None, "knob_log": [], "findings": mk(10, "missed", NOW)}
        e = I.tune(st, self.cfg, NOW + 100)
        self.assertEqual((e["from"], e["to"], e["held_rate"], e["of"]), (20, 25, 0.0, 10))
        self.assertIn("prediction", e); self.assertEqual(st["rise_min_views"], 25); self.assertEqual(len(st["knob_log"]), 1)
        self.assertIsNone(I.tune(st, self.cfg, NOW + 200), "no new settled finding since the last change: no second change")
        st["findings"] = mk(10, "held", NOW + 1000)
        self.assertEqual((I.tune(st, self.cfg, NOW + 2000)["to"]), 22, "more than 80 percent held: lowered by a tenth")
        st["rise_min_views"] = 190; st["findings"] = mk(10, "missed", NOW + 3000)
        self.assertEqual(I.tune(st, self.cfg, NOW + 4000)["to"], 200, "raised no higher than the ceiling")
        st["rise_min_views"] = 5; st["findings"] = mk(10, "held", NOW + 5000)
        self.assertIsNone(I.tune(st, self.cfg, NOW + 6000), "already at the floor: nothing to change")
        mid = {"rise_min_views": None, "knob_log": [], "findings": mk(5, "held", NOW) + [dict(x, outcome="missed") for x in mk(5, "x", NOW + 50)]}
        self.assertIsNone(I.tune(mid, self.cfg, NOW + 100), "a held rate between 0.5 and 0.8 leaves it")
        fad = {"rise_min_views": None, "knob_log": [], "findings": [dict(x, kind="fading") for x in mk(12, "missed", NOW)]}
        self.assertIsNone(I.tune(fad, self.cfg, NOW + 100), "only rising findings tune it")

    def test_us_29_r82_with_no_hits_source_the_run_is_unmeasured_writes_nothing_and_files_nothing(self):
        rep = I.run(self.root, apply=True, now=NOW, source=None, use_live=False)
        self.assertEqual((rep["measured"], rep["filed"]), (False, []))
        self.assertFalse((self.root / "ops/insight/findings.json").exists())
        self.assertFalse((self.root / "docs/issues").exists())
        self.assertIsNone(I.source_from_env(self.cfg, env={}), "no token, no live source")

    def test_us_29_r82_the_check_names_a_missing_key_and_a_settle_window_that_does_not_exceed_the_read_window(self):
        (self.root / "doctrine").mkdir(); (self.root / "foundation").mkdir(); (self.root / "instances/ultrastable").mkdir(parents=True)
        (self.root / "foundation/pm.py").write_text("insight\n")
        (self.root / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [{"id": "insight-loop"}]}))
        cfg = json.loads((ROOT / I.PATH).read_text())
        del cfg["hold_ratio"]
        (self.root / I.PATH).write_text(json.dumps(cfg))
        self.assertEqual(I.check(self.root), [f"{I.PATH}: missing hold_ratio"])
        (self.root / I.PATH).write_text((ROOT / I.PATH).read_text())
        self.assertEqual(I.check(self.root), [], "the same declaration, whole, passes")
        cfg = json.loads((ROOT / I.PATH).read_text()); cfg["settle_after_days"] = cfg["window_days"]
        (self.root / I.PATH).write_text(json.dumps(cfg))
        self.assertTrue(any("settle_after_days must exceed window_days" in e for e in I.check(self.root)))
        self.assertEqual(I.check(ROOT), [])

    # ---- added with the fixes of 2026-11-26 ----

    def test_us_29_r78_a_referrer_stored_as_a_bare_host_is_read_as_the_beacon_writes_it(self):
        for ref, outside in (("news.example.org", True), ("https://news.example.org/a", True), ("myultrastable.io", True), ("ultrastable.io.evil.example", True),
                             ("ultrastable.io", False), ("blog.ultrastable.io", False), ("https://sub.ultrastable.io/x", False), ("", False)):
            with self.subTest(ref):
                self.assertEqual(I._external(ref, "ultrastable.io"), outside)
        rows = hits("/pull", 3, 1, ref="news.example.org") + hits("/pull", 4, 2)
        self.assertEqual(self.classes(rows)["/pull"], "external_pull", "three views from another host, stored host-only, are outside readers")

    def test_us_29_r78_the_live_source_reads_the_millisecond_times_and_the_host_only_referrers_the_beacon_writes(self):
        rows = (hits("/a", 30, 2) + hits("/a", 10, 9) + hits("/a", 3, 1, ref="news.example.org") + hits("/a", 2, 1, ref="myultrastable.io")
                + hits("/a", 2, 1, ref="blog.ultrastable.io") + hits("/a", 9, 2, bot=1) + hits("/a", 9, 2, name="selfcheck") + hits("/a", 50, 20)
                + [dict(r, at=NOW + 3600 + i) for i, r in enumerate(hits("/a", 5, 0))] + hits("/b", 4, 3))
        live, offline = SqliteLive(rows), I.RowsSource(rows)
        self.addCleanup(live.con.close)
        by = lambda src: {t["path"]: t for t in src.trends(NOW, self.cfg)}
        self.assertEqual(by(live)["/a"], {"path": "/a", "v7": 37, "prev7": 10, "ext7": 5, "visitors7": 33},
                         "7 days against the 7 before, in milliseconds; a bare host of another site is outside, a subdomain is not; a visitor id seen twice counts once")
        self.assertEqual(by(live), by(offline), "the live source and the offline source read the same hits the same way")
        self.assertEqual((live.observed("/a", NOW - 3 * D, NOW), live.observed("/a", NOW - 30 * D, NOW - 25 * D)), (37, 0))
        self.assertEqual(live.observed("/a", NOW - 3 * D, NOW), offline.observed("/a", NOW - 3 * D, NOW))
        self.assertEqual((live.views(NOW - 4 * D, NOW), offline.views(NOW - 4 * D, NOW), live.views(NOW + 10 * D, NOW + 11 * D)), (41, 41, 0))

    def test_us_29_r79_a_run_that_is_not_applied_writes_no_item_and_no_state(self):
        rep = I.run(self.root, apply=False, now=NOW, source=I.RowsSource(hits("/a", 41, 2) + hits("/b", 60, 2)))
        self.assertEqual(len(rep["filed"]), 2, "the dry run reports what it would file")
        self.assertFalse((self.root / "docs/issues").exists())
        self.assertFalse((self.root / I.STATE).exists())

    def test_us_29_r79_the_day_budget_counts_items_filed_that_day_so_a_rerun_over_a_backlog_files_nothing_more(self):
        rows = sum((hits(f"/p{i}", 30 + i, 2) for i in range(6)), [])
        self.assertEqual(len(I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))["filed"]), 2)
        nxt = NOW + D
        src = I.RowsSource([dict(r, at=r["at"] + D) for r in rows])
        first = I.run(self.root, apply=True, now=nxt, source=src)
        self.assertEqual(len(first["filed"]), 2, "the next day takes two of the four findings the cap left open")
        again = [I.run(self.root, apply=True, now=nxt + h * 3600, source=src)["filed"] for h in (1, 6)]
        self.assertEqual(again, [[], []], "reruns on the same UTC day file nothing more, though the findings they could file were recorded the day before")
        st = I.read_state(self.root)
        self.assertEqual(sorted(I._day(f["filed_at"]) for f in st["findings"] if f["item"]), [I._day(NOW)] * 2 + [I._day(nxt)] * 2, "each item carries the time it was filed")
        self.assertEqual(len(list((self.root / "docs/issues").glob("Q-INSIGHT-*.json"))), 4)

    def test_us_29_r79_the_cooldown_of_a_page_runs_from_the_day_its_last_item_was_filed(self):
        st = {"rise_min_views": None, "knob_log": [], "findings": [
            {"id": "late", "kind": "rising", "path": "/a", "at": NOW - 20 * D, "filed_at": NOW - 5 * D, "v7": 30, "prev7": 1, "ext7": 0, "status": "acted", "item": "Q-INSIGHT-late"}]}
        I.write_state(self.root, st)
        rep = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(hits("/a", 45, 2)))
        self.assertEqual((len(rep["new"]), rep["filed"]), (1, []), "recorded 20 days ago but filed 5 days ago: still inside the 14 days")
        rep = I.run(self.root, apply=True, now=NOW + 10 * D, source=I.RowsSource([dict(r, at=r["at"] + 10 * D) for r in hits("/a", 45, 2)]))
        self.assertEqual(len(rep["filed"]), 1, "15 days after the last filing a new item may be filed")

    def test_us_29_r82_the_check_names_each_condition_it_guards(self):
        (self.root / "doctrine").mkdir(); (self.root / "foundation").mkdir(); (self.root / "instances/ultrastable").mkdir(parents=True)
        whole = (ROOT / I.PATH).read_text()
        def world(cfg=None, loops=("insight-loop",), pm="from . import insight\n"):
            (self.root / I.PATH).write_text(json.dumps(cfg) if cfg is not None else whole)
            (self.root / "instances/ultrastable/loop-registry.json").write_text(json.dumps({"loops": [{"id": x} for x in loops]}))
            (self.root / "foundation/pm.py").write_text(pm)
            return I.check(self.root)
        self.assertEqual(world(), [])
        for name, kw, want in (
                ("threshold over the ceiling", {"cfg": dict(json.loads(whole), rise_min_views=500)}, "rise_min_views is outside the knob bounds"),
                ("threshold under the floor", {"cfg": dict(json.loads(whole), rise_min_views=1)}, "rise_min_views is outside the knob bounds"),
                ("no growth label", {"cfg": dict(json.loads(whole), item=dict(json.loads(whole)["item"], labels=["p1", "agent-ready"]))}, "growth label"),
                ("no insight loop", {"loops": ("growth-loop",)}, "insight-loop is not in"),
                ("pm does not run it", {"pm": "def run():\n    return None\n"}, "does not run the insight stage")):
            with self.subTest(name):
                errs = world(**kw)
                self.assertEqual(len(errs), 1, errs)
                self.assertIn(want, errs[0])
        (self.root / "instances/ultrastable/loop-registry.json").unlink()
        self.assertIn("loop registry missing", I.check(self.root))

    def test_us_29_r84_a_week_with_no_human_page_view_is_unmeasured_and_nothing_settles_tunes_or_is_written(self):
        open9 = {"id": "o9", "kind": "rising", "path": "/a", "at": NOW - 9 * D, "v7": 40, "prev7": 5, "ext7": 0, "status": "acted", "item": "Q-INSIGHT-o9", "observed": None, "outcome": None}
        st = {"rise_min_views": None, "knob_log": [], "findings": [open9] + [
            {"id": f"x{i}", "kind": "rising", "path": f"/p{i}", "at": NOW - 30 * D, "v7": 30, "status": "settled", "outcome": "missed", "settled_at": NOW - 20 * D} for i in range(9)]}
        I.write_state(self.root, st)
        before = (self.root / I.STATE).read_text()
        for name, rows in (("no rows at all", []), ("only bots, other events and old hits", hits("/a", 9, 2, bot=1) + hits("/a", 9, 2, name="selfcheck") + hits("/a", 30, 9))):
            with self.subTest(name):
                rep = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(rows))
                self.assertEqual((rep["measured"], rep["filed"]), (False, []), rep)
                self.assertIn("no human page view", rep["why"])
                self.assertEqual((self.root / I.STATE).read_text(), before, "the finding stays open, nothing is tuned, the ledger is not written")
        self.assertFalse((self.root / "docs/issues").exists())

    def test_us_29_r84_a_finding_whose_own_window_holds_no_page_view_stays_open_while_the_others_settle(self):
        f = lambda i, at: {"id": i, "kind": "rising", "path": "/a", "at": at, "v7": 40, "prev7": 0, "ext7": 0, "status": "acted", "item": None}
        st = {"rise_min_views": None, "knob_log": [], "findings": [f("gap", NOW - 30 * D), f("ok", NOW - 9 * D)]}
        src = I.RowsSource(hits("/b", 5, 8))   # views on another page in the window of "ok"; nothing at all in the window of "gap"
        self.assertEqual(I.settle(st, src, NOW, self.cfg), ["ok"])
        self.assertEqual({x["id"]: (x["status"], x.get("outcome")) for x in st["findings"]}, {"gap": ("acted", None), "ok": ("settled", "missed")},
                         "a page with no views while the site had some is missed; a window with no views at all is not read")

    def test_us_29_t10_a_week_of_rising_pulling_fading_and_script_pages_is_filed_settled_and_tunes_the_threshold_once(self):
        nine = [{"id": f"m{i}", "kind": "rising", "path": f"/m{i}", "at": NOW - 40 * D, "v7": 30, "prev7": 1, "ext7": 0, "status": "settled", "outcome": "missed",
                 "observed": 0, "settled_at": NOW - 30 * D + i, "item": None} for i in range(9)]
        I.write_state(self.root, {"rise_min_views": None, "knob_log": [], "findings": nine})
        week = (hits("/rose", 40, 2) + hits("/rose", 10, 9) + hits("/pull", 20, 1, ref="news.example.org") + hits("/faded", 8, 2) + hits("/faded", 40, 9)
                + hits("/app.js", 90, 2))
        day0 = I.run(self.root, apply=True, now=NOW, source=I.RowsSource(week))
        self.assertEqual(sorted((n["path"], n["kind"]) for n in day0["new"]), [("/faded", "fading"), ("/pull", "external_pull"), ("/rose", "rising")], "the script file is not a page")
        self.assertEqual(len(day0["filed"]), 2)
        self.assertEqual(I.run(self.root, apply=True, now=NOW + 3600, source=I.RowsSource(week))["filed"], [], "a rerun on the same day files nothing more")
        st = I.read_state(self.root)
        ids = {f["path"]: f["id"] for f in st["findings"] if f["at"] == NOW}
        self.assertEqual(sorted(f["path"] for f in st["findings"] if f.get("item")), ["/pull", "/rose"], "no item for the fading page or the script")
        for p in ("/pull", "/rose"):
            item = json.loads((self.root / "docs/issues" / f"Q-INSIGHT-{ids[p]}.json").read_text())
            self.assertIn("growth", item["labels"]); self.assertIn(f"insight --settled {ids[p]}", item["body"])
        real = I.read_state
        probe = lambda i: (mock.patch.object(I, "read_state", lambda root=None: real(self.root)), i)
        for p in ("/pull", "/rose"):
            patch, i = probe(ids[p])
            with patch, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(I.main(["--settled", i]), 1, "the closing probe fails until the finding settles")
        after = (hits("/rose", 25, -2) + hits("/pull", 5, -2) + hits("/faded", 8, -2))   # the week after the findings: /rose keeps 25 of 40, /pull 5 of 20, /faded stays at 8
        d8 = I.run(self.root, apply=True, now=NOW + 8 * D, source=I.RowsSource(week + after))
        self.assertTrue(d8["measured"])
        self.assertEqual(sorted(d8["settled"]), sorted(ids.values()))
        st = I.read_state(self.root)
        self.assertEqual({f["path"]: f["outcome"] for f in st["findings"] if f["id"] in ids.values()}, {"/rose": "held", "/pull": "missed", "/faded": "held"})
        for p in ("/pull", "/rose"):
            patch, i = probe(ids[p])
            with patch, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(I.main(["--settled", i]), 0, "each item closes by its own settlement")
        self.assertEqual((d8["tuned"]["from"], d8["tuned"]["to"], d8["tuned"]["of"]), (20, 25, 10), "the tenth settled rising finding, one of ten held: the threshold moves once")
        self.assertEqual(d8["filed"], [], "no second item for a page inside 14 days")
        d9 = I.run(self.root, apply=True, now=NOW + 9 * D, source=I.RowsSource(week + after))
        self.assertIsNone(d9["tuned"], "and not again without a new settled finding")
        self.assertEqual(len(I.read_state(self.root)["knob_log"]), 1)
        quiet = I.run(self.root, apply=True, now=NOW + 10 * D, source=I.RowsSource([]))
        self.assertFalse(quiet["measured"], "a week with no hits is not read as a quiet one")


if __name__ == "__main__":
    unittest.main()
