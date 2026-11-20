# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STRAYS-1: a code file where nothing runs it fails the build, on every route that can bring one to main."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import strays as S  # noqa: E402

POL = {"code_roots": ["foundation", "site", ".github", "seed", "github"], "extensions": [".py", ".js", ".yml", ".sh"], "baseline": ["legacy.py"], "workflow_template_dirs": ["seed/adapters/workflows"]}


class Classify(unittest.TestCase):
    def kinds(self, *paths):
        return {f["path"]: f["kind"] for f in S.classify(paths, POL)}

    def test_model_stubs_that_reached_main_are_strays(self):
        k = self.kinds("scoreboard.py", "connector_health.py", "src/agents/a2a_v1.py", "src/connector/probe.js")
        self.assertEqual(k, {"scoreboard.py": "stray-root", "connector_health.py": "stray-root", "src/agents/a2a_v1.py": "stray-dir", "src/connector/probe.js": "stray-dir"})

    def test_workflow_outside_dot_github_is_a_decoy(self):
        k = self.kinds("github/workflows/checks.yml", ".github/workflows/checks.yml", "seed/.github/workflows/bootstrap.yml", "seed/adapters/workflows/lane.yml")
        self.assertEqual(k, {"github/workflows/checks.yml": "decoy-workflow"})

    def test_code_roots_documents_and_baseline_pass(self):
        self.assertEqual(self.kinds("foundation/x.py", "site/worker.js", "README.md", "wrangler.toml", "newdir/notes.md", "legacy.py", "github/bootstrap.sh"), {})


class Repo(unittest.TestCase):
    def test_repository_is_clean_and_wired(self):
        self.assertEqual(S.check(ROOT), [])
        gate = [" ".join(g) for g in json.loads((ROOT / "doctrine/branchsweep.json").read_text(encoding="utf-8"))["gate"]]
        self.assertIn("python3 -m foundation strays --check", gate, "the branch sweep must undo a merge that adds a stray")
        self.assertIn("python3 -m foundation strays --check", (ROOT / ".github/workflows/checks.yml").read_text(encoding="utf-8"))

    def test_baseline_is_empty(self):
        self.assertEqual(S.policy(ROOT).get("baseline"), [], "shrink-only: a stray is removed or moved under a code root, never baselined")


if __name__ == "__main__":
    unittest.main()
