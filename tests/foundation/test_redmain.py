# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REDMAIN-1 and GATE-PARITY-1: a red gate is repaired by the smallest revert, tests are never reverted, and the deploy gate runs on pull requests."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import redmain  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def git(d, *a):
    subprocess.run(["git", "-C", str(d), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *a], check=True, capture_output=True)


def repo(d: Path, bad_test=False):
    (d / "doctrine").mkdir(); (d / "src").mkdir(); (d / "tests").mkdir()
    (d / "doctrine/redmain.json").write_text(json.dumps({"max_commits_back": 10, "max_candidates": 20, "gate_timeout_s": 30, "never_revert": ["tests/*"],
        "gates": {"g": {"cmd": "bash gate.sh", "paths": ["src", "tests"], "workflows": []}}}))
    (d / "gate.sh").write_text("python3 tests/t.py\n")
    (d / "tests/t.py").write_text("import sys; sys.path.insert(0, 'src'); import a, b\nassert a.f('k=v') == ('k', 'v')\nassert b.NAME\n")
    (d / "src/a.py").write_text("# parser\n\n\n\n\ndef f(p):\n    i = p.index('=')\n    return p[:i], p[i + 1:]\n\n\n\n\nLABEL = 'old'\n")
    (d / "src/b.py").write_text("NAME = 'b'\n")
    git(d, "init", "-q", "-b", "main"); git(d, "add", "-A"); git(d, "commit", "-q", "-m", "good")
    # one commit, two hunks in the same file: a harmless improvement and the one-character break (the 2026-11-19 defect), plus an unrelated file
    (d / "src/a.py").write_text((d / "src/a.py").read_text().replace("p.index('=')", "p.index('')").replace("'old'", "'new'"))
    (d / "src/b.py").write_text("NAME = 'b2'\n")
    if bad_test:
        (d / "tests/t.py").write_text("raise SystemExit(1)\n")
    git(d, "add", "-A"); git(d, "commit", "-q", "-m", "swept branch")


class Repair(unittest.TestCase):
    def test_smallest_revert_keeps_the_rest(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); repo(d)
            self.assertFalse(redmain.gate_ok("bash gate.sh", d, 30)[0])
            r = redmain.run(d, apply=True)[0]
            self.assertEqual(r["state"], "red"); self.assertEqual(r["repair"]["kind"], "hunk"); self.assertTrue(r["applied"])
            a = (d / "src/a.py").read_text()
            self.assertIn("p.index('=')", a, "the breaking hunk is reverted")
            self.assertIn("'new'", a, "the harmless hunk in the same file is kept")
            self.assertEqual((d / "src/b.py").read_text(), "NAME = 'b2'\n", "the unrelated file is kept")
            self.assertTrue(redmain.gate_ok("bash gate.sh", d, 30)[0])

    def test_green_gate_changes_nothing(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); repo(d); git(d, "revert", "--no-edit", "HEAD")
            self.assertEqual(redmain.run(d, apply=True)[0], {"gate": "g", "state": "green"})

    def test_a_test_file_is_never_reverted(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td); repo(d, bad_test=True)
            r = redmain.run(d, apply=True)[0]
            self.assertIsNone(r["repair"]); self.assertEqual((d / "tests/t.py").read_text(), "raise SystemExit(1)\n")
            self.assertEqual(subprocess.run(["git", "-C", str(d), "status", "--porcelain"], capture_output=True, text=True).stdout, "")


class Parity(unittest.TestCase):
    def test_gates_agree_with_workflows(self):
        self.assertEqual(redmain.check(REPO), [])

    def test_ciwatch_runs_the_repair(self):
        self.assertIn("foundation redmain --run --apply", (REPO / ".github/workflows/ciwatch.yml").read_text())


if __name__ == "__main__":
    unittest.main()
