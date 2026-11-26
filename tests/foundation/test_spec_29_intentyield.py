# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the yield of the owner's directives, `python3 -m foundation intentyield`.

US-29-R64 intents are read from the owner's own words, US-29-R65 a probe and a verdict, US-29-R66 the score, US-29-R67 a run, US-29-R68 the loop's own health."""
import hashlib, json, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import intentyield as Y  # noqa: E402

NOW = datetime(2026, 12, 30, 8, 0, tzinfo=timezone.utc)
DOC = """# rules
- **Zeta rule (ZETA-1, Rowan 2026-10-01).** "The platform shall keep every promise it writes down in its own words." Probe `python3 -m foundation zeta --check`; again `python3 -m foundation zeta --check` and `python3 -m foundation zeta --verify`, but not `python3 -m foundation zeta --check-all`.
- **A rule with no id (owner 2026-10-05).** "Something the owner said without any rule number attached to it." `python3 -m foundation eta --probe`
- **Theta (THETA-2, Rowan 2026-12-20).** Restated by the owner. "Theta is a short note." `python3 -m foundation theta --check`
- **Not attributed.** "Nobody named." `python3 -m foundation iota --check`
- **Dateless (KAPPA-1, Rowan).** "no date here" `python3 -m foundation kappa --check`
- **Lambda (LAMBDA-1, Rowan 2026-12-25).** "The platform shall keep every promise it writes down in its own words, always." `python3 -m foundation lambda --check`
"""
# Three directives about different things, all old enough to settle, none restating another.
DOC3 = """# rules
- **One (ONE-1, Rowan 2026-10-01).** "The first of three directives, each about something different, in its own words." `python3 -m foundation one --check`
- **Two (TWO-1, Rowan 2026-10-02).** "A second directive that talks about an entirely different subject than the first." `python3 -m foundation two --check`
- **Three (THREE-1, Rowan 2026-10-03).** "The third directive covers yet another topic nobody has mentioned before in this file." `python3 -m foundation three --check`
"""


def make(case, over=None, doc=DOC):
    td = tempfile.TemporaryDirectory(prefix="ultrastable-test-spec29-"); case.addCleanup(td.cleanup)
    d = Path(td.name)
    (d / "doctrine").mkdir(); (d / "site").mkdir()
    cfg = json.loads((ROOT / Y.CONFIG).read_text(encoding="utf-8"))
    cfg.update({"sources": ["AGENTS.md"], "min_intents": 3}, **(over or {}))
    (d / Y.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")
    (d / "AGENTS.md").write_text(doc, encoding="utf-8")
    return d


def runner(results, calls=None):
    def r(cmd, root, timeout):
        if calls is not None:
            calls.append(cmd)
        return {"cmd": cmd, "result": results.get(cmd.split()[3], "pass"), "rc": 0, "seconds": 0.1, "tail": "x"}
    return r


def history(d):
    return [json.loads(l) for l in (d / "ops/intent-yield/history.jsonl").read_text(encoding="utf-8").splitlines()]


class Intents(unittest.TestCase):
    def setUp(self):
        self.d = make(self)
        self.cfg = Y.load(self.d)

    def test_us_29_r64_only_a_bullet_that_names_the_owner_and_a_date_is_a_directive_and_its_id_quote_and_probes_are_read_from_the_line(self):
        occ = Y.parse(DOC, self.cfg, "AGENTS.md")
        self.assertEqual([o["id"] for o in occ], ["ZETA-1", "T-a-rule-with-no-id", "THETA-2", "LAMBDA-1"], "no owner, no date and no attribution are not directives")
        z = occ[0]
        self.assertEqual((z["date"], z["source"]), ("2026-10-01", "AGENTS.md:2"))
        self.assertEqual(z["quote"], "The platform shall keep every promise it writes down in its own words.")
        self.assertEqual(z["words"], 13)
        self.assertEqual(z["probes"], ["python3 -m foundation zeta --check", "python3 -m foundation zeta --verify"], "sorted, once each, and a longer flag is not a probe")
        self.assertEqual(occ[1]["probes"], ["python3 -m foundation eta --probe"]); self.assertEqual(occ[1]["title"], "A rule with no id")
        self.assertEqual(occ[2]["restated_note"], 1)

    def test_us_29_r64_a_repeat_a_restated_note_and_a_later_directive_that_says_the_same_words_are_each_charged_to_the_earliest_intent(self):
        by = Y.intents(Y.parse(DOC + DOC.splitlines()[1] + "\n", self.cfg, "AGENTS.md"), self.cfg)
        z = by["ZETA-1"]
        whys = [r["why"] for r in z["restatements"]]
        self.assertIn("same directive written again", whys); self.assertIn("LAMBDA-1 says the same words", whys)
        self.assertEqual(by["LAMBDA-1"]["restates"], "ZETA-1")
        self.assertEqual(len(by["THETA-2"]["restatements"]), 1); self.assertIn("Restated by", by["THETA-2"]["restatements"][0]["why"])
        self.assertEqual(len(by), 4)
        self.assertEqual(z["attention_s"], round((13 + 13 + 14) / 2.5, 1), "the words of the first, of the repeat and of the later quote, at 2.5 words a second")
        self.assertEqual(by["T-a-rule-with-no-id"]["attention_s"], round(11 / 2.5, 1))
        self.assertTrue(all("quotes" not in i and "restated_note" not in i for i in by.values()))
        short = Y.intents(Y.parse("- **A (AA-1, Rowan 2026-10-01).** \"Same short words here.\" x\n- **B (BB-1, Rowan 2026-10-02).** \"Same short words here.\" y\n", self.cfg), self.cfg)
        self.assertEqual(short["AA-1"]["restatements"], [], "fewer than eight words are too few to call a restatement")


class Probes(unittest.TestCase):
    def test_us_29_r65_a_probe_passes_on_exit_0_fails_on_exit_1_and_is_unmeasured_on_any_other_code_a_timeout_or_a_command_that_will_not_start(self):
        d = Path(tempfile.gettempdir())
        py = lambda body: f'{sys.executable} -c "{body}"'  # noqa: E731
        ok = Y.run_probe(py("print('fine')"), d, 30); self.assertEqual((ok["result"], ok["rc"], ok["tail"]), ("pass", 0, "fine"))
        bad = Y.run_probe(py("import sys; print('a'); print('b'); sys.exit(1)"), d, 30); self.assertEqual((bad["result"], bad["tail"]), ("fail", "b"))
        self.assertEqual(Y.run_probe(py("import sys; sys.exit(2)"), d, 30)["result"], "error", "exit 2 is a check that could not measure")
        self.assertEqual(Y.run_probe(py("import sys; sys.exit(127)"), d, 30)["result"], "error")
        slow = Y.run_probe(py("import time; time.sleep(30)"), d, 1); self.assertEqual((slow["result"], slow["seconds"]), ("timeout", 1))
        gone = Y.run_probe("/nonexistent/command --check", d, 5); self.assertEqual(gone["result"], "error"); self.assertTrue(gone["tail"])

    def test_us_29_r65_a_verdict_is_unmeasured_without_a_runnable_probe_broken_when_it_fails_restated_when_said_again_and_kept_only_after_the_settle_window(self):
        cfg = {"settle_days": 30}
        i = lambda **kw: {"probes": ["p"], "restatements": [], "date": "2026-12-01", **kw}  # noqa: E731
        res = lambda r: {"result": r}  # noqa: E731
        v = lambda it, last: Y.verdict(it, last, NOW, cfg)  # noqa: E731
        self.assertEqual(v(i(probes=[]), res("pass")), "unmeasured")
        self.assertEqual(v(i(), None), "unmeasured")
        self.assertEqual(v(i(), res("timeout")), "unmeasured"); self.assertEqual(v(i(), res("error")), "unmeasured")
        self.assertEqual(v(i(), res("fail")), "broken")
        self.assertEqual(v(i(restatements=[{}]), res("fail")), "broken", "a broken check outranks a restatement")
        self.assertEqual(v(i(restatements=[{}], date="2026-10-01"), res("pass")), "restated")
        self.assertEqual(v(i(date="2026-12-01"), res("pass")), "holding", "twenty-nine days")
        self.assertEqual(v(i(date="2026-11-30"), res("pass")), "kept", "thirty days to the day")


class Score(unittest.TestCase):
    CFG = {"settle_days": 30}

    def test_us_29_r66_the_yield_is_a_set_of_shares_over_the_measured_directives_and_names_no_person_and_no_count_of_activity(self):
        by = {k: {"date": d, "verdict": v, "attention_s": a, "restatements": [1] if v == "restated" else []} for k, (d, v, a) in {
            "a": ("2026-10-01", "kept", 10.0), "b": ("2026-10-01", "kept", 30.0), "c": ("2026-10-01", "broken", 5.0), "d": ("2026-10-01", "restated", 7.0),
            "e": ("2026-12-25", "holding", 3.0), "f": ("2026-12-25", "unmeasured", 1.0)}.items()}
        s = Y.score(by, NOW, self.CFG)
        self.assertEqual((s["intents"], s["measured"], s["settled"]), (6, 5, 4))
        self.assertEqual(s["kept_share"], 0.5, "kept over the settled and measured")
        self.assertEqual(s["holding_share"], round(3 / 5, 3), "kept or holding over the measured")
        self.assertEqual(s["restated_share"], round(1 / 6, 3))
        self.assertEqual(s["attention_s_per_kept"], 30.0, "the median of the kept, the upper one of two")
        self.assertEqual(s["verdicts"], {"broken": 1, "holding": 1, "kept": 2, "restated": 1, "unmeasured": 1})
        text = json.dumps(s).lower()
        for banned in ("commit", "hours", "pull", "deploy", "lines", "person"):
            self.assertNotIn(banned, text)
        empty = Y.score({}, NOW, self.CFG)
        self.assertEqual((empty["kept_share"], empty["holding_share"], empty["restated_share"], empty["attention_s_per_kept"]), (None, None, None, None), "nothing settled is unmeasured, never zero")
        young = Y.score({"x": {"date": "2026-12-25", "verdict": "holding", "attention_s": 4.0, "restatements": []}}, NOW, self.CFG)
        self.assertIsNone(young["kept_share"]); self.assertEqual(young["attention_s_per_kept"], 4.0, "before anything is kept, the holding directives' attention stands in")


class Run(unittest.TestCase):
    def test_us_29_r67_a_broken_directive_files_one_item_per_directive_closed_by_its_own_probe_and_at_most_the_per_run_limit(self):
        d = make(self, {"max_items_per_run": 1})
        fail = runner({"zeta": "fail", "eta": "fail"})
        page = Y.run(d, apply=True, now=NOW, runner=fail)
        zeta = "Q-YIELD-" + hashlib.sha1(b"ZETA-1").hexdigest()[:10]
        self.assertEqual(sorted(p.stem for p in (d / "docs/issues").glob("Q-YIELD-*.json")), [zeta], "at most max_items_per_run, the oldest directive first")
        self.assertEqual(Y.item_id("ZETA-1"), zeta); self.assertEqual(page["intents"][0]["item"], zeta)
        body = json.loads((d / "docs/issues" / (zeta + ".json")).read_text())
        self.assertIn("cmd:python3 -m foundation zeta --check", body["body"]); self.assertIn("agent-ready", body["labels"]); self.assertIn("intent-yield", body["labels"])
        self.assertIn("Fix the cause, not the probe", body["body"])
        Y.run(d, apply=True, now=NOW + timedelta(days=1), runner=fail)
        self.assertEqual(len(list((d / "docs/issues").glob("Q-YIELD-*.json"))), 2, "a directive that has its item is not filed again; the next broken one is")
        Y.run(d, apply=True, now=NOW + timedelta(days=2), runner=fail)
        self.assertEqual(len(list((d / "docs/issues").glob("Q-YIELD-*.json"))), 2)
        dry = make(self)
        self.assertEqual(Y.run(dry, apply=False, now=NOW, runner=fail)["intents"][0]["verdict"], "broken")
        self.assertFalse((dry / "docs/issues").exists(), "a run that is not applied writes nothing")
        self.assertFalse((dry / "ops").exists())

    def test_us_29_r67_probes_run_least_recently_run_first_and_a_run_that_ran_none_or_parsed_too_little_or_lost_most_is_an_error_not_a_result(self):
        d = make(self)
        (d / "ops/intent-yield").mkdir(parents=True)
        old = {"at": "2026-12-01T00:00:00Z", "result": "pass", "cmd": "x"}; new = {"at": "2026-12-29T00:00:00Z", "result": "pass", "cmd": "x"}
        (d / "ops/intent-yield/state.json").write_text(json.dumps({"runs": 3, "last_probe": {"python3 -m foundation theta --check": new, "python3 -m foundation zeta --check": old}}))
        calls = []
        page = Y.run(d, apply=False, now=NOW, runner=runner({}, calls))
        self.assertEqual(calls, ["python3 -m foundation eta --probe", "python3 -m foundation lambda --check", "python3 -m foundation zeta --verify",
                                 "python3 -m foundation zeta --check", "python3 -m foundation theta --check"], "never run first, then the oldest, then the newest")
        self.assertEqual((page["probes_run"], page["probes_total"]), (5, 5))
        box = Y.run(make(self, {"run_budget_s": -1}), apply=False, now=NOW, runner=runner({}))
        self.assertEqual(box["probes_run"], 0); self.assertEqual(box["error"], "no probe ran this pass")
        few = Y.run(make(self, {"min_intents": 99}), apply=False, now=NOW, runner=runner({}))
        self.assertIn("parsed 4 directives, fewer than 99", few["error"])
        half = make(self, {"min_intents": 1})
        Y.run(half, apply=True, now=NOW, runner=runner({}))
        (half / "AGENTS.md").write_text(DOC.splitlines()[1] + "\n", encoding="utf-8")
        self.assertEqual(Y.run(half, apply=True, now=NOW + timedelta(days=1), runner=runner({}))["error"], "parsed directives fell from 4 to 1: the parser lost them")
        three = make(self)
        Y.run(three, apply=True, now=NOW, runner=runner({}))
        (three / "AGENTS.md").write_text("\n".join(DOC.splitlines()[1:4]) + "\n", encoding="utf-8")
        self.assertIsNone(Y.run(three, apply=True, now=NOW + timedelta(days=1), runner=runner({}))["error"], "losing one of four is not losing more than half")

    def test_us_29_r67_each_run_logs_a_prediction_of_the_kept_share_and_a_later_run_scores_it_and_the_state_the_history_and_the_page_data_are_written(self):
        d = make(self, {"history_keep": 3}, DOC3)
        Y.run(d, apply=True, now=NOW, runner=runner({}))
        self.assertEqual(history(d)[0]["prediction"], {"metric": "kept_share", "op": ">=", "value": 0.6, "within_h": 720})
        state = json.loads((d / "ops/intent-yield/state.json").read_text())
        self.assertEqual((state["runs"], state["intents"], state["error"]), (1, 3, None)); self.assertIn("python3 -m foundation one --check", state["last_probe"])
        js = (d / "site/intent-yield-data.js").read_text()
        self.assertTrue(js.startswith("// GENERATED by python3 -m foundation intentyield --run --apply; do not edit.")); self.assertIn("export const INTENT_YIELD = {", js)
        Y.run(d, apply=True, now=NOW + timedelta(days=10), runner=runner({}))
        self.assertNotIn("outcome", history(d)[0]["prediction"], "not scored before its window has passed")
        Y.run(d, apply=True, now=NOW + timedelta(days=31), runner=runner({}))
        first = history(d)[0]["prediction"]
        self.assertEqual((first["outcome"], first["got"]), ("hit", 1.0))
        for k in range(4):
            Y.run(d, apply=True, now=NOW + timedelta(days=40 + k), runner=runner({}))
        self.assertEqual(len(history(d)), 3, "the history keeps history_keep rows")
        for results, want in (({"one": "fail", "two": "fail", "three": "fail"}, "miss"), ({"one": "error", "two": "error", "three": "error"}, "unmeasured")):
            e = make(self, None, DOC3)
            Y.run(e, apply=True, now=NOW, runner=runner({}))
            Y.run(e, apply=True, now=NOW + timedelta(days=31), runner=runner(results))
            self.assertEqual(history(e)[0]["prediction"]["outcome"], want, "a share that could not be read is not a miss" if want == "unmeasured" else "a share under the floor is")


class Scenario(unittest.TestCase):
    def test_us_29_t08_a_directive_said_again_is_charged_to_the_first_and_a_broken_one_files_an_item_that_only_its_own_probe_closes(self):
        d = make(self)
        page = Y.run(d, apply=True, now=NOW, runner=runner({"zeta": "fail"}))
        by_id = {i["id"]: i for i in page["intents"]}
        self.assertEqual((by_id["ZETA-1"]["verdict"], by_id["ZETA-1"]["restatements"], by_id["LAMBDA-1"]["restates"]), ("broken", 1, "ZETA-1"))
        item = json.loads((d / "docs/issues" / (by_id["ZETA-1"]["item"] + ".json")).read_text())
        self.assertIn("**Closing probe:** cmd:python3 -m foundation zeta --check.", item["body"])
        fixed = Y.run(d, apply=True, now=NOW + timedelta(days=1), runner=runner({}))
        self.assertEqual({i["id"]: i["verdict"] for i in fixed["intents"]}["ZETA-1"], "restated", "its probe passes again: the item's own reading is green, and the restatement still counts")


class Health(unittest.TestCase):
    def test_us_29_r68_the_loops_own_probe_fails_when_it_never_ran_went_stale_or_recorded_an_error_and_the_check_fails_when_the_parser_finds_too_little(self):
        d = make(self)
        ok, msg = Y.probe(d, now=NOW); self.assertFalse(ok); self.assertIn("never run", msg)
        Y.run(d, apply=True, now=NOW, runner=runner({}))
        ok, msg = Y.probe(d, now=NOW + timedelta(hours=50)); self.assertTrue(ok, msg); self.assertIn("4 directives", msg)
        ok, msg = Y.probe(d, now=NOW + timedelta(hours=51)); self.assertFalse(ok); self.assertIn("the daily run stopped", msg)
        s = json.loads((d / "ops/intent-yield/state.json").read_text()); s["error"] = "parsed 1 directives"; (d / "ops/intent-yield/state.json").write_text(json.dumps(s))
        ok, msg = Y.probe(d, now=NOW); self.assertFalse(ok); self.assertIn("last run failed: parsed 1 directives", msg)
        self.assertEqual(Y.check(d), [])
        (d / "site/intent-yield-data.js").unlink()
        self.assertEqual(Y.check(d), ["site/intent-yield-data.js missing: run python3 -m foundation intentyield --run --apply"])
        few = make(self, {"min_intents": 50})
        (few / "site/intent-yield-data.js").write_text("x")
        self.assertEqual(Y.check(few), ["parser finds 4 owner directives, fewer than 50"])
        cfg = json.loads((few / Y.CONFIG).read_text()); del cfg["settle_days"]; (few / Y.CONFIG).write_text(json.dumps(cfg))
        self.assertEqual(Y.check(few), [f"{Y.CONFIG}: missing settle_days"])
        self.assertEqual(Y.check(ROOT), [], "the repository's own directives parse")
        c = Y.load(ROOT); self.assertEqual((c["rule"], c["settle_days"], c["stale_hours"], c["target_kept_share"]), ("INTENT-YIELD-1", 30, 50, 0.8))


if __name__ == "__main__":
    unittest.main()
