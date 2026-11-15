"""PUBLICATION-1: policy is data with proofs; a flip is refused unless the audit is clean; shallow history is unmeasured."""
import json, unittest
from pathlib import Path
from unittest import mock
from foundation import publication
from ._repo import ROOT, copy_repo


class Publication(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(publication.check(ROOT), [])

    def test_missing_lesson_probe_fails(self):
        r = copy_repo()
        p = Path(r) / publication.PATH
        d = json.loads(p.read_text(encoding="utf-8"))
        d["lessons"][0]["probe"] = "grep:foundation/publication.py::no_such_text_xyz"
        p.write_text(json.dumps(d), encoding="utf-8")
        self.assertTrue(any("probe fails" in e for e in publication.check(r)))

    def test_flip_refused_when_audit_not_clean(self):
        with mock.patch.object(publication, "audit", return_value={"tree": [], "history": {"state": "unmeasured"}, "tripwires": []}):
            with mock.patch.object(publication, "_log"):
                self.assertEqual(publication.flip(ROOT, apply=True), 2)

    def test_flip_without_credential_changes_nothing(self):
        ok = {"tree": [], "history": {"state": "clean"}, "tripwires": []}
        calls = []
        with mock.patch.object(publication, "audit", return_value=ok), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(publication.flip(ROOT, apply=True, run=lambda *a, **k: calls.append(a)), 3)
        self.assertEqual(calls, [])

    def test_flip_runs_in_order_with_token(self):
        ok = {"tree": [], "history": {"state": "clean"}, "tripwires": []}
        seen = []
        run = lambda cmd, **k: seen.append(cmd[3]) or mock.Mock(returncode=0)
        with mock.patch.object(publication, "audit", return_value=ok), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {"GH_TOKEN": "x"}):
            self.assertEqual(publication.flip(ROOT, apply=True, run=run), 0)
        self.assertEqual(seen, [f"ultrastable/{r}" for r in publication.load(ROOT)["flip_order"]])


if __name__ == "__main__":
    unittest.main()
