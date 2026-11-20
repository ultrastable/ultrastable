# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OUTREACH-1: the segment learner's invariants hold on synthetic and live data, and its CLI is wired."""
import subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import outreach  # noqa: E402


class Outreach(unittest.TestCase):
    def test_selftest_passes_on_this_repository(self):
        self.assertEqual(outreach.selftest(ROOT), [])

    def test_cli_selftest_and_rank(self):
        r = subprocess.run([sys.executable, "-m", "foundation", "outreach", "--selftest"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "outreach ok"), r.stderr)
        r = subprocess.run([sys.executable, "-m", "foundation", "outreach", "--rank"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertIn('"segment"', r.stdout)

    def test_selftest_reports_a_prospect_whose_segment_the_profile_lacks(self):
        import json
        from _repo import scratch
        d = scratch(); (d / "outreach").mkdir()
        for f in ("intro-profile.json", "gate.json", "suppression.json"):
            (d / "outreach" / f).write_text((ROOT / "outreach" / f).read_text())
        (d / "outreach/prospects.json").write_text(json.dumps({"items": [{"id": "P-X", "segment": "no-such-segment"}]}))
        self.assertTrue(any("no-such-segment" in b for b in outreach.selftest(d)))

    def test_the_intro_queue_consumes_the_learner(self):
        self.assertIn("from foundation.outreach import order", (ROOT / "scripts/outreach_intro.py").read_text())



class DecisionPoint(unittest.TestCase):
    """DECISIONS-1: the segment pick is a registered decision, logged once per day and scored by the segment's mean reply reward."""
    def test_pick_is_logged_and_measured(self):
        import json, tempfile
        from foundation import decisions, outreach
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); (r / "doctrine").mkdir(); (r / "outreach").mkdir()
            (r / "doctrine/decisions.json").write_text((root / "doctrine/decisions.json").read_text(encoding="utf-8"), encoding="utf-8")
            targets = {"a": {"segment": "labs", "events": [{"event": "sent"}, {"event": "reply:question"}]}, "b": {"segment": "labs", "events": [{"event": "sent"}]},
                       "c": {"segment": "funders", "events": [{"event": "sent"}]}}
            (r / "outreach/intro-profile.json").write_text(json.dumps({"segments": {"labs": {}, "funders": {}}}), encoding="utf-8")
            (r / "outreach/intro-state.json").write_text(json.dumps({"targets": targets}), encoding="utf-8")
            row = outreach.record_pick(r, targets, ["labs", "funders"], "2026-11-20")
            self.assertEqual((row["point"], row["chosen"], row["ref"]), ("outreach-segment", "funders", "funders@2026-11-20"))  # one pull and no reply yet: the exploration bonus outweighs the mean of labs
            self.assertIsNone(outreach.record_pick(r, targets, ["labs", "funders"], "2026-11-20"))  # once per segment and day
            self.assertEqual(decisions.measure(r, decisions.load(r), row, True), 0.0)
            self.assertAlmostEqual(outreach.segment_reward(r, "labs"), 0.3)
            self.assertIsNone(outreach.segment_reward(r, "nobody"))
            (r / "doctrine/decisions.json").unlink()
            self.assertIsNone(outreach.record_pick(r, targets, ["labs", "funders"], "2026-11-21"))


if __name__ == "__main__":
    unittest.main()
