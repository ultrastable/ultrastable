# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FAILMINE-1: failures are mined, classified, discovered, escalated on recurrence and measured; test module names cannot collide."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(Path(__file__).resolve().parent))
from foundation import failmine  # noqa: E402


def ev(i, text, cls, opened="2026-11-01T00:00:00Z", closed=""):
    e = {"source": "ci", "id": i, "text": text, "class": cls, "opened": opened, "closed": closed}
    e["signature"] = failmine.signature(text); e["sig"] = failmine._h(cls + "|" + e["signature"]); return e


class FailMine(unittest.TestCase):
    def test_check_passes(self):
        self.assertEqual(failmine.check(ROOT), [])

    def test_signature_ignores_ids_numbers_and_hashes(self):
        self.assertEqual(failmine.signature("PR #596 merged without a green checks run on b492f08"),
                         failmine.signature("PR #1461 merged without a green checks run on 0a1b2c3"))

    def test_classify(self):
        self.assertEqual(failmine.classify("model @cf/x was retired"), "model-retired")
        self.assertEqual(failmine.classify("ImportError: module incorrectly imported"), "test-host")

    def test_recurrence_and_mttr(self):
        m = failmine.measure([ev("a", "x fails", "ci-red", closed="2026-11-01T02:00:00Z"), ev("b", "x fails", "ci-red"), ev("c", "y", "other")])
        self.assertAlmostEqual(m["recurrence_rate"], 0.333, places=2)
        self.assertEqual(m["mttr_hours_median"], 2.0)
        self.assertEqual(m["recurring"][0]["disposition"], "mutate")

    def test_three_unregistered_events_register_one_mode_two_register_none(self):
        import shutil
        from _repo import scratch
        d = scratch()
        (d / "doctrine").mkdir()
        for f in ("registers.json", "detectors.json"):
            shutil.copy(ROOT / "doctrine" / f, d / "doctrine" / f)
        two = [ev(str(i), "model gone retired", "model-retired") for i in range(2)]
        self.assertEqual(failmine.discover(two, d, apply=True), [])
        three = two + [ev("3", "model gone retired", "model-retired")]
        new = failmine.discover(three, d, apply=True)
        self.assertEqual(len(new), 1)
        det = json.loads((d / "doctrine/detectors.json").read_text())["detectors"]
        self.assertTrue(any(x["failure_mode"] == new[0] and "--probe" in x["run"] for x in det))
        self.assertEqual(failmine.discover(three, d, apply=True), [])  # idempotent


class TestModuleNames(unittest.TestCase):
    def test_no_test_module_shadows_a_scripts_module(self):
        """Root cause of fm-tests-red on 2026-11-21: tests insert scripts/ first on sys.path, so a tests/foundation module sharing a name with a
        scripts/ module is imported from scripts/ and discovery aborts."""
        clash = {p.name for p in (ROOT / "tests/foundation").glob("*.py")} & {p.name for p in (ROOT / "scripts").glob("*.py")}
        self.assertEqual(clash, set())


if __name__ == "__main__":
    unittest.main()


class SeedVendored(unittest.TestCase):
    def test_seed_vendored_core_matches_workers_core(self):
        """SEED-SELFCONTAINED-1: the seed imports core modules from its own vendor/ copy so a standalone checkout is green; the copy stays identical."""
        for m in ("progress", "audit"):
            v = (ROOT / f"seed/worker/src/vendor/core/{m}.js").read_text().split("\n", 1)[1]
            self.assertEqual(v, (ROOT / f"workers/core/{m}/index.js").read_text(), m)
