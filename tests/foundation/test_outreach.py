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


if __name__ == "__main__":
    unittest.main()
