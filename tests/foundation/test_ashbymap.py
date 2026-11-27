import json
import tempfile
import unittest
from pathlib import Path

from foundation import ashbymap


class AshbyMap(unittest.TestCase):
    def test_repo_map_holds(self):
        self.assertEqual(ashbymap.check(), [])

    def test_interference_counts_a_step_that_knocks_another_variable_out(self):
        rows = [
            {"at": "2026-11-27T00:00:00Z", "ev": "reading", "var": "b", "ok": True},
            {"at": "2026-11-27T00:01:00Z", "ev": "step", "var": "a"},
            {"at": "2026-11-27T00:10:00Z", "ev": "reading", "var": "b", "ok": False},
            {"at": "2026-11-27T01:00:00Z", "ev": "step", "var": "a"},
            {"at": "2026-11-27T01:10:00Z", "ev": "reading", "var": "b", "ok": True, "unmeasured": True},
        ]
        self.assertEqual(ashbymap.interference(rows), {"steps": 2, "disturbed": 1, "interference_share": 0.5})

    def test_no_steps_is_unmeasured_not_zero(self):
        self.assertIsNone(ashbymap.interference([])["interference_share"])

    def test_every_kernel_export_is_bound_and_an_unbound_one_fails(self):
        self.assertEqual(ashbymap.unbound(), [])
        self.assertIn("nextTrial", ashbymap.exports())
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "doctrine").mkdir()
            (root / "k.js").write_text("export function bound(a) {}\nexport const loose = 1;\n")
            (root / "doctrine/ashby-concepts.json").write_text(json.dumps({"kernel": "k.js", "concepts": [
                {"id": "a", "url": "https://ashby.info/journal/index/index.html#veto", "summary": "s", "mechanisms": ["k.js::export function bound"], "status": "implemented", "pages": [5307]},
                {"id": "b", "url": "https://ashby.info/journal/index/index.html#gating", "summary": "s", "mechanisms": [], "status": "gap", "item": "Q-X", "pages": [9000]},
                {"id": "c", "url": "https://example.com/x", "summary": "s", "mechanisms": [], "status": "implemented"}]}))
            errs = ashbymap.check(root)
            self.assertIn("k.js: export loose is bound by no concept", errs)
            self.assertIn("b: a cited journal page is outside 1..7189", errs)
            self.assertIn("b: gap with no open item", errs)
            self.assertIn("c: source is not an ashby.info page", errs)
            self.assertIn("c: implemented with no mechanism", errs)
            self.assertEqual(ashbymap.probe("b", root), ["b: still a gap"])
            self.assertEqual(ashbymap.probe("zz", root), ["zz: no such concept"])

    def test_live_coverage_counts_anchors_and_an_unreadable_index_is_unmeasured(self):
        page = '<a class="nav" href="../index/veto.html" id="veto" title="x">Cards</a> <a class="nav" href="../index/trial.html" id="trial">Cards</a>' + \
               "".join(f'<a class="nav" href="../index/k{i}.html" id="k{i}">Cards</a>' for i in range(8))
        r = ashbymap.live(fetch=lambda url: page)
        self.assertTrue(r["measured"])
        self.assertEqual((r["keywords"], r["bound"], r["share"]), (10, 2, 0.2))
        self.assertIn("gating", r["dead"])  # an anchor the register cites and the index does not have is reported, not ignored

        def down(url):
            raise OSError("no route")
        r = ashbymap.live(fetch=down)
        self.assertFalse(r["measured"])
        self.assertIsNone(r["share"])
        self.assertFalse(ashbymap.live(fetch=lambda url: "<html></html>")["measured"])

    def test_gaps_name_items_whose_probe_is_this_module(self):
        m = json.loads((ashbymap.REPO / ashbymap.MAP).read_text())
        for c in m["concepts"]:
            if c["status"] == "gap":
                body = json.loads((ashbymap.REPO / "docs/issues" / f"{c['item']}.json").read_text())["body"]
                self.assertIn(f"python3 -m foundation ashbymap --probe {c['id']}", body)
                self.assertEqual(ashbymap.probe(c["id"]), [f"{c['id']}: still a gap"])
        self.assertEqual(ashbymap.readings()["ashby_gaps"], sum(c["status"] == "gap" for c in m["concepts"]))


if __name__ == "__main__":
    unittest.main()
