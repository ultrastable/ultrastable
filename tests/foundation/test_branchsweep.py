"""BRANCH-SWEEP-1: every remote branch gets one recorded disposition; generated-file conflicts resolve, code conflicts become PORT items, rejected branches are never merged."""
import json, subprocess, sys, tempfile, unittest, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import branchsweep as B  # noqa: E402


def sh(cwd, *a):
    subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True)


def write(d, rel, text):
    p = Path(d) / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(text, encoding="utf-8")


class Sweep(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ultrastable-test-bs-")); self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.w = self.tmp / "o.git", self.tmp / "w"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)], check=True)
        subprocess.run(["git", "clone", "-q", str(self.origin), str(self.w)], check=True, capture_output=True)
        for k, v in (("user.email", "t@t"), ("user.name", "t")):
            sh(self.w, "config", k, v)
        write(self.w, "doctrine/branchsweep.json", json.dumps({"state_branches": ["evidence"], "state_prefixes": [], "gate": [], "min_idle_hours": 0, "port_owner": "operations", "rejected": {"bad": "closed on purpose"}}))
        write(self.w, "doctrine/decision-ledger.json", json.dumps({"rows": [{"id": "a"}]}))
        write(self.w, "ops/x.jsonl", '{"n":1}\n'); write(self.w, "code.py", "x = 1\n")
        sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "base"); sh(self.w, "push", "-q", "origin", "main")

    def branch(self, name, files, base="main"):
        sh(self.w, "checkout", "-q", "-B", name, "origin/" + base)
        for rel, text in files.items():
            write(self.w, rel, text)
        sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", name); sh(self.w, "push", "-q", "origin", name); sh(self.w, "checkout", "-q", "main")

    def advance(self, files):
        sh(self.w, "checkout", "-q", "main")
        for rel, text in files.items():
            write(self.w, rel, text)
        sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "adv"); sh(self.w, "push", "-q", "origin", "main")

    def test_dispositions_and_invariant(self):
        self.branch("clean", {"new.py": "y = 2\n"})
        self.branch("gen", {"doctrine/decision-ledger.json": json.dumps({"rows": [{"id": "a"}, {"id": "b"}]}), "ops/x.jsonl": '{"n":1}\n{"n":2}\n'})
        self.branch("codeconf", {"code.py": "x = 2\n"})
        self.branch("bad", {"bad.py": "z = 1\n"}); self.branch("evidence", {"e.txt": "e\n"})
        self.advance({"doctrine/decision-ledger.json": json.dumps({"rows": [{"id": "a"}, {"id": "m"}]}), "ops/x.jsonl": '{"n":1}\n{"n":3}\n', "code.py": "x = 3\n"})
        sh(self.w, "fetch", "-q", "origin")
        got = {p["name"]: p["action"] for p in B.scan(self.w)}
        self.assertEqual(got, {"clean": "merge", "gen": "merge", "codeconf": "port", "bad": "rejected", "evidence": "state"})
        sh(self.w, "checkout", "-q", "-B", "sweep", "origin/main")
        rec = B.apply(self.w)
        self.assertTrue(rec["invariant"], rec)
        acts = {d["name"]: d["action"] for d in rec["dispositions"]}
        self.assertEqual(acts["clean"], "merge"); self.assertEqual(acts["gen"], "merge"); self.assertEqual(acts["codeconf"], "port")
        self.assertTrue((self.w / "new.py").is_file())
        ids = {r["id"] for r in json.loads((self.w / "doctrine/decision-ledger.json").read_text())["rows"]}
        self.assertEqual(ids, {"a", "b", "m"}, "ledger rows are a union by id")
        self.assertEqual({json.loads(l)["n"] for l in (self.w / "ops/x.jsonl").read_text().split()}, {1, 2, 3})
        self.assertFalse((self.w / "bad.py").exists(), "a rejected branch is never merged")
        item = json.loads((self.w / "docs/issues/PORT-BRANCH-codeconf.json").read_text())
        self.assertIn("Closing probe", item["body"]); self.assertIn("**Owner:** operations", item["body"])
        self.assertEqual((self.w / "code.py").read_text(), "x = 3\n", "a code conflict leaves main's file untouched")

    def test_time_budget_defers_merges_instead_of_losing_the_run(self):
        self.branch("one", {"one.py": "1"}); self.branch("two", {"two.py": "2"}); sh(self.w, "fetch", "-q", "origin")
        pol = json.loads((self.w / "doctrine/branchsweep.json").read_text()); pol["max_seconds"] = -1
        write(self.w, "doctrine/branchsweep.json", json.dumps(pol)); sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "budget")
        rec = B.apply(self.w)
        acts = {d["name"]: d for d in rec["dispositions"]}
        self.assertEqual({acts["one"]["action"], acts["two"]["action"]}, {"skipped"})
        self.assertIn("time budget", acts["one"]["why"]); self.assertTrue(rec["invariant"], rec)
        self.assertFalse((self.w / "one.py").exists(), "a deferred branch is not merged and not dropped")

    def test_failing_gate_undoes_the_merge_and_files_a_port_item(self):
        self.branch("breaks", {"new.py": "y = 2\n"}); sh(self.w, "fetch", "-q", "origin")
        pol = json.loads((self.w / "doctrine/branchsweep.json").read_text()); pol["gate"] = [[sys.executable, "-c", "import sys; sys.exit(3)"]]
        write(self.w, "doctrine/branchsweep.json", json.dumps(pol)); sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "gate")
        rec = B.apply(self.w)
        self.assertEqual({d["name"]: d["action"] for d in rec["dispositions"]}["breaks"], "port")
        self.assertFalse((self.w / "new.py").exists()); self.assertTrue((self.w / "docs/issues/PORT-BRANCH-breaks.json").is_file())

    def test_a_branch_a_session_just_touched_is_live_and_a_residue_only_branch_is_superseded(self):
        self.branch("fresh", {"f.py": "f\n"})
        pol = json.loads((self.w / "doctrine/branchsweep.json").read_text()); pol["min_idle_hours"] = 4
        write(self.w, "doctrine/branchsweep.json", json.dumps(pol)); sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "p"); sh(self.w, "push", "-q", "origin", "main")
        sh(self.w, "fetch", "-q", "origin")
        self.assertEqual({p["name"]: p["action"] for p in B.scan(self.w)}["fresh"], "live")
        pol["min_idle_hours"] = 0
        write(self.w, "doctrine/branchsweep.json", json.dumps(pol)); sh(self.w, "add", "-A"); sh(self.w, "commit", "-qm", "p0")
        rec = B.apply(self.w)
        self.assertTrue(rec["invariant"], rec)

    def test_prune_deletes_only_what_main_already_holds(self):
        self.branch("done", {"new.py": "y = 2\n"}); sh(self.w, "checkout", "-q", "main"); sh(self.w, "merge", "-q", "--no-ff", "origin/done", "-m", "m"); sh(self.w, "push", "-q", "origin", "main")
        self.branch("pending", {"other.py": "q\n"}); sh(self.w, "fetch", "-q", "origin")
        gone = {d["name"] for d in B.prune(self.w)}
        self.assertEqual(gone, {"done"})

    def test_repo_policy_is_valid(self):
        self.assertEqual(B.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()


class RemoteSweep(unittest.TestCase):
    """BRANCH-SWEEP-2: stale session branches of every fleet repository are pruned by API; unmerged work is never deleted."""
    def test_deletes_only_held_or_merged_heads_and_records_every_sha(self):
        calls = []
        def fetch(method, url, headers):
            calls.append((method, url)); p = url.replace("https://api.github.com", "")
            if p == "/repos/o/a": return 200, {"default_branch": "main"}
            if p == "/repos/o/gone": return 404, None
            if p.startswith("/repos/o/a/branches"): return 200, [{"name": "main", "commit": {"sha": "m"}}, {"name": "claude/held", "commit": {"sha": "h1"}},
                {"name": "claude/squashed", "commit": {"sha": "s1"}}, {"name": "agent/work", "commit": {"sha": "w1"}}, {"name": "release", "commit": {"sha": "r"}}]
            if p == "/repos/o/a/compare/main...claude/held": return 200, {"ahead_by": 0}
            if p.startswith("/repos/o/a/compare/"): return 200, {"ahead_by": 3}
            if "head=o:claude/squashed" in p: return 200, [{"number": 9, "state": "closed", "merged_at": "x", "head": {"sha": "s1"}}]
            if "head=o:agent/work" in p: return 200, [{"number": 10, "state": "open", "merged_at": None, "head": {"sha": "w1"}}]
            if method == "DELETE": return 204, None
            return 404, None
        tmp = Path(tempfile.mkdtemp(prefix="ultrastable-test-bs2-")); self.addCleanup(shutil.rmtree, tmp, True)
        out = B.remote_prune(["o/a", "o/gone"], "t", fetch=fetch, root=tmp, now=1)
        a = {r["name"]: r for r in out["remote"][0]["branches"]}
        self.assertEqual(a["claude/held"]["action"], "deleted"); self.assertEqual(a["claude/squashed"]["action"], "deleted")
        self.assertEqual(a["agent/work"]["action"], "kept"); self.assertNotIn("release", a)
        self.assertEqual(out["remote"][1], {"repo": "o/gone", "unreadable": 404})
        self.assertEqual(sorted(u for m, u in calls if m == "DELETE"), ["https://api.github.com/repos/o/a/git/refs/heads/claude/held", "https://api.github.com/repos/o/a/git/refs/heads/claude/squashed"])
        ledger = (tmp / B.LEDGER).read_text().strip().splitlines()
        self.assertIn('"sha": "s1"', ledger[-1])

    def test_policy_lists_the_fleet(self):
        self.assertIn("ultrastable/practical-solutions", B.policy().get("fleet_repos", []))
