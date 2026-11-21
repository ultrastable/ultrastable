"""INTENT-YIELD-1: owner directives are intents, their own probes decide kept or broken, restatements are charged to the original,
and the loop's own probe fails loudly when it goes stale, errors or loses the directives."""
import json, shutil, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from foundation import intentyield as Y

ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 12, 30, 8, 0, tzinfo=timezone.utc)
DOC = """# rules
- **Alpha rule (ALPHA-1, Rowan 2026-11-12).** "The system shall always close every loop it opens with no person in the middle." Probe `python3 -m foundation alpha --check`.
- **Beta rule (BETA-1, Rowan 2026-11-20).** "Beta says something new and different here entirely." Probe `python3 -m foundation beta --check`.
- **Gamma rule (GAMMA-1, Rowan 2026-12-10).** "Gamma words." Also: "The system shall always close every loop it opens with no person in the middle." `python3 -m foundation gamma --check`.
- **Unattributed rule.** Not an owner directive. `python3 -m foundation delta --check`.
- **Alpha rule (ALPHA-1, Rowan 2026-11-12).** Written again.
- **No probe (NOPROBE-1, Rowan 2026-11-12).** "Nothing runnable here at all for this one."
"""


def make(cfg_over=None):
    d = Path(tempfile.mkdtemp())
    (d / "doctrine").mkdir()
    cfg = json.loads((ROOT / Y.CONFIG).read_text(encoding="utf-8"))
    cfg.update({"sources": ["AGENTS.md"], "min_intents": 3}, **(cfg_over or {}))
    (d / Y.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")
    (d / "AGENTS.md").write_text(DOC, encoding="utf-8")
    (d / "site").mkdir()
    return d


def runner(results):
    return lambda cmd, root, timeout: {"cmd": cmd, "result": results.get(cmd.split()[3], "pass"), "rc": 0, "seconds": 0.1, "tail": "x"}


class IntentYieldTests(unittest.TestCase):
    def setUp(self):
        self.d = make()
        self.addCleanup(shutil.rmtree, self.d, True)

    def test_parse_takes_owner_directives_only(self):
        occ = Y.parse(DOC, Y.load(self.d), "AGENTS.md")
        self.assertEqual([o["id"] for o in occ], ["ALPHA-1", "BETA-1", "GAMMA-1", "ALPHA-1", "NOPROBE-1"])
        self.assertEqual(occ[0]["probes"], ["python3 -m foundation alpha --check"])

    def test_restatements_are_charged_to_the_original(self):
        cfg = Y.load(self.d)
        by = Y.intents(Y.parse(DOC, cfg, "AGENTS.md"), cfg)
        whys = [r["why"] for r in by["ALPHA-1"]["restatements"]]
        self.assertIn("same directive written again", whys)
        self.assertIn("GAMMA-1 says the same words", whys)
        self.assertEqual(by["GAMMA-1"]["restates"], "ALPHA-1")
        self.assertGreater(by["ALPHA-1"]["attention_s"], by["BETA-1"]["attention_s"])

    def test_verdicts_and_score(self):
        page = Y.run(self.d, apply=True, now=NOW, runner=runner({"beta": "fail"}))
        v = {i["id"]: i["verdict"] for i in page["intents"]}
        self.assertEqual(v, {"ALPHA-1": "restated", "BETA-1": "broken", "GAMMA-1": "holding", "NOPROBE-1": "unmeasured"})
        s = page["summary"]
        self.assertEqual(s["settled"], 2)  # alpha and beta are past 30 days; gamma is not
        self.assertEqual(s["kept_share"], 0.0)
        self.assertIsNone(page["error"])
        items = list((self.d / "docs/issues").glob("Q-YIELD-*.json"))
        self.assertEqual(len(items), 1)
        self.assertIn("cmd:python3 -m foundation beta --check", items[0].read_text(encoding="utf-8"))

    def test_no_count_of_activity_enters_the_measure(self):
        page = Y.run(self.d, apply=False, now=NOW, runner=runner({}))
        keys = json.dumps(page["summary"]).lower()
        for banned in ("commit", "hours", "pull", "deploy", "lines"):
            self.assertNotIn(banned, keys)

    def test_unmeasurable_check_is_never_broken(self):
        r = lambda cmd, root, timeout: {"cmd": cmd, "result": "error", "rc": 2, "seconds": 0.1, "tail": "no access"}
        page = Y.run(self.d, apply=False, now=NOW, runner=r)
        self.assertNotIn("broken", {i["verdict"] for i in page["intents"]})

    def test_probe_fails_loudly_when_stale_or_errored(self):
        ok, msg = Y.probe(self.d, now=NOW)
        self.assertFalse(ok); self.assertIn("never run", msg)
        Y.run(self.d, apply=True, now=NOW, runner=runner({}))
        self.assertTrue(Y.probe(self.d, now=NOW + timedelta(hours=10))[0])
        ok, msg = Y.probe(self.d, now=NOW + timedelta(hours=60))
        self.assertFalse(ok); self.assertIn("stopped", msg)

    def test_parser_losing_directives_is_an_error(self):
        Y.run(self.d, apply=True, now=NOW, runner=runner({}))
        (self.d / "AGENTS.md").write_text("- **Alpha rule (ALPHA-1, Rowan 2026-11-12).** x\n", encoding="utf-8")
        page = Y.run(self.d, apply=True, now=NOW + timedelta(days=1), runner=runner({}))
        self.assertIsNotNone(page["error"])
        self.assertFalse(Y.probe(self.d, now=NOW + timedelta(days=1))[0])

    def test_prediction_is_scored_after_the_window(self):
        Y.run(self.d, apply=True, now=NOW, runner=runner({}))
        Y.run(self.d, apply=True, now=NOW + timedelta(days=31), runner=runner({}))
        hist = [json.loads(l) for l in (self.d / "ops/intent-yield/history.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertIn(hist[0]["prediction"]["outcome"], ("hit", "miss"))

    def test_repository_directives_parse(self):
        self.assertEqual(Y.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()
