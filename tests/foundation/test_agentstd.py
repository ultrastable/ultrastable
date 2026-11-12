"""AGENT-INTEROP-1 and TERMS-CROSSWALK-1: standards are data with proofs; instruction files carry both markers; avoided words are caught."""
import copy, shutil, tempfile, unittest
from pathlib import Path
from foundation import agentstd, crosswalk

REPO = Path(__file__).resolve().parents[2]


class AgentStd(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(agentstd.check(REPO), [])

    def test_declined_standard_has_reason_and_trigger(self):
        s = {x["id"]: x for x in agentstd.load(REPO)["standards"]}
        self.assertTrue(s["a2a-agent-card"]["reason"] and s["a2a-agent-card"]["trigger"])

    def test_missing_marker_is_found(self):
        d = agentstd.load(REPO)
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "AGENTS.md").write_text("x", encoding="utf-8")
            self.assertTrue(agentstd.marker_gaps(t, d))

    def test_bad_proof_fails(self):
        with tempfile.TemporaryDirectory() as t:
            r = Path(t)
            shutil.copytree(REPO / "doctrine", r / "doctrine")
            shutil.copytree(REPO / "site", r / "site", ignore=shutil.ignore_patterns("assets", "node_modules"))
            d = agentstd.load(r)
            d["standards"][0]["proof"] = "grep:site/site.test.mjs::no-such-text-xyz"
            import json
            (r / "doctrine/agent-standards.json").write_text(json.dumps(d), encoding="utf-8")
            self.assertTrue(any("proof probe fails" in b for b in agentstd.check(r)))


class Crosswalk(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(crosswalk.check(REPO), [])

    def test_avoided_word_caught_but_marker_line_exempt(self):
        av = crosswalk.load(REPO)["avoided"]
        self.assertEqual(crosswalk.avoided_hits("The loop runs unattended.", av), ["unattended"])
        self.assertEqual(crosswalk.avoided_hits("TERMS-CROSSWALK: do not use unattended", av), [])
        self.assertEqual(crosswalk.avoided_hits("an attended step", av), [])


if __name__ == "__main__":
    unittest.main()
