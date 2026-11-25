# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# CONSTITUTION-1: the platform side. The seed's constitution agrees with the code, the platform bindings resolve, and a fresh seed boots it.
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import constitution as k  # noqa: E402


class T(unittest.TestCase):
    def test_constitution_agrees_with_code(self):
        self.assertEqual(k.audit(), [])

    def test_fresh_seed_boots_the_constitution(self):
        self.assertEqual(k.fresh(), [])

    def test_a_new_standing_rule_with_no_entry_fails(self):
        import tempfile, shutil
        with tempfile.TemporaryDirectory() as d:
            shutil.copytree(ROOT / "seed", Path(d) / "seed", ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "org"))
            (Path(d) / "agents").mkdir()
            shutil.copy(ROOT / "agents/AGENTS.md", Path(d) / "agents/AGENTS.md")
            a = Path(d) / "agents/AGENTS.md"
            a.write_text(a.read_text() + "\n- **Brand new rule (BRAND-NEW-1, Rowan 2026-11-25).** words only.\n")
            self.assertTrue(any("BRAND-NEW-1" in e for e in k.audit(Path(d))))

    def test_failure_mode_and_detector_registered(self):
        fm = {m["id"] for m in json.loads((ROOT / "doctrine/registers.json").read_text())["failure_modes"]}
        det = {d["id"]: d for d in json.loads((ROOT / "doctrine/detectors.json").read_text())["detectors"]}
        self.assertIn("fm-constitution-drift", fm)
        self.assertEqual(det["constitution"]["failure_mode"], "fm-constitution-drift")


if __name__ == "__main__":
    unittest.main()
