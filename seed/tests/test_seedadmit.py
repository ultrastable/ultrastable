# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# SEED-ADMIT-1 (portable): the kit is well formed and a system can wire and audit itself with nothing but its own files.
import shutil, sys, tempfile, unittest
from pathlib import Path

SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import seedadmit as s  # noqa: E402


class T(unittest.TestCase):
    def test_kit_is_well_formed(self):
        self.assertEqual(s.check(SEED), [])

    def test_workflow_template_is_lint_clean(self):
        self.assertEqual(s.workflow_check(SEED), [])

    def test_wire_is_additive_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            for rel in ("autonomy", "scripts", "worker", "bootstrap", "analytics", "standards"):
                shutil.copytree(SEED / rel, Path(d) / rel, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
            (Path(d) / "scripts/seedadmit.py").write_text((Path(d) / "scripts/seedadmit.py").read_text())
            first = s.wire(d, SEED)
            self.assertIn(".github/workflows/autonomy.yml", first["added"])
            self.assertEqual(s.wire(d, SEED)["added"], [])
            self.assertTrue(all(v["ok"] for k, v in s.audit(d, probes=False).items()), s.audit(d, probes=False))


if __name__ == "__main__":
    unittest.main()
