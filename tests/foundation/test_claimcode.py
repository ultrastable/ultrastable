import json, sys, unittest
from pathlib import Path
from foundation import claimcode
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def _tree(claims=None):
    d = scratch(); (d / "doctrine").mkdir(); (d / "site").mkdir(); (d / "t").mkdir()
    pol = json.loads((REPO / "doctrine/claim-code.json").read_text()); pol["claims"] = claims or []; pol["baseline"] = []
    (d / "doctrine/claim-code.json").write_text(json.dumps(pol))
    return d


class ClaimCode(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(claimcode.check(REPO), [])

    def test_an_unbound_claim_fails(self):
        d = _tree(); 
        (d / "site/page.js").write_text('const t = "The loop runs every 10 minutes and always fixes what it finds.";\n')
        errs = claimcode.check(d); self.assertEqual(len(errs), 1); self.assertIn("site/page.js:1", errs[0])

    def test_counts_and_cadences_in_words_are_claims(self):
        """SHOWCASE-CLAIM-1: the What Works showcase said 'five policy areas' (the code had twelve) and 'every six hours' style cadences in
        words slipped past the digit-only patterns."""
        d = _tree()
        (d / "site/page.js").write_text('const a = "Live public site with five policy areas and a page per programme.";\n'
                                        'const b = "The loop refreshes the ranking every six hours from public data.";\n')
        errs = claimcode.check(d); self.assertEqual(len(errs), 2, errs)

    def test_a_bound_claim_passes_and_a_changed_sentence_fails(self):
        q = "The loop runs every 10 minutes"
        d = _tree([{"id": "loop-cadence", "source": "site/page.js", "quote": q, "probe": {"file": "t/cadence.test.js", "contains": "every 10 minutes"}}])
        
        (d / "site/page.js").write_text(f'const t = "{q} and always fixes what it finds.";\n'); (d / "t/cadence.test.js").write_text("// asserts every 10 minutes\n")
        self.assertEqual(claimcode.check(d), [])
        (d / "site/page.js").write_text('const t = "The loop runs every 5 minutes and always fixes what it finds.";\n')
        self.assertTrue(any("quote no longer" in e for e in claimcode.check(d)))

    def test_a_layout_width_is_not_a_statement_and_a_stated_share_still_is(self):
        d = _tree()
        (d / "site/page.js").write_text('const a = "<p>The loop every manager runs <img alt=\\"loop\\" width=\\"90%\\"></p><textarea style=\\"width:100%\\">";\n'
                                        'const b = "<p style=\\"width:100%\\">The loop keeps 20% of its capacity for improvements here.</p>";\n')
        errs = claimcode.check(d); self.assertEqual(len(errs), 1, errs); self.assertIn("site/page.js:2", errs[0])

    def test_a_claim_whose_probe_is_missing_fails(self):
        d = _tree([{"id": "x", "source": "site/page.js", "quote": "runs every 10 minutes", "probe": {"file": "t/none.test.js", "contains": "z"}}])
        
        (d / "site/page.js").write_text('const t = "The loop runs every 10 minutes and always fixes things.";\n')
        self.assertTrue(any("probe" in e for e in claimcode.check(d)))
