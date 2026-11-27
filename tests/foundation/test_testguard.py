# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TESTS-PROTECTED-1: dropping cases or assertions, or adding a skip, in touched test files fails; moving a test does not."""
import subprocess, unittest

from _repo import scratch
from foundation import testguard as G


def git(d, *a):
    subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True)


def repo(files):
    d = scratch(); git(d, "init", "-q"); git(d, "config", "user.email", "t@t"); git(d, "config", "user.name", "t")
    for k, v in files.items():
        (d / k).parent.mkdir(parents=True, exist_ok=True); (d / k).write_text(v)
    git(d, "add", "-A"); git(d, "commit", "-qm", "base"); return d


def change(d, files, gone=()):
    for k, v in files.items():
        (d / k).parent.mkdir(parents=True, exist_ok=True); (d / k).write_text(v)
    for k in gone:
        (d / k).unlink()
    git(d, "add", "-A"); git(d, "commit", "-qm", "head")
    return G.check("HEAD~1...HEAD", d)


SKIP = "@unittest." + "skip('x')\n"  # built so the guard does not count this file
T = "def test_a(self):\n    self.assertTrue(1)\ndef test_b(self):\n    self.assertTrue(2)\n"


class Guard(unittest.TestCase):
    def test_dropping_a_case_fails(self):
        d = repo({"tests/test_x.py": T})
        self.assertTrue(change(d, {"tests/test_x.py": "def test_a(self):\n    self.assertTrue(1)\n"}))

    def test_adding_a_skip_fails(self):
        d = repo({"tests/test_x.py": T})
        self.assertTrue(change(d, {"tests/test_x.py": SKIP + T}))

    def test_moving_a_file_passes(self):
        d = repo({"tests/test_x.py": T})
        self.assertEqual(change(d, {"tests/test_y.py": T}, gone=["tests/test_x.py"]), [])
