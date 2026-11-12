"""TRIGGERS-1: time and event triggers are data, valid, within host limits, and cannot drift from the workflows."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import triggers  # noqa: E402
from _repo import copy_repo, edit  # noqa: E402


class Triggers(unittest.TestCase):
    def test_this_repo_is_clean(self):
        self.assertEqual(triggers.check(ROOT), [])

    def test_cron_validation(self):
        self.assertIsNone(triggers.cron_problem("*/10 * * * *"))
        self.assertIsNone(triggers.cron_problem("17 15 * * 2,5"))
        self.assertIsNotNone(triggers.cron_problem("61 * * * *"))
        self.assertIsNotNone(triggers.cron_problem("* * * *"))
        self.assertEqual(triggers.fires_per_day("17 15 * * 2,5"), 1)
        self.assertEqual(triggers.fires_per_day("*/10 * * * *"), 144)

    def test_every_role_gets_a_period_and_a_wake_route(self):
        pl = triggers.plan(ROOT)
        self.assertEqual(pl["base_minutes"], 10)
        ids = {e["role"] for e in triggers.table(ROOT)}
        for rid, r in pl["roles"].items():
            self.assertIn(rid, ids)
            self.assertEqual(r["period_minutes"], r["every_ticks"] * 10)

    def test_new_workflow_or_slow_role_or_stale_table_fails(self):
        d = copy_repo()
        (d / ".github/workflows/new.yml").write_text("name: new\non:\n  schedule:\n    - cron: '*/5 * * * *'\njobs: {}\n")
        bad = triggers.check(d)
        self.assertTrue(any("new.yml: not in the trigger register" in b for b in bad))
        triggers.sync(d)
        self.assertTrue(any("fires 288x/day" in b for b in triggers.check(d)))
        edit(d / "seed/ultrastable.json", lambda c: c["roles"][0].update(tick_every=500))
        self.assertTrue(any("starve" in b for b in triggers.check(d)))
        (d / "seed/worker/src/events.js").write_text((d / "seed/worker/src/events.js").read_text().replace("wake-operations", "x"))
        self.assertTrue(any("stale" in b for b in triggers.check(d)))

    def test_install_is_a_dry_run_by_default_and_never_prints_a_secret(self):
        r = triggers.install("o/r", "https://w.example")
        self.assertFalse(r["applied"])
        import re
        self.assertIsNone(re.search(r"[0-9a-f]{64}", json.dumps(r["steps"])))


if __name__ == "__main__":
    unittest.main()
