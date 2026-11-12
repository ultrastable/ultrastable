"""CLOSED-LOOP-1: the check fails on a new orphan artifact, a stale baseline entry, and a human-wait that is not identity-bound."""
import json, shutil, subprocess, tempfile, unittest
from pathlib import Path
from foundation import closedloop

REPO = Path(__file__).resolve().parents[2]


def _mini(tmp: Path):
    for rel in (closedloop.POLICY,):
        (tmp / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, tmp / rel)
    (tmp / "tool.py").write_text("open('docs/used.md')\n")
    (tmp / "docs").mkdir()
    (tmp / "docs/used.md").write_text("read by tool.py\n")
    (tmp / "README.md").write_text("platform consumed\n")
    subprocess.run(["git", "init", "-q"], cwd=tmp, check=True)


class ClosedLoop(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(closedloop.check(REPO), [])

    def test_policy_assumes_nothing_external(self):
        pol = closedloop.policy(REPO)
        self.assertTrue(all(v is False for v in pol["assume"].values()))
        seed = json.loads((REPO / "seed/autonomy/policy.json").read_text())["closed_loop"]
        self.assertFalse(seed["assume_human_review"]); self.assertFalse(seed["assume_owner_decision"])

    def test_new_orphan_fails_and_baseline_is_shrink_only(self):
        with tempfile.TemporaryDirectory() as d:
            t = Path(d); _mini(t)
            subprocess.run(["git", "add", "-A"], cwd=t, check=True)
            self.assertEqual(closedloop.check(t), [])
            (t / "docs/report.md").write_text("nobody reads this\n")
            subprocess.run(["git", "add", "-A"], cwd=t, check=True)
            self.assertTrue(any("orphan artifact docs/report.md" in b for b in closedloop.check(t)))
            closedloop.write_baseline(t)  # an existing baseline never grows
            (t / closedloop.BASELINE).write_text(json.dumps({"orphans": []}))
            self.assertEqual(closedloop.write_baseline(t), 0)
            (t / closedloop.BASELINE).write_text(json.dumps({"orphans": ["docs/used.md"]}))
            self.assertTrue(any("no longer an orphan" in b for b in closedloop.check(t)))

    def test_wait_on_person_needs_identity_class_and_default(self):
        with tempfile.TemporaryDirectory() as d:
            t = Path(d); _mini(t)
            (t / "foundation/data").mkdir(parents=True)
            (t / closedloop.NEEDS_YOU).write_text(json.dumps({"items": [{"id": "review", "default": "x"}, {"id": "pay", "class": "money"}]}))
            v = closedloop.waits(t)["violations"]
            self.assertTrue(any("needs-you review" in x for x in v)); self.assertTrue(any("needs-you pay" in x for x in v))
            reg = t / closedloop.REGISTRY; reg.parent.mkdir(parents=True)
            reg.write_text(json.dumps({"loops": [{"id": "l1", "closes_by": "system", "summary": "Waits for the owner to review the draft."}]}))
            self.assertTrue(any("loop l1" in x for x in closedloop.waits(t)["violations"]))


if __name__ == "__main__":
    unittest.main()
