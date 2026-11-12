"""CLOSED-LOOP-1: the check fails on a new orphan artifact, a stale baseline entry, and a human-wait that is not identity-bound."""
import json, shutil, subprocess, tempfile, unittest
from pathlib import Path
from foundation import orphans

REPO = Path(__file__).resolve().parents[2]


def _mini(tmp: Path):
    for rel in (orphans.POLICY,):
        (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, tmp / rel)
    (tmp / "tool.py").write_text("open('docs/used.md')\n")
    (tmp / "docs").mkdir()
    (tmp / "docs/used.md").write_text("read by tool.py\n")
    (tmp / "README.md").write_text("platform consumed\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp, check=True)


class ClosedLoop(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(orphans.check(REPO), [])

    def test_policy_assumes_nothing_external(self):
        pol = orphans.policy(REPO)
        self.assertTrue(all(v is False for v in pol["assume"].values()))
        seed = json.loads((REPO / "seed/autonomy/policy.json").read_text())["closed_loop"]
        self.assertFalse(seed["assume_human_review"]); self.assertFalse(seed["assume_owner_decision"])

    def test_orphans_are_decided_by_the_one_document_audit(self):
        from foundation import docs_audit
        self.assertEqual(orphans.orphans(REPO), sorted(docs_audit.evaluate(REPO)["orphans"]))
        self.assertEqual(orphans.baseline(REPO), [])

    def test_wait_on_person_needs_identity_class_and_default(self):
        with tempfile.TemporaryDirectory() as d:
            t = Path(d); _mini(t)
            (t / "foundation/data").mkdir(parents=True)
            (t / orphans.NEEDS_YOU).write_text(json.dumps({"items": [{"id": "review", "default": "x"}, {"id": "pay", "class": "money"}]}))
            v = orphans.waits(t)["violations"]
            self.assertTrue(any("needs-you review" in x for x in v)); self.assertTrue(any("needs-you pay" in x for x in v))
            reg = t / orphans.REGISTRY; reg.parent.mkdir(parents=True)
            reg.write_text(json.dumps({"loops": [{"id": "l1", "closes_by": "system", "summary": "Waits for the owner to review the draft."}]}))
            self.assertTrue(any("loop l1" in x for x in orphans.waits(t)["violations"]))


if __name__ == "__main__":
    unittest.main()
