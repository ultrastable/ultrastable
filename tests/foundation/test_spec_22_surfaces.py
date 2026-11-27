# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-22-R10 to US-22-R12, US-22-R14, US-22-R15 and US-22-R21 (US-SPEC-22): a public statement is bound to a probe, a generated block follows the
code and is rewritten by the fix command, a shipped behaviour that no surface mentions fails, and a probe that cannot reach its surface is drift,
never a pass. The engines are foundation/claimcode.py and foundation/claims.py; their wider suites are tests/foundation/test_claimcode.py and
tests/foundation/test_claims.py. The same rules for tenants are seed/worker/src/contract.js (US-22-R13, US-22-R16,
seed/worker/test/spec-22-contract.test.js)."""
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
    def test_us_22_r21_a_sentence_that_states_a_cadence_with_no_bound_claim_fails_and_a_bound_one_passes(self):
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

    def test_us_22_r10_us_22_r14_a_generated_block_that_differs_from_what_the_code_generates_fails_and_fix_rewrites_it(self):
        """T22-6: a generated number that no longer equals its source is reported as drift, and the fix command rewrites it."""
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
        self.assertEqual(claims.fix(d), ["README.md"])
        self.assertIn("<!-- claim:item-count -->3 items<!-- /claim -->", (d / "README.md").read_text(encoding="utf-8"))
        self.assertEqual(claims.evaluate(d)[2], [], "after the fix the surface says what the code says")

    def test_us_22_r11_us_22_r15_a_shipped_behaviour_no_surface_mentions_fails_until_it_is_described_or_exempt(self):
        """T22-7: a page that is served and described nowhere is reported."""
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


class Unmeasured(unittest.TestCase):
    def test_us_22_r12_a_probe_that_cannot_run_or_reach_its_surface_is_drift_never_a_pass(self):
        """T22-8: a live probe that cannot reach its surface is reported as drift, not as a pass."""
        d = scratch()
        registry(d, live=[{"id": "front-door", "url": "https://example.invalid/", "contains": ["Built on Ultrastable"]}])

        def offline(_url):
            raise OSError("offline")
        rows, drift = claims.live(d, fetch=offline)
        self.assertEqual([r["id"] for r in drift], ["front-door"])
        self.assertFalse(rows[0]["pass"])
        self.assertIn("unmeasured", rows[0]["detail"])
        rows, drift = claims.live(d, fetch=lambda _url: "<footer>Built on Ultrastable</footer>")
        self.assertEqual(drift, [])
        self.assertTrue(rows[0]["pass"])
        ok, _ = claims.probe(d, "file:no/such/file.md")
        self.assertFalse(ok, "a probe whose source is missing is not passed")
        ok, detail = claims.probe(d, "json:no/such.json::a.b==1")
        self.assertFalse(ok)
        self.assertIn("unreadable", detail)
        ok, detail = claims.probe(d, "mystery:x")
        self.assertFalse(ok, "an unrecognised probe kind fails")


if __name__ == "__main__":
    unittest.main()
