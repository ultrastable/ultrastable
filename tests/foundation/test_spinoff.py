# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import datetime as dt, json, shutil, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import spinoff  # noqa: E402
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def sandbox():
    d = scratch()
    (d / "doctrine").mkdir()
    shutil.copy(REPO / "doctrine/spinoff.json", d / "doctrine/spinoff.json")
    shutil.copy(REPO / "doctrine/blindspots.json", d / "doctrine/blindspots.json")
    (d / "spinoffs").mkdir()
    (d / "ops").mkdir()
    shutil.copy(REPO / "tests/foundation/fixtures/free-tier-2026-11-17.json", d / "ops/free-tier.json")  # fixed snapshot: the loop rewrites the live one daily
    ic = json.loads((REPO / "doctrine/spinoff-ideas.json").read_text())
    ic.pop("depth", None)  # launch mechanics only; DEPTH-1 refusal of these shallow candidates is tested in test_ideas.py
    ic["bank"] = []  # these tests are about the blind-spot candidates; the idea bank has its own tests in test_ideas.py
    (d / "doctrine/spinoff-ideas.json").write_text(json.dumps(ic))
    return d


class Spinoff(unittest.TestCase):
    def test_repo_consistent(self):
        self.assertEqual(spinoff.check(REPO), [])

    def test_ranks_implemented_archetype_first_and_gate_blocks_denied(self):
        cfg = spinoff.load(REPO)
        self.assertEqual(spinoff.candidates(sandbox())[0]["archetype"], "domain-check")
        g = spinoff.gate({"slug": "x", "archetype": "domain-check", "why": "people-search tool", "domains": [], "need_ids": [], "collects": ["email"], "input": "free text"}, cfg)
        self.assertFalse(g["ok"])
        self.assertTrue(any("people-search" in r for r in g["reasons"]) and any("email" in r for r in g["reasons"]))

    def test_launch_caps_and_novelty(self):
        d, t = sandbox(), dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc)
        self.assertEqual(spinoff.launch(d, True, t)["launched"]["slug"], "blindspot")
        self.assertIn("no candidate", spinoff.launch(d, True, t)["why"])  # same needs: novelty 0
        self.assertIn("no candidate", spinoff.launch(d, True, t + dt.timedelta(days=8))["why"])
        self.assertEqual(spinoff.check(d), [])

    def test_value_counts_outcomes_not_attention(self):
        cfg, app = spinoff.load(REPO), {"metrics": {"targets": {"verified_fixes_7d": 20, "return_share": 0.2, "visitors_with_a_gap_7d": 50}}}
        eyeballs = spinoff.value({"uses_7d": 100000, "unique_visitors_7d": 90000}, app, cfg)
        helped = spinoff.value({"verified_fixes_7d": 20, "return_share": 0.2, "visitors_with_a_gap_7d": 50}, app, cfg)
        self.assertEqual(eyeballs, 0)
        self.assertEqual(helped, 1.0)

    def test_portfolio_decisions_and_retire(self):
        d, t = sandbox(), dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc)
        spinoff.launch(d, True, t)
        later = t + dt.timedelta(days=20)
        self.assertEqual(spinoff.tick(d, False, later)[0]["decision"], "measure")  # unmeasured is not zero
        spinoff._append(d / "ops/spinoff/metrics.jsonl", {"at": "x", "slug": "blindspot", "ok": True, "uses_7d": 3})
        dec = spinoff.tick(d, True, later)[0]
        self.assertEqual(dec["decision"], "retire")
        self.assertEqual(json.loads((d / "spinoffs/registry.json").read_text())["retired"], ["blindspot"])
        self.assertEqual(json.loads((d / "ops/spinoff/outcomes.jsonl").read_text().splitlines()[0])["decision"], "retire")
        self.assertLess(spinoff.bandit(d, spinoff.load(d), "domain-check"), 1.0)

    def test_promote_submits_each_live_host_and_records_failures(self):
        d, t = sandbox(), dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc)
        spinoff.launch(d, True, t)
        seen = []
        rows = spinoff.promote(d, True, t, post=lambda b: seen.append(b["host"]) or 202)
        self.assertEqual(seen, ["blindspot.ultrastable.app"])
        self.assertEqual(rows[0]["status"], 202)
        bad = spinoff.promote(d, False, t, post=lambda b: (_ for _ in ()).throw(OSError("down")))
        self.assertEqual(bad[0]["status"], 0)

    def test_promote(self):
        d, t = sandbox(), dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc)
        spinoff.launch(d, True, t)
        spinoff._append(d / "ops/spinoff/metrics.jsonl", {"at": "x", "slug": "blindspot", "ok": True, "verified_fixes_7d": 25, "return_share": 0.3, "visitors_with_a_gap_7d": 60})
        self.assertEqual(spinoff.tick(d, False, t + dt.timedelta(days=20))[0]["decision"], "promote")


if __name__ == "__main__":
    unittest.main()
