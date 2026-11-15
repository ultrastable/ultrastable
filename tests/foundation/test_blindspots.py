# BLINDSPOT-1: the system knows what the owner cannot know to ask for.
import json, shutil, tempfile, unittest, datetime as dt
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import blindspots

REPO = Path(__file__).resolve().parents[2]


class Blindspots(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for p in ["doctrine/blindspots.json", "ops/blindspots", "site/legalpages.js", "site/worker.js", "scripts/outreach_intro.py", "outreach/intro-profile.json", "doctrine/cost.json", "docs/issues"]:
            s, d = REPO / p, self.tmp / p
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(s, d) if s.is_dir() else shutil.copy(s, d)

    def test_repo_register_is_valid(self):
        self.assertEqual(blindspots.check(REPO), [])

    def test_unmeasured_is_not_ok(self):
        row = {r["id"]: r for r in blindspots.scan(self.tmp)["needs"]}["email-authentication"]
        self.assertEqual(row["state"], "unmeasured")

    def test_failed_probe_files_item_but_identity_bound_does_not(self):
        ids = {i["id"] for i in blindspots.items(blindspots.scan(self.tmp))}
        self.assertIn("Q-BLIND-backup-restore", ids)
        self.assertNotIn("Q-BLIND-terms-of-use", ids)
        self.assertNotIn("Q-BLIND-privacy-notice", ids)

    def test_page_removed_reopens_the_gap(self):
        f = self.tmp / "site/legalpages.js"
        f.write_text(f.read_text().replace("export const PRIVACY", "export const GONE"))
        row = {r["id"]: r for r in blindspots.scan(self.tmp)["needs"]}["privacy-notice"]
        self.assertEqual(row["state"], "gap")

    def test_sweep_due_then_answered_then_due_again(self):
        today = dt.date(2026, 11, 14)
        due = lambda t: next(s for s in blindspots.scan(self.tmp, today=t)["sweeps"] if s["domain"] == "security")["due"]
        self.assertTrue(due(today))
        blindspots.answer(self.tmp, "security", "Reviewed new endpoints since last sweep; evidence in PR 360 and the privacy page.")
        self.assertFalse(due(dt.date.today()))
        self.assertTrue(due(dt.date.today() + dt.timedelta(days=31)))
        with self.assertRaises(SystemExit):
            blindspots.answer(self.tmp, "security", "short")

    def test_learn_grows_register_and_gate_must_be_allowed(self):
        blindspots.learn(self.tmp, "new-need", "legal", "found after a rejection", "file:nope.md")
        self.assertIn("new-need", {n["id"] for n in blindspots.load(self.tmp)["needs"]})
        blindspots.learn(self.tmp, "bad-gate", "legal", "x", "file:nope.md", gate="owner-review")
        self.assertTrue(any("allowed identity-bound gate" in e for e in blindspots.check(self.tmp)))


if __name__ == "__main__":
    unittest.main()
