# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-22-R13 to US-22-R15 (US-SPEC-22): a public statement is bound to a probe, a generated block follows the code and a shipped behaviour that
no surface mentions fails. The engines are foundation/claimcode.py and foundation/claims.py; their wider suites are tests/foundation/test_claimcode.py
and tests/foundation/test_claims.py. The same rules for tenants are seed/worker/src/contract.js (US-22-R16, seed/worker/test/spec-22-contract.test.js)."""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import ROOT, scratch  # noqa: E402
from foundation import claimcode, claims  # noqa: E402


def claimcode_tree(bound=None):
    d = scratch()
    (d / "doctrine").mkdir()
    (d / "site").mkdir()
    (d / "t").mkdir()
    pol = json.loads((ROOT / "doctrine/claim-code.json").read_text(encoding="utf-8"))
    pol["claims"] = bound or []
    pol["baseline"] = []
    (d / "doctrine/claim-code.json").write_text(json.dumps(pol), encoding="utf-8")
    return d


def registry(root, **parts):
    (Path(root) / "doctrine").mkdir(exist_ok=True)
    reg = {"claims": [], "generated": [], "modules": [], "ledgers": [], "inventory": [], "live": [], "coverage": {}}
    reg.update(parts)
    (Path(root) / claims.REG).write_text(json.dumps(reg), encoding="utf-8")


class BoundStatements(unittest.TestCase):
    def test_us_22_r13_a_sentence_that_states_a_cadence_with_no_bound_claim_fails_and_a_bound_one_passes(self):
        d = claimcode_tree()
        (d / "site/page.js").write_text('const t = "The loop runs every 10 minutes and always fixes what it finds.";\n', encoding="utf-8")
        errs = claimcode.check(d)
        self.assertEqual(len(errs), 1, errs)
        self.assertIn("site/page.js:1", errs[0])
        quote = "The loop runs every 10 minutes"
        d2 = claimcode_tree([{"id": "loop-cadence", "source": "site/page.js", "quote": quote, "probe": {"file": "t/cadence.test.js", "contains": "every 10 minutes"}}])
        (d2 / "site/page.js").write_text(f'const t = "{quote} and always fixes what it finds.";\n', encoding="utf-8")
        (d2 / "t/cadence.test.js").write_text("// asserts every 10 minutes\n", encoding="utf-8")
        self.assertEqual(claimcode.check(d2), [])
        (d2 / "t/cadence.test.js").write_text("// asserts nothing\n", encoding="utf-8")
        self.assertTrue(claimcode.check(d2), "a probe that no longer finds its needle unbinds the sentence")

    def test_us_22_r14_a_generated_block_that_differs_from_what_the_code_generates_fails(self):
        d = scratch()
        (d / "items").mkdir()
        (d / "items/a.txt").write_text("a", encoding="utf-8")
        (d / "items/b.txt").write_text("b", encoding="utf-8")
        gen = {"id": "item-count", "surface": "README.md", "template": "{n} items", "measure": {"n": {"glob_count": "items/*.txt"}}}
        registry(d, generated=[gen])
        (d / "README.md").write_text("We ship <!-- claim:item-count -->2 items<!-- /claim -->.\n", encoding="utf-8")
        self.assertEqual(claims.evaluate(d)[2], [])
        (d / "items/c.txt").write_text("c", encoding="utf-8")   # the code now says 3
        drift = claims.evaluate(d)[2]
        self.assertEqual([x["id"] for x in drift], ["item-count"])
        self.assertIn("surface says '2 items', code says '3 items'", drift[0]["detail"])

    def test_us_22_r15_a_shipped_behaviour_no_surface_mentions_fails_until_it_is_described_or_exempt(self):
        d = scratch()
        (d / "src.js").write_text('const ROUTES = ["/alpha", "/beta"];\n', encoding="utf-8")
        (d / "page.md").write_text("Pages: /alpha\n", encoding="utf-8")
        inv = {"id": "inv-routes", "set": {"file": "src.js", "regex": "\"(/[a-z]+)\""}, "surfaces": ["page.md"], "mention": "{item}", "note": "Every route is described.", "exempt": {}}
        registry(d, inventory=[inv])
        drift = claims.evaluate(d)[2]
        self.assertEqual([x["id"] for x in drift], ["inv-routes"])
        self.assertIn("not described: /beta", drift[0]["detail"])
        registry(d, inventory=[{**inv, "exempt": {"/beta": "internal"}}])
        self.assertEqual(claims.evaluate(d)[2], [], "a written exemption is a disposition")
        registry(d, inventory=[{**inv, "exempt": {"/beta": "internal", "/gone": "no longer in code"}}])
        self.assertIn("exemption names nothing in code: /gone", claims.evaluate(d)[2][0]["detail"])


if __name__ == "__main__":
    unittest.main()
