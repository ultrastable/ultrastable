# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
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

    def test_runway_probes_hold(self):
        d = json.loads((INST / "runway.json").read_text())
        self.assertGreaterEqual(d["target_days"], 365)
        for r in d["risks"]:
            kind, _, rest = r["probe"].partition(":")
            if kind == "test":
                continue  # carried by worker/manifest.test.mjs in ultrastable/unlearn, next to the tests it names
            elif kind == "file":
                self.assertTrue((ROOT / rest).exists(), r["id"])
            elif kind == "grep":
                path, _, needle = rest.partition("::")
                self.assertIn(needle, (ROOT / path).read_text(), r["id"])
            else:
                self.fail("unknown probe kind " + kind)
        topo = json.loads((ROOT / "doctrine/topology.json").read_text())
        w = [x for x in topo["workers"] if x["id"] == "ultrastable-unlearn"][0]
        self.assertEqual(w["state"], "live")
        self.assertFalse(w["bindings"].get("secrets"), "the Worker holds no secret")


if __name__ == "__main__":
    unittest.main()
