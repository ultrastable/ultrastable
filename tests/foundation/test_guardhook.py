# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import importlib.util, json, subprocess, sys, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
HOOK = REPO / ".claude/hooks/guard.py"
spec = importlib.util.spec_from_file_location("guard", HOOK); guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)


class GuardHook(unittest.TestCase):
    def test_blocks(self):
        for ev in ({"tool_name": "Edit", "tool_input": {"file_path": "/r/ops/halt.json"}},
                   {"tool_name": "Write", "tool_input": {"file_path": "kernel/kernel.lock"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git commit --no-verify -m x"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git push -f origin agent/x"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git push --force origin agent/x"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}},
                   {"tool_name": "Bash", "tool_input": {"command": "rm actions-budget.json"}}):
            self.assertIsNotNone(guard.verdict(ev), ev)

    def test_allows(self):
        for ev in ({"tool_name": "Edit", "tool_input": {"file_path": "/r/foundation/kernel9.py"}},
                   {"tool_name": "Edit", "tool_input": {"file_path": "/r/.github/workflows/issues.yml"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git push -u origin claude/new-session-39cr8u"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git push --force-with-lease origin agent/x"}},
                   {"tool_name": "Bash", "tool_input": {"command": "git fetch origin main"}},
                   {"tool_name": "Read", "tool_input": {"file_path": "ops/halt.json"}}):
            self.assertIsNone(guard.verdict(ev), ev)

    def test_exit_code_two_blocks(self):
        r = subprocess.run([sys.executable, str(HOOK)], input=json.dumps({"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}),
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)
        self.assertIn("BLOCKED", r.stderr)
        self.assertEqual(subprocess.run([sys.executable, str(HOOK)], input="not json", capture_output=True, text=True).returncode, 0)

    def test_settings_wire_the_hook(self):
        s = json.loads((REPO / ".claude/settings.json").read_text())
        self.assertIn("guard.py", s["hooks"]["PreToolUse"][0]["hooks"][0]["command"])


if __name__ == "__main__":
    unittest.main()
