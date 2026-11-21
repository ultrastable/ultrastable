# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# SAY-DO-1: the say-do check. Read by doctrine/registers.json (fm-say-do-gap probe test_probe_closes_on_match).
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import saydo as s, executor

REPO = Path(__file__).resolve().parents[2]


class T(unittest.TestCase):
    def _root(self, agents):
        d = Path(scratch())
        (d / "agents").mkdir()
        (d / "agents/AGENTS.md").write_text(agents, encoding="utf-8")
        (d / "foundation").mkdir()
        (d / "foundation/real.py").write_text("x = 1\n", encoding="utf-8")
        return d

    def test_rules_resolve_paths(self):
        d = self._root("# A\n\n- **Real (REAL-1).** Code: `foundation/real.py`.\n- **Fake (FAKE-1).** Code: `foundation/missing.py`.\n")
        rs = {r["id"]: r for r in s.rules(d, run_checks=False)}
        self.assertTrue(rs["REAL-1"]["ok"])
        self.assertFalse(rs["FAKE-1"]["ok"])
        self.assertEqual(rs["FAKE-1"]["missing"], ["foundation/missing.py"])

    def test_probe_closes_on_match(self):
        self.assertEqual(s.probe(REPO, "rules:NO-SUCH-RULE-9"), 0)  # no longer stated: nothing claimed
        self.assertEqual(s.probe(REPO, "nosource:x"), 2)

    def test_close_matched(self):
        d = Path(scratch())
        (d / "docs/issues").mkdir(parents=True)
        s._item(d, "rules", {"id": "OLD-1", "ok": False, "missing": ["a.py"], "failing": []})
        s._item(d, "rules", {"id": "NOW-1", "ok": False, "missing": ["b.py"], "failing": []})
        m = {"at": "t", "sources": {"rules": [{"id": "NOW-1", "ok": False}]}}
        self.assertEqual(s._close_matched(d, m), ["Q-SAYDO-rules-OLD-1"])
        self.assertIn("**Status:** closed", json.loads((d / "docs/issues/Q-SAYDO-rules-OLD-1.json").read_text())["body"])

    def test_executor_refuses_bookkeeping_only(self):
        self.assertTrue(executor.saydo_gap(["docs/issues/Q-X.json", "ops/executor.jsonl"]))
        self.assertIsNone(executor.saydo_gap(["docs/issues/Q-X.json", "foundation/real.py"]))

    def test_check(self):
        self.assertEqual(s.check(REPO), [])


if __name__ == "__main__":
    unittest.main()
