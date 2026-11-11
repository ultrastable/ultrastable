"""The glossary as code: every term is defined, tested, implemented and kept with its lineage."""
import json, unittest
from _repo import ROOT, copy_repo, edit
from foundation import glossary

G = "doctrine/glossary.json"
OWNER_TERMS = {"autonomy", "self-referential-closure", "loop", "closed-system", "manager", "plussing", "probe", "bootstrapping", "self-hosting", "ignorance", "core", "plugin", "write-back", "term-lineage"}


def term(r, tid, fn):
    edit(r / G, lambda d: fn(next(t for t in d["terms"] if t["id"] == tid)))


class Glossary(unittest.TestCase):
    def test_repo_glossary_clean(self):
        self.assertEqual(glossary.check(ROOT), [])

    def test_owner_keywords_are_defined(self):
        ids = {t["id"] for t in glossary.load(ROOT)["terms"]}
        self.assertTrue(OWNER_TERMS <= ids, OWNER_TERMS - ids)

    def test_missing_test_probe_fails(self):
        r = copy_repo(); term(r, "loop", lambda t: t.update(tested_by=["grep:tests/foundation/test_loops.py::def test_nothing_like_this"]))
        self.assertTrue(any("loop: test probe fails" in p for p in glossary.check(r)))
        r = copy_repo(); term(r, "loop", lambda t: t.update(tested_by=[]))
        self.assertTrue(any("loop: lacks tested_by" in p for p in glossary.check(r)))

    def test_missing_definition_and_dead_path_fail(self):
        r = copy_repo(); term(r, "plussing", lambda t: t.update(definition=""))
        self.assertTrue(any("plussing: lacks definition" in p for p in glossary.check(r)))
        r = copy_repo(); term(r, "plussing", lambda t: t.update(implemented_by=["no/such/file.py"]))
        self.assertTrue(any("no/such/file.py" in p for p in glossary.check(r)))

    def test_lineage_must_match_version(self):
        r = copy_repo(); term(r, "autonomy", lambda t: t.update(version="9.0.0"))
        self.assertTrue(any("not the last lineage entry" in p for p in glossary.check(r)))

    def test_glossary_md_stale_fails(self):
        r = copy_repo(); (r / "GLOSSARY.md").write_text("old\n")
        self.assertTrue(any("GLOSSARY.md is stale" in p for p in glossary.check(r)))
        self.assertEqual(glossary.apply(r), ["GLOSSARY.md"])
        self.assertEqual(glossary.check(r), [])

    def test_autonomy_definition_carries_the_tagline(self):
        r = copy_repo(); term(r, "autonomy", lambda t: t.update(definition="Running without people."))
        self.assertTrue(any("positioning autonomy tagline" in p for p in glossary.check(r)))

    def test_term_change_bumps_version_and_records_lineage(self):
        r = copy_repo()
        t = glossary.term_change(r, "probe", "A machine-checkable test with a stated source.", "tightened", "doctrine/glossary.json", today="2026-12-01")
        self.assertEqual(t["version"], "2.0.0")
        self.assertEqual(t["lineage"][-1], {"version": "2.0.0", "date": "2026-12-01", "change": "tightened", "source": "doctrine/glossary.json"})
        self.assertEqual(len(t["lineage"]), 2)
        self.assertEqual(glossary.check(r), [])
        with self.assertRaises(ValueError):
            glossary.term_change(r, "probe", "", "why", "x")
        with self.assertRaises(ValueError):
            glossary.term_change(r, "nope", "d", "w", "x")

    def test_panel_has_every_term(self):
        p = glossary.panel(ROOT)
        self.assertEqual(len(p["rows"]), len(glossary.load(ROOT)["terms"]))
        self.assertEqual(p["id"], "glossary")
        snap = json.loads((ROOT / "dashboard/snapshot.json").read_text())
        self.assertIn("glossary", [x["id"] for x in snap["panels"]])


if __name__ == "__main__":
    unittest.main()
