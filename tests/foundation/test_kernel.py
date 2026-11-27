"""The doctrine kernel as code: the JSON matches the verbatim text, the recognition lint reads reports, trust moves with outcomes."""
import unittest
from _repo import ROOT, copy_repo, edit
from foundation import kernel, trust


class Kernel(unittest.TestCase):
    def test_kernel_matches_its_text(self):
        self.assertEqual(kernel.check(ROOT), [])
        r = copy_repo(); edit(r / "doctrine/kernel.json", lambda d: d["tick_steps"].pop(3))
        self.assertTrue(any("tick steps" in p for p in kernel.check(r)))
        r = copy_repo(); edit(r / "doctrine/kernel.json", lambda d: d["commitments"].append({"id": "IC-NEW-001", "name": "x", "code": "agents/AGENTS.md"}))
        self.assertTrue(any("IC-NEW-001" in p for p in kernel.check(r)))
        r = copy_repo(); edit(r / "doctrine/kernel.json", lambda d: d["trust"]["rises"].update(invented_event=0.5))
        self.assertTrue(any("invented_event" in p for p in kernel.check(r)))
        r = copy_repo(); edit(r / "doctrine/kernel.json", lambda d: d["directives"].append({"id": "NOPE-1", "enforced_by": "foundation/kernel.py", "probe": "file:foundation/kernel.py"}))
        self.assertTrue(any("NOPE-1" in p for p in kernel.check(r)))

    def test_kernel_text_is_verbatim_where_it_matters(self):
        t = (ROOT / "doctrine/kernel-8.2.1.md").read_text()
        for s in ("IC-ACTOR-001: The System Is The Actor", "The wheel turns: action, outcome, trust, scope, action.", "Falls on: unnecessary question -0.05"):
            self.assertIn(s, t)
        d = (ROOT / "doctrine/standing-directives.md").read_text()
        for s in ("FLEET-AUTONOMY-1", "SLA-AND-PATHS-1", "VERIFY-LIVE-1", "HONEST-MEASURE-1", "FALLBACK-CLASSES-1", "CREDENTIAL-ONE-SOURCE-1", "PROACTIVE-PROGRAMS-1"):
            self.assertIn(s, d)

    def test_lint_flags_conditional_offer_and_you_as_actor(self):
        got = {f["recognition"] for f in kernel.lint("Let me know if you want more.\nThe owner should do it, and you should merge it.\nWhat next?\nThe fix is to edit the file.\nAlternatively, two options exist.\n")}
        self.assertTrue({"conditional-offer", "you-as-actor", "question", "narration", "menu"} <= got, got)
        self.assertEqual(kernel.lint("I merged the change and the probe passes.\nNext: the loop registry gains a row.\n"), [])

    def test_lint_skips_quotes_and_code(self):
        self.assertEqual(kernel.lint("> if you want, tell me to\n```\nyou should\n```\nUse `if you want` as an example string.\n| shall I | x |\n"), [])

    def test_refusal_with_reason_is_excluded(self):
        self.assertEqual(kernel.lint("The push was refused because the branch is protected; opened a PR instead.\n"), [])
        self.assertTrue(kernel.lint("I can't do that.\n"))

    def test_verify_live_and_honest_measure(self):
        self.assertTrue(any(f["recognition"] == "verify-live" for f in kernel.lint("The bug is fixed.\n")))
        self.assertEqual(kernel.lint("The bug is fixed; the probe passes on the live page.\n"), [])
        self.assertTrue(any(f["recognition"] == "honest-measure" for f in kernel.lint("Latency fell 40%.\n")))
        self.assertEqual(kernel.lint("Latency fell 40% (measured, source: the tick log).\n"), [])

    def test_metrics_from_findings(self):
        f = kernel.lint("What next?\nWhat now?\n")
        self.assertEqual(kernel.metrics(f, 4)["question_rate"], 0.5)

    def test_inferred_direction_reads_the_record(self):
        self.assertIsInstance(kernel.inferred_direction(ROOT), list)

    def test_trust_event_moves_score_and_rung(self):
        k, led = kernel.load(ROOT), {"version": 1, "tick": 0, "rows": {}, "transitions": []}
        for _ in range(5):
            row = trust.apply(led, "repo", "merge", "friction_signal_closed", k, evidence="merge:55a4210")
        self.assertGreater(row["score"], 0.75)
        self.assertEqual(row["rung"], trust.rung(row["score"], k))
        self.assertTrue(led["transitions"])
        top = row["score"]
        trust.apply(led, "repo", "merge", "hidden_failure", k, evidence="ci-run:45998651595")
        self.assertLess(led["rows"]["repo|merge"]["score"], top)
        with self.assertRaises(ValueError):
            trust.apply(led, "repo", "merge", "not_an_event", k, evidence="merge:55a4210")

    def test_trust_refuses_a_self_report(self):
        k, led = kernel.load(ROOT), {"version": 1, "tick": 0, "rows": {}, "transitions": []}
        for ev in (None, "", "self:I did it", "merge:"):
            with self.assertRaises(ValueError):
                trust.apply(led, "repo", "merge", "verified_autonomous_action", k, evidence=ev)
        self.assertEqual(led["rows"], {})
        row = trust.apply(led, "repo", "merge", "verified_autonomous_action", k, evidence="ci-run:123456")
        self.assertEqual(row["last_external_event"], "ci-run:123456")

    def test_trust_decays_when_idle(self):
        k, led = kernel.load(ROOT), {"version": 1, "tick": 0, "rows": {}, "transitions": []}
        trust.apply(led, "a", "x", "verified_autonomous_action", k, evidence="probe:observer-1")
        trust.tick(led, k)
        before = led["rows"]["a|x"]["score"]
        trust.tick(led, k); trust.tick(led, k)
        self.assertLess(led["rows"]["a|x"]["score"], before)
        self.assertEqual(trust.compounding_rate(led), 1.0)

    def test_lessons_in_repo_read_clean(self):
        for f in (ROOT / "docs/lessons").glob("*.md"):
            if f.name != "README.md":
                self.assertEqual(kernel.lint(f.read_text()), [], f.name)


if __name__ == "__main__":
    unittest.main()
