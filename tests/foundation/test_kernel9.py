# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, unittest
from pathlib import Path

from _repo import scratch

from foundation import kernel9

REPO = Path(__file__).resolve().parents[2]


def copy():
    d = Path(scratch())
    for rel in ("doctrine/kernel-9.json", "doctrine/kernel-9.0.0.md", "kernel/kernel.lock"):
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, d / rel)
    for c in kernel9.load(REPO)["clauses"]:
        for p in c["enforced_by"]:
            (d / p).parent.mkdir(parents=True, exist_ok=True)
            (d / p).touch()
    return d


class Kernel9Test(unittest.TestCase):
    def test_repo_passes(self):
        self.assertEqual(kernel9.check(REPO), [])

    def test_every_clause_of_the_text_is_mapped(self):
        self.assertEqual(len(kernel9.load(REPO)["clauses"]), 29)

    def test_text_drift_fails_the_pin(self):
        d = copy()
        with open(d / "doctrine/kernel-9.0.0.md", "a") as f:
            f.write("F6 I may skip a failing test.\n")
        bad = kernel9.check(d)
        self.assertTrue(any("sha256" in b for b in bad))
        self.assertTrue(any("F6" in b for b in bad))

    def test_missing_enforcer_and_unexplained_gap_fail(self):
        d = copy()
        k = json.loads((d / kernel9.PATH).read_text())
        (d / k["clauses"][2]["enforced_by"][0]).unlink()
        k["clauses"][8]["missing"] = ""
        (d / kernel9.PATH).write_text(json.dumps(k))
        bad = kernel9.check(d)
        self.assertTrue(any("does not exist" in b for b in bad))
        self.assertTrue(any("no reason" in b for b in bad))

    def test_cannot_activate_with_a_conflict(self):
        d = copy()
        k = json.loads((d / kernel9.PATH).read_text())
        k["active"] = True
        (d / kernel9.PATH).write_text(json.dumps(k))
        self.assertTrue(any("still in conflict" in b for b in kernel9.check(d)))


if __name__ == "__main__":
    unittest.main()
