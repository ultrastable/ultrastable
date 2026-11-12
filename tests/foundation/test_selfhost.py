"""Ultrastable runs on itself. These tests boot the organization from the repository alone and prove the verifier fails when a process leans on an unrecorded tool."""
import json, os, shutil, sqlite3, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import doctrine, selfhost  # noqa: E402
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)

SKIP = shutil.ignore_patterns(".git", "node_modules", "kit", "ip", "artifacts", "research", ".selfhost", "__pycache__", "qnfo-platform-thread")


def copy_repo():
    d = scratch()
    shutil.copytree(ROOT, d, ignore=SKIP, dirs_exist_ok=True)
    return Path(d)


def edit(path, fn):
    data = json.loads(path.read_text())
    fn(data)
    path.write_text(json.dumps(data))


class Verifier(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(selfhost.verify(ROOT), [])

    def test_workflow_using_unregistered_tool_fails(self):
        r = copy_repo()
        (r / ".github/workflows/notify.yml").write_text("run: curl https://hooks.slack.com/services/x\n")
        self.assertTrue(any("hooks" in p and "no recorded adapter" in p for p in selfhost.verify(r)))

    def test_outside_tool_without_gap_fails(self):
        r = copy_repo()
        edit(r / "instances/ultrastable/gaps.json", lambda d: d.update(gaps=[g for g in d["gaps"] if g["tool"] != "github"]))
        self.assertTrue(any("'github' has no entry in the gap register" in p for p in selfhost.verify(r)))

    def test_process_with_unregistered_tool_fails(self):
        r = copy_repo()
        edit(r / "instances/ultrastable/selfhost.json", lambda d: d["processes"][0]["tools"].append("jira"))
        self.assertTrue(any("'jira' has no recorded adapter" in p for p in selfhost.verify(r)))

    def test_missing_area_and_path_fail(self):
        r = copy_repo()
        edit(r / "instances/ultrastable/selfhost.json", lambda d: d.update(processes=[p for p in d["processes"] if p["area"] != "release"]))
        self.assertTrue(any("'release'" in p for p in selfhost.verify(r)))
        r = copy_repo()
        edit(r / "instances/ultrastable/selfhost.json", lambda d: d["processes"][0]["system_path"].append("nope/missing.md"))
        self.assertTrue(any("nope/missing.md" in p for p in selfhost.verify(r)))

    def test_gap_must_have_plan_and_a_truthful_probe(self):
        r = copy_repo()
        edit(r / "instances/ultrastable/gaps.json", lambda d: d["gaps"][0].update(plan=""))
        self.assertTrue(any("lacks plan" in p for p in selfhost.verify(r)))
        r = copy_repo()
        edit(r / "instances/ultrastable/gaps.json", lambda d: d["gaps"][0].update(status="closed"))
        self.assertTrue(any("marked closed but its probe fails" in p for p in selfhost.verify(r)))
        r = copy_repo()
        (r / "seed/worker/src/forge.js").write_text("export {}\n")
        self.assertTrue(any("probe now passes" in p for p in selfhost.verify(r)))

    def test_gap_register_lists_each_probe_state(self):
        rows = selfhost.gaps_report(ROOT)
        self.assertTrue(rows and all(g["plan"] and g["closing_probe"] for g in rows))
        self.assertTrue(all(g["probe_passes"] == (g["status"] == "closed") for g in rows))


class Boot(unittest.TestCase):
    def db(self):
        return os.path.join(scratch(), "u.db")

    def test_minimal_path_boots_everything_from_the_repo(self):
        out = selfhost.boot(ROOT, self.db(), node=False)
        self.assertEqual(out["status"], "ok")
        con = sqlite3.connect(out["db"])
        issues = len([f for f in (ROOT / "docs/issues").glob("*.json") if not f.name.startswith("_")])
        gaps = len(json.loads((ROOT / "instances/ultrastable/gaps.json").read_text())["gaps"])
        self.assertEqual(con.execute("select count(*) from items").fetchone()[0], issues + gaps)
        self.assertEqual(con.execute("select value from org where key='plus_share'").fetchone()[0], "0.2")
        self.assertGreaterEqual(con.execute("select count(*) from roles").fetchone()[0], 8)
        self.assertEqual(con.execute("select count(*) from trust_ledger").fetchone()[0], len(json.loads((ROOT / "instances/ultrastable/selfhost.json").read_text())["processes"]))
        self.assertEqual(con.execute("select status from items where id='SG-6'").fetchone()[0], "done")
        self.assertEqual(con.execute("select status from items where id='SG-1'").fetchone()[0], "open")
        self.assertIn("Open:", out["tick"]["report"])

    @unittest.skipUnless(shutil.which("node"), "node absent: the minimal path is the contract")
    def test_full_tick_with_the_seed_heartbeat(self):
        out = selfhost.boot(ROOT, self.db(), node=True)
        self.assertEqual((out["status"], out["path"]), ("ok", "seed-tick-node"))
        self.assertEqual((out["tick"]["completed"], out["tick"]["errors"]), (7, []))

    def test_refuses_to_boot_when_verifier_fails(self):
        r = copy_repo()
        (r / ".github/workflows/notify.yml").write_text("run: curl https://api.linear.app/graphql\n")
        out = selfhost.boot(r, self.db(), node=False)
        self.assertEqual(out["status"], "refused")

    def test_any_tools_minimal_path_needs_only_python(self):  # no node, no git, no network on PATH
        env = {"PATH": str(Path(sys.executable).parent), "HOME": str(scratch()), "PYTHONPATH": str(ROOT)}
        db = self.db()
        r = subprocess.run([sys.executable, "-m", "foundation", "selfhost", "--no-node", "--db", db], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Happened:", r.stdout)
        v = subprocess.run([sys.executable, "-m", "foundation", "selfhost", "--verify"], cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual((v.returncode, v.stdout.strip()), (0, "selfhost ok"))


class Doctrine(unittest.TestCase):
    def test_every_runbook_for_a_registered_adapter_exists_and_minimal_path_is_documented(self):
        reg = json.loads((ROOT / "platform/adapters/registry.json").read_text())
        self.assertTrue(all((ROOT / a["runbook"]).is_file() for a in reg["adapters"]))
        self.assertIn("--no-node", (ROOT / "docs/runbooks/any-tools/sqlite.md").read_text())

    def test_missing_self_hosting_line_fails_the_positioning_check(self):
        r = copy_repo()
        p = r / "README.md"
        p.write_text(p.read_text().replace("Ultrastable runs on itself", "x"))
        self.assertTrue(any("README.md" in b and "self-hosting" in b for b in doctrine.check(r)))

    def test_contradiction_fails_and_selfhost_findings_surface_in_the_doctrine_check(self):
        r = copy_repo()
        p = r / "docs/overview.md"
        p.write_text(p.read_text() + "\nUltrastable does not run on itself.\n")
        (r / ".github/workflows/notify.yml").write_text("run: curl https://hooks.slack.com/services/x\n")
        bad = doctrine.check(r)
        self.assertTrue(any("contradicts the self-hosting line" in b for b in bad))
        self.assertTrue(any(b.startswith("selfhost:") for b in bad))

    def test_public_copy_carries_the_line(self):
        for rel in ("site/worker.js", "external/overview.md", "README.md", "agents/AGENTS.md", "seed/agents/AGENTS.md"):
            self.assertIn("runs on itself", (ROOT / rel).read_text().lower(), rel)


if __name__ == "__main__":
    unittest.main()
