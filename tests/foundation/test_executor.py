"""Executor: driver-order pick, path guard, edits, no-credential recording."""
import json, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import executor  # noqa: E402

I = lambda n, labels=(), **k: {"number": n, "title": f"t{n}", "labels": [{"name": l} for l in labels], "updated_at": "2026-11-12T00:00:00Z", **k}


class Executor(unittest.TestCase):
    def test_pick_driver_order_and_skips(self):
        issues = [I(1, ["hold"]), I(2), I(3, ["p1"]), I(4, ["p0"], pull_request={}), I(5, ["owner"])]
        self.assertEqual(executor.pick(issues)["number"], 3)
        self.assertIsNone(executor.pick([I(1, ["blocked"])]))

    def test_stale_claim_is_retaken_fresh_is_not(self):
        import datetime as dt
        at = dt.datetime(2026, 11, 12, 1, 0, tzinfo=dt.timezone.utc)
        self.assertIsNone(executor.pick([I(1, ["in-progress"])], at))
        at2 = dt.datetime(2026, 11, 12, 4, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(executor.pick([I(1, ["in-progress"])], at2)["number"], 1)

    def test_path_guard(self):
        for bad in ("/etc/x", "../x", ".github/workflows/a.yml", "autonomy/policy.json", ".git/config", "a/.env"):
            self.assertIsNotNone(executor.safe_path(bad), bad)
        self.assertIsNone(executor.safe_path("docs/a.md"))

    def test_apply_edits_writes_and_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(executor.apply_edits([{"path": "docs/a.md", "content": "x"}], d), ["docs/a.md"])
            self.assertEqual((Path(d) / "docs/a.md").read_text(), "x")
            with self.assertRaises(ValueError):
                executor.apply_edits([{"path": ".github/workflows/x.yml", "content": "x"}], d)
            with self.assertRaises(ValueError):
                executor.apply_edits([], d)

    def test_no_model_credential_is_recorded_not_hidden(self):
        import os, unittest.mock as m
        with tempfile.TemporaryDirectory() as d, m.patch.object(executor, "gh_json", return_value=[I(7)]), m.patch.dict(os.environ, {}, clear=True):
            row = executor.run("o/r", apply=True, root=d)
            self.assertEqual(row["result"], "no-model-credential")
            line = json.loads((Path(d) / executor.LOG).read_text().splitlines()[0])
            self.assertEqual(line["issue"], 7)
            self.assertIn("within 24 h", line["prediction"])


if __name__ == "__main__":
    unittest.main()
