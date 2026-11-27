"""INSTRUCTIONS-BUDGET-1: a map stays small; an oversize file may only shrink; a dead link fails."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import instructions_budget as B  # noqa: E402

CFG = {"limits": {"root_bytes": 100, "file_bytes": 100, "skill_lines": 3}, "baseline": {}}


def tree(files, cfg=CFG):
    d = Path(tempfile.mkdtemp(prefix="ib-")); (d / "doctrine").mkdir()
    (d / B.CFG).write_text(json.dumps(cfg))
    for rel, text in files.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True); (d / rel).write_text(text)
    return d


class Budget(unittest.TestCase):
    def test_small_map_passes_and_new_oversize_file_fails(self):
        self.assertEqual(B.check(tree({"AGENTS.md": "map\n"}))[0], [])
        errs, _ = B.check(tree({"AGENTS.md": "x" * 101}))
        self.assertEqual(len(errs), 1); self.assertIn("not on the baseline", errs[0])

    def test_baseline_only_shrinks(self):
        cfg = {**CFG, "baseline": {"agents/AGENTS.md": 200}}
        self.assertEqual(B.check(tree({"agents/AGENTS.md": "x" * 200}, cfg))[0], [])
        errs, _ = B.check(tree({"agents/AGENTS.md": "x" * 201}, cfg)); self.assertIn("grew", errs[0])
        d = tree({"agents/AGENTS.md": "x" * 150}, cfg)
        errs, notes = B.check(d, ratchet=True); self.assertEqual(errs, []); self.assertTrue(notes)
        self.assertEqual(json.loads((d / B.CFG).read_text())["baseline"]["agents/AGENTS.md"], 150)

    def test_skill_lines_and_dead_links(self):
        errs, _ = B.check(tree({"a/SKILL.md": "1\n2\n3\n4\n"})); self.assertIn("skill_lines", errs[0])
        errs, _ = B.check(tree({"AGENTS.md": "[x](docs/none.md)"})); self.assertIn("dead link", errs[0])

    def test_this_repository_passes(self):
        self.assertEqual(B.check()[0], [])


if __name__ == "__main__":
    unittest.main()
