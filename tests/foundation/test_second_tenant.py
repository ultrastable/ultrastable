"""Q-GROW-second-tenant-deploying: the second tenant is a real manifest, distinct from tenant 0 and QNFO."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "instances/second-tenant/instance.json"


class SecondTenant(unittest.TestCase):
    def test_manifest_is_distinct(self):
        m = json.loads(MANIFEST.read_text())
        self.assertEqual(m["slug"], "second-tenant")
        for other in ("qnfo", "ultrastable"):
            o = json.loads((ROOT / f"instances/{other}/instance.json").read_text())
            self.assertNotEqual(m["slug"], o["slug"])
        self.assertGreater(m["budget"]["usd_per_month"], 0)

    def test_validates_and_scaffolds(self):
        r = subprocess.run([sys.executable, "-m", "foundation", "validate", "--manifest", str(MANIFEST)],
                           cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run([sys.executable, "-m", "foundation", "new-system", "--manifest", str(MANIFEST), "--out", d],
                               cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
