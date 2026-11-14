"""RUNS-ON-1: the runtime shell's dist is current and its node tests pass (brand/shell). Runs inside the foundation suite, so no extra workflow step."""
import shutil, subprocess, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which("node"), "node is required for the shell tests")
class RunsOnShell(unittest.TestCase):
    def run_node(self, *args):
        p = subprocess.run(["node", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        self.assertEqual(p.returncode, 0, (p.stdout + p.stderr)[-3000:])
        return p.stdout

    def test_dist_current(self):
        self.assertIn("current", self.run_node("brand/shell/build.mjs", "--check"))

    def test_node_suite(self):
        self.run_node("--test", "brand/shell/shell.test.mjs")


if __name__ == "__main__":
    unittest.main()
