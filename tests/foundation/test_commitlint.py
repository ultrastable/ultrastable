"""STANDARDS-FIRST-1: the commit titles the system generates follow the Conventional Commits 1.0.0 header grammar."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import commitlint as C

REPO = Path(__file__).resolve().parents[2]


class Header(unittest.TestCase):
    def test_spec_examples_parse(self):
        for t in ("feat: allow provided config object to extend other configs", "feat(api)!: send an email to the customer when a product is shipped",
                  "docs: correct spelling of CHANGELOG", "watchdog: clock probe (RESILIENCE-1) [skip ci]", "chore(deps): bump actions"):
            self.assertIsNotNone(C.parse(t), t)
        self.assertEqual(C.parse("feat(lang)!: add Polish")["scope"], "lang")
        self.assertEqual(C.parse("feat(lang)!: add Polish")["breaking"], "!")

    def test_titles_that_are_not_a_header_do_not_parse(self):
        for t in ("executor provenance", "REGEN-1: regenerate generated files", "Stand alone: vendor the core files", "fix:no space", "fix: ", ": nothing", "scout and rnd: weekly pass"):
            self.assertIsNone(C.parse(t), t)


class Generators(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        (self.d / "doctrine").mkdir(); (self.d / ".github/workflows").mkdir(parents=True); (self.d / "scripts").mkdir()
        self.cfg = {"generators": [".github/workflows/*.yml", "scripts/*.sh"], "baseline_ceiling": 0, "baseline": []}
        (self.d / ".github/workflows/a.yml").write_text('      run: git commit -q -m "watchdog: clock probe [skip ci]"\n      run: python3 scripts/land_data.py "cost-guard: daily reading" ops/cost.jsonl\n')
        self._write()

    def tearDown(self):
        shutil.rmtree(self.d)

    def _write(self):
        (self.d / C.PATH).write_text(json.dumps(self.cfg))

    def test_the_repository_passes_and_reads_real_generators(self):
        self.assertEqual(C.check(REPO), [])
        self.assertGreaterEqual(len(C.titles(REPO)), 20)

    def test_conforming_generators_pass(self):
        self.assertEqual(C.check(self.d), [])
        self.assertEqual([t for _, t in C.titles(self.d)], ["watchdog: clock probe [skip ci]", "cost-guard: daily reading"])

    def test_a_new_title_that_is_not_a_header_fails(self):
        (self.d / "scripts/x.sh").write_text('git commit -m "Updated some files"\n')
        self.assertTrue(any("Updated some files" in b for b in C.check(self.d)))

    def test_the_baseline_only_shrinks(self):
        (self.d / "scripts/x.sh").write_text('git commit -m "Updated some files"\n')
        self.cfg.update(baseline=["scripts/x.sh: Updated some files"], baseline_ceiling=1); self._write()
        self.assertEqual(C.check(self.d), [])
        self.cfg["baseline_ceiling"] = 0; self._write()
        self.assertTrue(any("above its ceiling" in b for b in C.check(self.d)))
        self.cfg["baseline_ceiling"] = 1; self._write()
        (self.d / "scripts/x.sh").write_text('git commit -m "sweep: updated some files"\n')
        self.assertTrue(any("no generator writes any more" in b for b in C.check(self.d)))

    def test_a_lint_that_reads_nothing_fails(self):
        (self.d / ".github/workflows/a.yml").write_text("name: a\n")
        self.assertTrue(any("reading nothing" in b for b in C.check(self.d)))


if __name__ == "__main__":
    unittest.main()
