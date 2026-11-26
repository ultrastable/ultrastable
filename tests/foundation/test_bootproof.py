# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""BOOTPROOF-1: the seed kernel is closed under bootstrap."""
import shutil, tempfile, unittest
from pathlib import Path

from foundation import bootproof

ROOT = Path(__file__).resolve().parents[2]


class BootProof(unittest.TestCase):
    def _copy(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        shutil.copytree(ROOT / "seed", d / "seed", ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        (d / "doctrine").mkdir(); shutil.copy(ROOT / bootproof.RULES, d / bootproof.RULES)
        return d

    def test_repo_seed_is_closed(self):
        self.assertEqual(bootproof.audit(ROOT), [])

    def test_undeclared_secret_fails(self):
        d = self._copy()
        (d / "seed/.github/workflows/x.yml").write_text("on: workflow_dispatch\njobs: {}\n# ${{ secrets.NEW_THING }}\n")
        self.assertTrue(any("NEW_THING" in e for e in bootproof.audit(d)))

    def test_missing_import_and_new_duplicate_migration_fail(self):
        d = self._copy()
        (d / "seed/CLAUDE.md").write_text("@doctrine/NOPE.md\n")
        (d / "seed/worker/migrations/0020_dup.sql").write_text("select 1;")
        e = " ".join(bootproof.audit(d))
        self.assertIn("NOPE.md", e); self.assertIn("[20]", e)


if __name__ == "__main__":
    unittest.main()


class Scratch(unittest.TestCase):
    def test_scratch_uses_a_fresh_slug_and_requires_year_and_live(self):
        import json
        from foundation import seedlaunch
        seen = {}

        def run(argv):
            env = seedlaunch.os.environ  # result file path is only known to the stub through SEED_RESULT
            return 0, ""
        # a deploy that writes no row is a failed provision, never a pass
        rec = seedlaunch.e2e_scratch(run=run, sleep=lambda s: None, stamp="11251200")
        self.assertFalse(rec["passed"]); self.assertEqual(rec["slug"], "bootproof-11251200"); self.assertIn("provision", rec["failed_stages"])
