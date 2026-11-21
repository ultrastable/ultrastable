"""Unlearn tenant: a real manifest and an IDEA.md that passes the bootstrap system test (doctrine/VISION.md)."""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
INST = ROOT / "instances/unlearn"


class Unlearn(unittest.TestCase):
    def test_manifest_validates_and_is_distinct(self):
        m = json.loads((INST / "instance.json").read_text())
        self.assertEqual(m["slug"], "unlearn")
        for other in ("qnfo", "ultrastable", "second-tenant"):
            self.assertNotEqual(m["slug"], json.loads((ROOT / f"instances/{other}/instance.json").read_text())["slug"])
        self.assertGreater(m["budget"]["usd_per_month"], 0)
        r = subprocess.run([sys.executable, "-m", "foundation", "validate", "--manifest", str(INST / "instance.json")],
                           cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_idea_passes_system_test(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d) / "seed"
            shutil.copytree(ROOT / "seed", root, ignore=shutil.ignore_patterns("node_modules", "org"))
            shutil.copy(INST / "IDEA.md", root / "IDEA.md")
            r = subprocess.run([sys.executable, str(ROOT / "seed/bootstrap/bootstrap.py"), "--dry-run", "--root", str(root),
                                "--out", str(root / "org")], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            stages = {s["stage"]: s for s in json.loads((root / "org/boot-log.json").read_text())["stages"]}
            self.assertEqual(stages["qualify"]["status"], "ok")
            self.assertIn("system test passed", stages["qualify"]["detail"])
            self.assertIn("3 objective(s)", stages["instrument"]["detail"])


if __name__ == "__main__":
    unittest.main()
