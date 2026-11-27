# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ASHBY-ARCHIVE-1: Ashby's journal index as a register, every entry with a disposition. Ultrastable is the foundation for any autonomous system."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import ashbyarchive as A, specgate

REPO = Path(__file__).resolve().parents[2]
KW = """<a href="#step" title="2 references" style="x" class="color0" nrefs="2" id="1">Step function</a>
<a href="#pain" title="1 reference" style="x" class="color1" nrefs="1" id="2">Pain</a>
<a href="#lonely" title="1 reference" style="x" class="color1" nrefs="1" id="3">Lonely</a>
<br><hr><font class="k1">Step function</font> <a class="nav" href="../index/step.html" id="step" title="View the original card index entries for this keyword">Cards</a><br>
      used once only
      <a class="page" href="../page/3436.html" title="~1952">3436</a>
      <a class="page" href="../page/4641.html" title="~1953">4641</a>
<br><hr><font class="k1">Pain</font> <a class="nav" href="../index/pain.html" id="pain" title="View the original card index entries for this keyword">Cards</a><br>
      <a class="page" href="../page/0100.html" title="~1931">100</a>
<br><hr><font class="k1">Lonely</font> <a class="nav" href="../index/lonely.html" id="lonely" title="View the original card index entries for this keyword">Cards</a><br>
      <a class="page" href="../page/4640.html" title="~1953">4641</a>
"""
CAT = """<ol><li id="1"><a class="nav" href="x">&#9608;</a> Divider: 3 </li><li id="2"><a class="nav" href="x">&#9608;</a> Section Title: The Multistable System </li>
<li id="3"><a class="nav" href="x">&#9608;</a> An entry, <a class="page" href="../../page/4640.html" title="~1953">4641</a>. </li>
<li id="4"><a class="nav" href="x">&#9608;</a> Another, <a class="page" href="../../page/3436.html" title="~1952">3436</a>. </li></ol>"""


class Archive(unittest.TestCase):
    def setUp(self):
        self.d = Path(scratch())
        (self.d / "doctrine").mkdir()
        (self.d / "docs/issues").mkdir(parents=True)
        (self.d / "foundation").mkdir()
        (self.d / "foundation/x.py").write_text("def disperse(): pass\n")
        src = self.d / "src"
        (src / "other").mkdir(parents=True)
        (src / "journal_index_index.html").write_text(KW)
        (src / "other/multistable_system.html").write_text(CAT)
        (self.d / A.REG).write_text(json.dumps({"$schema": "./schemas/ashby-archive.schema.json", "max_items": 5, "systems_categories": ["multistable_system"],
                                                "not_applicable": {"pain": "clinical"},
                                                "principles": [{"id": "AJ-T", "statement": "s", "pages": [3436], "keywords": ["step"], "mechanisms": ["foundation/x.py"],
                                                                "probes": ["grep:foundation/x.py::def disperse"], "status": "built"}]}))
        self.assertEqual(A.build(src, self.d, apply=True), {"keywords": 3, "categories": 1})

    def test_build_keeps_index_facts_not_wording(self):
        reg = A.load(self.d)
        step = next(k for k in reg["keywords"] if k["id"] == "step")
        self.assertEqual((step["refs"], step["pages"], step["years"]), (2, [3436, 4641], [1952, 1953]))
        cat = reg["categories"][0]
        self.assertEqual((cat["title"], cat["number"], cat["entries"], cat["pages"]), ("The Multistable System", "3", 2, [3436, 4641]))
        self.assertNotIn("used once only", json.dumps(reg))
        self.assertNotIn("An entry", json.dumps(reg))
        self.assertEqual(reg["principles"][0]["id"], "AJ-T")  # hand-written parts survive a rebuild

    def test_every_entry_has_a_disposition_and_pending_files_work(self):
        d = A.dispositions(A.load(self.d))
        self.assertEqual(d["step"][0], "mapped")
        self.assertEqual(d["pain"][0], "not-applicable")
        self.assertEqual(d["lonely"][0], "pending")  # shares page 4641 with a systems category, no principle yet
        self.assertEqual(d["category:multistable_system"][0], "pending")
        r = A.report(self.d)
        self.assertEqual((r["archive_triaged_share"], r["principles_built_share"]), (0.5, 1.0))
        out = A.run(self.d, apply=True)
        self.assertEqual(out["filed"], ["Q-ASHBY-lonely"])
        item = json.loads((self.d / "docs/issues/Q-ASHBY-lonely.json").read_text())
        self.assertEqual(specgate.missing(item["body"]), [])
        self.assertEqual(A.run(self.d, apply=True)["filed"], [])  # idempotent
        self.assertFalse(A.probe(self.d, "lonely")[0])
        self.assertTrue(A.probe(self.d, "AJ-T")[0])

    def test_a_keyword_the_concept_map_binds_counts_as_mapped(self):
        (self.d / A.CONCEPTS).write_text(json.dumps({"concepts": [{"id": "lone", "url": "https://ashby.info/journal/index/index.html#lonely"}]}))
        self.assertEqual(A.dispositions(A.load(self.d), A.concept_keywords(self.d))["lonely"], ("mapped", "concept:lone"))
        self.assertEqual(A.run(self.d, apply=True)["filed"], [])
        self.assertTrue(A.probe(self.d, "lonely")[0])

    def test_check_fails_a_built_principle_whose_code_is_gone(self):
        self.assertEqual(A.check(self.d), [])
        (self.d / "foundation/x.py").write_text("")
        self.assertTrue(any("probes do not all pass" in e for e in A.check(self.d)))

    def test_item_principle_files_its_build(self):
        reg = A.load(self.d)
        reg["principles"].append({"id": "AJ-NEW", "statement": "s", "pages": [3436], "mechanisms": ["foundation/x.py"], "status": "item", "build": "b"})
        (self.d / A.REG).write_text(json.dumps(reg))
        self.assertIn("Q-ASHBY-AJ-NEW", A.run(self.d, apply=True)["filed"])
        self.assertEqual(specgate.missing(json.loads((self.d / "docs/issues/Q-ASHBY-AJ-NEW.json").read_text())["body"]), [])

    def test_repo_register(self):
        self.assertEqual(A.check(REPO), [])
        self.assertGreaterEqual(len(A.load(REPO)["keywords"]), 678)

    def test_live_uses_a_named_agent(self):
        self.assertEqual(A.live(fetch=lambda u: 200), (True, "archive answered 200"))


if __name__ == "__main__":
    unittest.main()
