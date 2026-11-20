# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""INSTALL-1: one package, one command, no repository history; additive, digest-checked, and the organization is planned."""
import json, shutil, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SEED))
import install as ins  # noqa: E402


class Install(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp(prefix="us-install-")); self.addCleanup(shutil.rmtree, self.d, True)
        self.pkg = self.d / "ultrastable-seed.pyz"
        self.info = ins.pack(SEED, self.pkg)

    def test_package_is_deterministic_and_carries_no_history(self):
        again = ins.pack(SEED, self.d / "again.pyz")
        self.assertEqual(self.info["sha256"], again["sha256"])
        names = zipfile.ZipFile(self.pkg).namelist()
        self.assertIn("__main__.py", names); self.assertIn("MANIFEST.json", names); self.assertIn("seed/bootstrap/bootstrap.py", names)
        self.assertFalse([n for n in names if "/.git/" in n or n.endswith(".pyc") or "/org/" in n or "node_modules" in n])

    def test_one_command_installs_plans_and_verifies(self):
        target = self.d / "pilot"; target.mkdir(); (target / "README.md").write_text("# mine\n")
        r = subprocess.run([sys.executable, str(self.pkg), "--into", str(target)], capture_output=True, text=True, cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual((target / "README.md").read_text(), "# mine\n", "an existing file was overwritten")
        self.assertIn("README.md", out["kept"])
        for f in ("AGENTS.md", "bootstrap/bootstrap.py", "worker/src/tick.js", ".github/workflows/bootstrap.yml", "autonomy/policy.json", "ultrastable.install.json"):
            self.assertTrue((target / f).is_file(), f)
        self.assertEqual(out["planned"]["exit"], 0); self.assertEqual(out["planned"]["stages"]["read"], "ok")
        self.assertTrue((target / "org/boot-log.json").is_file(), "the organization was not planned")
        self.assertEqual(subprocess.run([sys.executable, str(self.pkg), "verify", "--into", str(target)], capture_output=True, text=True).returncode, 0)
        (target / "AGENTS.md").write_text("tampered")
        v = subprocess.run([sys.executable, str(self.pkg), "verify", "--into", str(target)], capture_output=True, text=True)
        self.assertEqual(v.returncode, 1); self.assertIn("changed since install: AGENTS.md", v.stdout)

    def test_second_run_adds_nothing(self):
        target = self.d / "pilot"
        first = ins.install(target, self.pkg, plan=False)
        second = ins.install(target, self.pkg, plan=False)
        self.assertGreater(first["added"], 200); self.assertEqual(second["added"], 0)

    def test_own_idea_file_wins_over_the_template(self):
        idea = self.d / "my-idea.md"; idea.write_text("# My idea\n\nmine\n")
        target = self.d / "pilot"
        ins.install(target, self.pkg, idea_file=idea, plan=False)
        self.assertEqual((target / "IDEA.md").read_text(), "# My idea\n\nmine\n")

    def test_digest_mismatch_stops_before_writing(self):
        bad = self.d / "bad.pyz"
        with zipfile.ZipFile(self.pkg) as zin, zipfile.ZipFile(bad, "w") as zout:
            for n in zin.namelist():
                zout.writestr(n, b"tampered" if n == "seed/AGENTS.md" else zin.read(n))
        target = self.d / "pilot"
        r = ins.install(target, bad, plan=False)
        self.assertEqual((r["ok"], r["exit"]), (False, ins.EXIT_DIGEST)); self.assertIn("seed/AGENTS.md"[5:], r["error"])
        self.assertFalse(target.exists(), "files were written despite a digest mismatch")


if __name__ == "__main__":
    unittest.main()
