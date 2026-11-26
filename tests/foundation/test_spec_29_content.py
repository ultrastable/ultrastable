# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the checks that a system's own content is alive: static pages (`python3 -m foundation
staticcontent` and the seed's `scripts/staticcontent.py`) and drifted entries (`python3 -m foundation contentdrift`).

US-29-R53 a page's identity is its visible text, US-29-R54 the judgement, US-29-R55 the portable script of the seed, US-29-R56 and US-29-R57 the entry checks."""
import importlib.util, json, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import contentdrift as C  # noqa: E402
from foundation import staticcontent as S  # noqa: E402

_spec = importlib.util.spec_from_file_location("seed_staticcontent", ROOT / "seed/scripts/staticcontent.py")
SEED = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SEED)

RULES = {"max_unchanged_days": 14, "max_pages": 3, "exempt": [{"pattern": "/(terms|privacy)(/|$)", "reason": "policy text changes by decision"}]}


def tmp(case):
    td = tempfile.TemporaryDirectory(prefix="ultrastable-test-spec29-"); case.addCleanup(td.cleanup)
    return Path(td.name)


class Identity(unittest.TestCase):
    def test_us_29_r53_a_page_is_its_visible_text_so_markup_scripts_comments_and_whitespace_are_not_a_change(self):
        a = "<html><head><style>a{}</style></head><script>n=1</script><!-- v1 --><p class=a>Hello  <b>world</b></p><noscript>x</noscript></html>"
        b = "<html><script>n=2</script><!-- v2 --><p class=b id=nonce9>Hello\n world</p></html>"
        self.assertEqual(S.normalize(a), "Hello world")
        self.assertEqual(S.digest(a), S.digest(b))
        self.assertNotEqual(S.digest(a), S.digest("<p>Hello again</p>"))
        self.assertEqual(len(S.digest(a)), 16)

    def test_us_29_r53_a_ledger_row_moves_only_when_the_text_does_and_an_unreadable_page_neither_changes_nor_passes(self):
        led = S.observe({}, {"u": "<p>a</p>"}, "2026-11-01")
        self.assertEqual(led["u"]["first_seen"], "2026-11-01"); self.assertEqual(led["u"]["last_changed"], "2026-11-01")
        self.assertEqual(S.observe(led, {"u": "<p class=x>a</p>"}, "2026-11-10"), led)
        moved = S.observe(led, {"u": "<p>b</p>"}, "2026-11-10")
        self.assertEqual((moved["u"]["first_seen"], moved["u"]["last_changed"]), ("2026-11-01", "2026-11-10"))
        self.assertEqual(S.observe(led, {"u": None}, "2026-11-10"), led)
        self.assertIsNot(S.observe(led, {}, "2026-11-10")["u"], led["u"], "the input ledger is not changed in place")
        self.assertEqual(S.observe(led, {"v": None}, "2026-11-10"), led, "a page never read has no row")


class Judgement(unittest.TestCase):
    LED = {"https://x/a": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-10-01"},
           "https://x/terms": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-10-01"},
           "https://x/live": {"hash": "h", "first_seen": "2026-10-01", "last_changed": "2026-11-20"},
           "https://x/new": {"hash": "h", "first_seen": "2026-11-20", "last_changed": "2026-11-20"}}

    def test_us_29_r54_a_page_unchanged_for_the_window_and_watched_that_long_is_a_finding_and_policy_pages_are_exempt(self):
        r = S.judge(self.LED, "2026-11-25", RULES)
        self.assertEqual([x["url"] for x in r["static"]], ["https://x/a"])
        self.assertEqual(r["static"][0]["unchanged_days"], 55)
        self.assertEqual((r["watched"], r["tracked"], r["measured"]), (2, 4, True), "the exempt page and the page too young to judge are tracked but not watched")
        self.assertEqual(S.exempt("https://x/terms", RULES), "policy text changes by decision"); self.assertIsNone(S.exempt("https://x/a", RULES))
        edge = {"u": {"hash": "h", "first_seen": "2026-11-01", "last_changed": "2026-11-01"}}
        self.assertEqual(S.judge(edge, "2026-11-14", RULES)["static"], [], "13 days is inside the window")
        self.assertEqual(len(S.judge(edge, "2026-11-15", RULES)["static"]), 1, "14 days is the window")

    def test_us_29_r54_a_ledger_younger_than_the_window_is_unmeasured_and_never_a_pass(self):
        r = S.judge({"u": {"hash": "h", "first_seen": "2026-11-20", "last_changed": "2026-11-20"}}, "2026-11-25", RULES)
        self.assertFalse(r["measured"]); self.assertEqual(r["static"], [])
        self.assertFalse(S.judge({}, "2026-11-25", RULES)["measured"])
        cfg = S.cfg(); self.assertEqual(cfg["marker"], "STATIC-CONTENT-1"); self.assertEqual(cfg["max_unchanged_days"], 14)

    def test_us_29_r54_the_pages_of_each_system_come_from_its_sitemap_up_to_the_limit_else_its_front_page(self):
        d = tmp(self)
        (d / "instances/ultrastable").mkdir(parents=True)
        (d / S.SYSTEMS).write_text(json.dumps({"systems": [{"id": "a", "url": "https://a.example/"}, {"id": "b", "url": "https://b.example"}, {"id": "c"}]}))
        sm = "<urlset>" + "".join(f"<url><loc> https://a.example/p{i} </loc></url>" for i in range(5)) + "</urlset>"
        asked = []
        got = lambda u: (asked.append(u), sm if u == "https://a.example/sitemap.xml" else None)[1]  # noqa: E731
        urls = S.pages(d, RULES, got)
        self.assertEqual(urls, ["https://a.example/p0", "https://a.example/p1", "https://a.example/p2", "https://b.example/"], "three from the sitemap; a site with none is its front page; a system with no address is skipped")
        self.assertEqual(asked, ["https://a.example/sitemap.xml", "https://b.example/sitemap.xml"])

    def test_us_29_r54_a_run_reads_every_page_but_the_exempt_ones_and_writes_the_ledger_only_when_asked(self):
        d = tmp(self)
        (d / "instances/ultrastable").mkdir(parents=True); (d / "doctrine").mkdir(); (d / "ops").mkdir()
        (d / S.SYSTEMS).write_text(json.dumps({"systems": [{"id": "a", "url": "https://a.example"}]}))
        (d / S.RULES).write_text(json.dumps(RULES))
        read = []

        def get(u):
            read.append(u)
            return "<urlset><loc>https://a.example/x</loc><loc>https://a.example/terms</loc></urlset>" if u.endswith("sitemap.xml") else ("<p>x</p>" if u.endswith("/x") else None)
        res = S.run(d, today="2026-11-01", get=get)
        self.assertFalse((d / S.LEDGER).exists(), "a read that is not applied writes nothing")
        self.assertNotIn("https://a.example/terms", read); self.assertEqual(res["tracked"], 1)
        S.run(d, today="2026-11-01", get=get, apply=True)
        self.assertEqual(list(json.loads((d / S.LEDGER).read_text()).keys()), ["https://a.example/x"])
        res = S.run(d, today="2026-11-20", get=get, apply=True)
        self.assertEqual([x["url"] for x in res["static"]], ["https://a.example/x"]); self.assertTrue(res["measured"])


class Portable(unittest.TestCase):
    """The seed's own script, which every system carries."""

    def setUp(self):
        self.d = tmp(self)
        (self.d / "autonomy").mkdir()
        (self.d / "autonomy/static-content.json").write_text(json.dumps({"max_unchanged_days": 14, "urls": ["https://s.example/", "https://s.example/terms", "https://s.example/down"],
                                                                         "exempt": [{"url": "https://s.example/terms", "reason": "policy"}, {"url": "https://s.example/down"}]}))

    def test_us_29_r55_the_seed_hashes_each_listed_page_and_keeps_the_day_it_last_changed_and_never_reads_an_exempt_one(self):
        read = []

        def fetch(u):
            read.append(u)
            if u.endswith("/down"):
                raise OSError("refused")
            return "<script>1</script><p>same</p>"
        led = SEED.run(self.d, apply=True, fetch=fetch, today="2026-11-01")
        self.assertEqual(sorted(led["pages"]), ["https://s.example/"], "the exempt page is not read; an unreachable one has no row")
        self.assertEqual(led["pages"]["https://s.example/"]["changed"], "2026-11-01"); self.assertEqual(led["started"], "2026-11-01")
        self.assertEqual(len(led["errors"]), 1); self.assertIn("https://s.example/down: OSError: refused", led["errors"][0])
        self.assertIn("https://s.example/down", read, "an exempt entry with no reason is not exempt")
        led2 = SEED.run(self.d, fetch=lambda u: "<p>same</p>" if "down" not in u else "<p>x</p>", today="2026-11-10")
        self.assertEqual(led2["pages"]["https://s.example/"]["changed"], "2026-11-01", "the same visible text is not a change")
        led3 = SEED.run(self.d, fetch=lambda u: "<p>different</p>", today="2026-11-12")
        self.assertEqual(led3["pages"]["https://s.example/"]["changed"], "2026-11-12")
        self.assertEqual(SEED.normalize("<style>x{}</style> a  <i>b</i>"), "a b"); self.assertEqual(SEED.slug("https://S.example/a/B?x=1"), "s-example-a-b-x-1")

    def test_us_29_r55_a_page_unchanged_for_more_than_the_window_files_one_item_with_its_own_closing_probe_and_a_young_ledger_is_unmeasured(self):
        def same(u):
            if u.endswith("/down"):
                raise OSError("refused")
            return "<p>same</p>"
        SEED.run(self.d, apply=True, fetch=same, today="2026-11-01")
        self.assertFalse(SEED.measured(self.d, "2026-11-10")); self.assertEqual(SEED.findings(self.d, today="2026-11-10"), [])
        led = SEED.run(self.d, apply=True, fetch=same, today="2026-11-15")
        self.assertEqual(SEED.findings(self.d, led, "2026-11-15"), [], "fourteen days is the window; a finding needs more")
        self.assertTrue(SEED.measured(self.d, "2026-11-15"))
        led = SEED.run(self.d, apply=True, fetch=same, today="2026-11-16")
        f = SEED.findings(self.d, led, "2026-11-16")
        self.assertEqual(f, [{"url": "https://s.example/", "unchanged_days": 15, "limit": 14}])
        p = self.d / "docs/issues/Q-STATIC-s-example.json"
        self.assertTrue(p.is_file(), "a run that is applied files the item")
        item = json.loads(p.read_text())
        self.assertEqual(item["id"], "Q-STATIC-s-example"); self.assertIn("agent-ready", item["labels"])
        self.assertIn("python3 scripts/staticcontent.py --check", item["body"]); self.assertIn("Do not edit the text to clear the finding", item["body"])
        before = p.read_text()
        SEED.run(self.d, apply=True, fetch=same, today="2026-11-17")
        self.assertEqual(p.read_text(), before, "one item per page, filed once")
        self.assertEqual(SEED.findings(self.d, SEED.run(self.d, fetch=lambda u: "<p>new words</p>", today="2026-11-18"), "2026-11-18"), [], "binding the page to a loop clears the finding")


class Scenario(unittest.TestCase):
    def test_us_29_t04_a_page_no_loop_regenerates_is_a_finding_after_the_window_and_until_then_the_reading_is_unmeasured_not_a_pass(self):
        led = S.observe({}, {"https://x/a": "<p>fixed</p>", "https://x/b": "<p>v1</p>"}, "2026-11-01")
        for day, text in (("2026-11-08", "v2"), ("2026-11-15", "v3")):
            led = S.observe(led, {"https://x/a": "<p>fixed</p>", "https://x/b": f"<p>{text}</p>"}, day)
        early = S.judge(led, "2026-11-10", RULES)
        self.assertEqual((early["measured"], early["static"]), (False, []), "nine days of history is not a window")
        late = S.judge(led, "2026-11-20", RULES)
        self.assertEqual([x["url"] for x in late["static"]], ["https://x/a"], "the page that changed is alive")


GOOD = "Most people believe the experiment showed that ordinary people turn cruel in a uniform. The recordings show the guards were coached to be tough."


class Drift(unittest.TestCase):
    def setUp(self):
        self.c = C.cfg()

    def test_us_29_r56_an_entry_is_bad_when_it_has_no_title_or_text_is_short_or_cut_off_or_carries_a_placeholder_or_stock_phrasing(self):
        p = lambda **kw: C.problems({"title": "T", "content_text": GOOD, **kw}, self.c)  # noqa: E731
        self.assertEqual(p(), [])
        self.assertIn("no title", p(title="")); self.assertIn("no text", p(content_text=""))
        self.assertEqual(C.problems({"title": "x"}, self.c), ["no text"])
        self.assertIn("text is 11 characters", p(content_text="Short text."))
        self.assertIn("ends mid-sentence", p(content_text=GOOD + " and then the"))
        for ok_end in ('."', ".)", "!", "?", ":", ".”"):
            self.assertNotIn("ends mid-sentence", p(content_text=GOOD + ok_end), ok_end)
        self.assertTrue(any("placeholder 'undefined'" in x for x in p(title="undefined")))
        self.assertTrue(any("placeholder 'NaN'" in x for x in p(content_text=GOOD + " NaN.")))
        self.assertEqual(p(content_text=GOOD + " The maintenance window passed."), [], "a placeholder is a whole word, matched with its case")
        self.assertTrue(any("placeholder '{{'" in x for x in p(content_text=GOOD + " {{name}}.")))
        self.assertTrue(any("stock phrasing 'delve'" in x for x in p(content_text="We DELVE into it. " + GOOD)), "stock phrasing is matched without case")
        self.assertEqual(p(content_text=GOOD + " Delving into a map is fine."), [], "stock phrasing is a whole word: delving is not delve")
        self.assertEqual(C.problems({"title": "x", "content_html": "<p>" + GOOD + "</p>"}, self.c), [], "the text may come from html, with tags dropped")
        self.assertEqual(C.problems({"title": "x", "summary": GOOD}, self.c), [], "or from a summary")

    def test_us_29_r57_a_feed_passes_only_when_it_has_entries_and_no_more_than_the_bad_share_of_its_newest_twenty_are_bad_or_repeated(self):
        good = [{"id": str(i), "title": f"Entry {i}", "content_text": GOOD + f" Case {i}."} for i in range(20)]
        self.assertTrue(C.judge({"items": good}, self.c)["ok"])
        self.assertEqual(C.judge({"items": good + [{"id": "z"}] * 5}, self.c)["entries"], 20, "only the newest twenty are read")
        four = good[:16] + [{"id": f"b{i}", "title": f"B{i}", "content_text": "short"} for i in range(4)]
        self.assertTrue(C.judge({"items": four}, self.c)["ok"], "a share of exactly 0.2 is the limit")
        five = good[:15] + [{"id": f"b{i}", "title": f"B{i}", "content_text": "short"} for i in range(5)]
        j = C.judge({"items": five}, self.c); self.assertFalse(j["ok"]); self.assertEqual(j["share"], 0.25)
        rep = [{"id": str(i), "title": "Same", "content_text": GOOD} for i in range(10)]
        r = C.judge({"items": rep}, self.c)
        self.assertFalse(r["ok"]); self.assertEqual(len(r["bad"]), 9); self.assertIn("repeats a title", r["bad"][0][1]); self.assertIn("repeats a text", r["bad"][0][1])
        e = C.judge({"items": []}, self.c)
        self.assertFalse(e["ok"]); self.assertEqual(e["share"], 1.0); self.assertEqual(C.judge([], self.c)["ok"], False)
        self.assertEqual(C.judge({"items": ["not an object"]}, self.c)["bad"][0][1], ["not an object"])

    def test_us_29_t06_a_feed_whose_entries_all_repeat_one_text_fails_and_a_feed_of_distinct_whole_entries_passes(self):
        drifted = {"items": [{"id": str(i), "title": "Same", "content_text": GOOD} for i in range(10)]}
        alive = {"items": [{"id": str(i), "title": f"Entry {i}", "content_text": GOOD + f" Case {i}."} for i in range(10)]}
        self.assertFalse(C.judge(drifted, self.c)["ok"]); self.assertTrue(C.judge(alive, self.c)["ok"])

    def test_us_29_r57_the_live_reading_names_every_system_whose_feed_cannot_be_read_or_has_drifted_and_the_declaration_check_names_what_is_missing(self):
        d = tmp(self)
        (d / "doctrine").mkdir(); (d / "instances/ultrastable").mkdir(parents=True)
        (d / C.CFG).write_text((ROOT / C.CFG).read_text())
        prog = {"systems": [{"id": "a", "stickiness": {"content_feed": "https://a.example/feed.json"}}, {"id": "b", "stickiness": {"content_feed": "https://b.example/feed.json"}}, {"id": "c", "stickiness": {"content_feed": "https://c.example/feed.json"}}, {"id": "d"}]}
        (d / "instances/ultrastable/progress.json").write_text(json.dumps(prog))
        self.assertEqual(C.feeds(d), [("a", "https://a.example/feed.json"), ("b", "https://b.example/feed.json"), ("c", "https://c.example/feed.json")], "a system with no declared feed is not read")
        feeds = {"https://a.example/feed.json": {"items": [{"id": str(i), "title": f"E{i}", "content_text": GOOD + f" Case {i}."} for i in range(5)]},
                 "https://b.example/feed.json": {"items": [{"id": str(i), "title": "Same", "content_text": GOOD} for i in range(5)]}}

        def get(u):
            if u not in feeds:
                raise OSError("refused")
            return feeds[u]
        out = C.live(d, get=get)
        self.assertEqual(len(out), 2)
        self.assertTrue(out[0].startswith("b: 4 of 5 newest entries are bad (share 0.8, limit 0.2)"))
        self.assertTrue(out[1].startswith("c: feed https://c.example/feed.json unreadable (OSError: refused)"))
        self.assertEqual(C.check(d), [])
        cfg = json.loads((d / C.CFG).read_text()); del cfg["slop"]; (d / C.CFG).write_text(json.dumps(cfg))
        (d / "instances/ultrastable/progress.json").write_text(json.dumps({"systems": [{"id": "d"}]}))
        self.assertEqual(sorted(C.check(d)), [f"{C.CFG}: missing slop", "no system declares a content_feed"])


if __name__ == "__main__":
    unittest.main()
