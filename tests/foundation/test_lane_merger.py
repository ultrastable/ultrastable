"""NEEDS-PAT-1: the lane workflow is the server-side merger for pull requests that change workflow files. It merges them on green, on the
exact head commit, with a workflow-capable credential; it skips `hold`; with no credential it leaves them open and says so."""
import json, os, shutil, stat, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import lane_credential  # noqa: E402

FAKE_GH = r'''#!/usr/bin/env python3
"""A stand-in for the gh CLI: answers from a JSON state file and logs every call with the token it was given."""
import json, os, subprocess, sys
a = sys.argv[1:]
state = json.load(open(os.environ["FAKE_GH_STATE"]))
with open(os.environ["FAKE_GH_LOG"], "a") as f:
    f.write(json.dumps({"argv": a, "token": os.environ.get("GH_TOKEN", "")}) + "\n")

def out(value):
    if "--jq" in a:
        r = subprocess.run(["jq", "-r", a[a.index("--jq") + 1]], input=json.dumps(value), capture_output=True, text=True)
        sys.stdout.write(r.stdout); sys.exit(r.returncode)
    print(json.dumps(value)); sys.exit(0)

if a[:1] == ["issue"]:
    if not state.get("has_issues", True):
        print("the 'o/r' repository has disabled issues", file=sys.stderr); sys.exit(1)
    out([])
if a[:1] == ["api"] and a[1] == "repos/o/r":
    out({"has_issues": state.get("has_issues", True)})
if a[:1] == ["api"] and a[1].endswith("/branches"):
    out([])
if a[:2] == ["pr", "list"]:
    out([{"number": int(n), "updatedAt": "2026-11-12T00:00:00Z"} for n in state["prs"]])
if a[:2] == ["pr", "view"]:
    out(state["prs"][a[2]])
if a[:1] == ["api"] and "/check-runs" in a[1]:
    sha = a[1].split("/commits/")[1].split("/")[0]
    out({"check_runs": state["checks"].get(sha, [])})
if a[:2] == ["pr", "merge"]:
    pr = state["prs"][a[2]]
    touches = any(f["path"].startswith(".github/workflows/") for f in pr.get("files", []))
    if touches and os.environ.get("GH_TOKEN") != state["workflow_token"]:
        print("refusing to allow a GitHub App to create or update workflow `.github/workflows/x.yml` without `workflows` permission"); sys.exit(1)
    sys.exit(0)
sys.exit(0)
'''
GREEN = [{"name": "checks", "status": "completed", "conclusion": "success"}]


def pr(sha, *, labels=(), files=("README.md",), draft=False):
    return {"isDraft": draft, "headRefName": "b-" + sha, "headRefOid": sha, "labels": [{"name": n} for n in labels], "mergeable": "MERGEABLE",
            "updatedAt": "2026-11-12T00:00:00Z", "files": [{"path": p} for p in files]}


@unittest.skipUnless(shutil.which("bash") and shutil.which("jq"), "the lane script needs bash and jq (both are on the Actions runner)")
class LaneMergesNeedsPat(unittest.TestCase):
    PAT = "pat-value-for-the-test"

    def test_completion_sweep_is_green_when_issues_are_off_on_the_repository(self):
        """Issues are off here (items are docs/issues). The sweep used to call `gh issue` anyway and failed the daily lane run every time."""
        r, calls = self.run_lane({}, {}, script="completion_sweep.sh", has_issues=False)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([c for c in calls if c["argv"][:1] == ["issue"]], [])
        self.assertIn("done_issues=off", r.stdout)
        r, calls = self.run_lane({}, {}, script="completion_sweep.sh", has_issues=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue([c for c in calls if c["argv"][:2] == ["issue", "list"]])

    def run_lane(self, prs, checks, script="lane.sh", has_issues=True, **env):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        gh = d / "bin" / "gh"; gh.parent.mkdir()
        gh.write_text(FAKE_GH); gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        (d / "state.json").write_text(json.dumps({"prs": prs, "checks": checks, "workflow_token": self.PAT, "has_issues": has_issues}))
        (d / "log.jsonl").write_text("")
        e = {"PATH": f"{gh.parent}:{os.environ['PATH']}", "GITHUB_REPOSITORY": "o/r", "GH_TOKEN": "builtin", "FAKE_GH_STATE": str(d / "state.json"),
             "FAKE_GH_LOG": str(d / "log.jsonl"), "HOME": str(d), **env}
        r = subprocess.run(["bash", str(ROOT / "scripts" / script)], env=e, capture_output=True, text=True, timeout=120, cwd=d)
        calls = [json.loads(l) for l in (d / "log.jsonl").read_text().splitlines()]
        return r, calls

    @staticmethod
    def merges(calls):
        return {c["argv"][2]: c for c in calls if c["argv"][:2] == ["pr", "merge"]}

    def test_without_a_credential_the_workflow_pr_waits_and_everything_else_merges(self):
        prs = {"1": pr("aaa1111", files=(".github/workflows/lane.yml", "x.py")), "2": pr("bbb2222")}
        r, calls = self.run_lane(prs, {"aaa1111": GREEN, "bbb2222": GREEN})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)          # a recorded default is not a degraded run
        m = self.merges(calls)
        self.assertNotIn("1", m)                                         # no attempt, so no refusal to work around
        self.assertEqual(m["2"]["token"], "builtin")
        self.assertTrue(any(c["argv"][:3] == ["pr", "edit", "1"] and "needs-pat" in c["argv"] for c in calls))
        self.assertIn("lane: workflow credential: none", r.stdout)
        self.assertIn("#1 needs-pat: green on aaa1111, not merged", r.stdout)
        self.assertIn("lane: needs-pat merged=0 waiting=1 credential=none", r.stdout)

    def test_with_lane_pat_the_workflow_pr_merges_on_green_at_its_head_commit(self):
        prs = {"1": pr("aaa1111", labels=("needs-pat",), files=(".github/workflows/lane.yml",)), "2": pr("bbb2222")}
        r, calls = self.run_lane(prs, {"aaa1111": GREEN, "bbb2222": GREEN}, LANE_PAT=self.PAT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        m = self.merges(calls)
        self.assertEqual(m["1"]["token"], self.PAT)
        a = m["1"]["argv"]
        self.assertEqual(a[a.index("--match-head-commit") + 1], "aaa1111")
        self.assertIn("--squash", a)
        self.assertEqual(m["2"]["token"], "builtin")                     # the credential is used only where it is needed
        self.assertIn("#1 merged (needs-pat, with the lane-pat credential, head aaa1111)", r.stdout)
        self.assertIn("lane: needs-pat merged=1 waiting=0 credential=lane-pat", r.stdout)
        self.assertNotIn(self.PAT, r.stdout + r.stderr)                  # the token is never printed

    def test_hold_is_skipped_even_with_a_credential(self):
        prs = {"1": pr("aaa1111", labels=("needs-pat", "hold"), files=(".github/workflows/lane.yml",))}
        r, calls = self.run_lane(prs, {"aaa1111": GREEN}, LANE_PAT=self.PAT)
        self.assertEqual(self.merges(calls), {})
        self.assertIn("#1 hold", r.stdout)

    def test_not_green_is_not_merged_even_with_a_credential(self):
        prs = {"1": pr("aaa1111", labels=("needs-pat",), files=(".github/workflows/lane.yml",)), "2": pr("ccc3333", labels=("needs-pat",))}
        checks = {"aaa1111": [{"name": "checks", "status": "completed", "conclusion": "failure"}], "ccc3333": [{"name": "checks", "status": "in_progress", "conclusion": None}]}
        r, calls = self.run_lane(prs, checks, LANE_PAT=self.PAT)
        self.assertEqual(self.merges(calls), {})
        self.assertIn("#1 ci-failed", r.stdout); self.assertIn("#2 pending", r.stdout)

    def test_a_labeled_pr_is_treated_as_needing_the_credential_whatever_its_file_list_says(self):
        r, calls = self.run_lane({"1": pr("aaa1111", labels=("needs-pat",))}, {"aaa1111": GREEN})
        self.assertEqual(self.merges(calls), {})
        self.assertIn("waiting=1", r.stdout)


class Credential(unittest.TestCase):
    def test_source_prefers_the_token_then_the_app_then_none(self):
        self.assertEqual(lane_credential.source({}), "none")
        self.assertEqual(lane_credential.source({"LANE_APP_ID": "1"}), "none")            # half an App is no credential
        self.assertEqual(lane_credential.source({"LANE_APP_ID": "1", "LANE_APP_PRIVATE_KEY": "k"}), "github-app")
        self.assertEqual(lane_credential.source({"LANE_PAT": "p", "LANE_APP_ID": "1", "LANE_APP_PRIVATE_KEY": "k"}), "lane-pat")

    def test_source_command_prints_no_secret(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/lane_credential.py"), "source"], env={"PATH": os.environ["PATH"], "LANE_PAT": "s3cret-value"}, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "lane-pat"))
        self.assertNotIn("s3cret-value", r.stdout + r.stderr)

    def test_token_without_a_credential_fails_and_prints_nothing_on_stdout(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts/lane_credential.py"), "token"], env={"PATH": os.environ["PATH"]}, capture_output=True, text=True)
        self.assertEqual((r.returncode, r.stdout), (1, ""))
        self.assertIn("no workflow-capable credential is bound", r.stderr)

    @unittest.skipUnless(shutil.which("openssl"), "needs openssl (on the Actions runner)")
    def test_app_route_signs_a_jwt_and_asks_for_a_repo_scoped_workflows_token(self):
        with tempfile.TemporaryDirectory() as d:
            key = subprocess.run(["openssl", "genrsa", "2048"], capture_output=True, text=True, check=True).stdout
            jwt = lane_credential.app_jwt("12345", key, now=1_800_000_000)
            head, body, sig = jwt.split(".")
            pad = lambda s: s + "=" * (-len(s) % 4)
            import base64
            self.assertEqual(json.loads(base64.urlsafe_b64decode(pad(body))), {"iat": 1_800_000_000 - 60, "exp": 1_800_000_000 + 540, "iss": "12345"})
            (Path(d) / "in").write_text(f"{head}.{body}"); (Path(d) / "sig").write_bytes(base64.urlsafe_b64decode(pad(sig)))
            pub = subprocess.run(["openssl", "rsa", "-pubout"], input=key, capture_output=True, text=True, check=True).stdout
            (Path(d) / "pub.pem").write_text(pub)
            v = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(Path(d) / "pub.pem"), "-signature", str(Path(d) / "sig"), str(Path(d) / "in")], capture_output=True, text=True)
            self.assertIn("Verified OK", v.stdout)
            seen = []

            def http(method, path, bearer, body=None):
                seen.append((method, path, body))
                return (200, {"id": 77}) if method == "GET" else (201, {"token": "installation-token"})
            env = {"GITHUB_REPOSITORY": "ultrastable/ultrastable", "LANE_APP_ID": "12345", "LANE_APP_PRIVATE_KEY": key}
            self.assertEqual(lane_credential.token(env, http), "installation-token")
            self.assertEqual(seen[0][:2], ("GET", "/repos/ultrastable/ultrastable/installation"))
            self.assertEqual(seen[1], ("POST", "/app/installations/77/access_tokens", {"repositories": ["ultrastable"], "permissions": {"contents": "write", "pull_requests": "write", "workflows": "write"}}))
            with self.assertRaises(RuntimeError):
                lane_credential.token(env, lambda *a, **k: (404, {"message": "Not Found"}))
            # TENANT-REPO-1: the org token asks for administration and contents over the whole installation, and a refusal raises
            seen.clear()
            self.assertEqual(lane_credential.org_token(env, http), "installation-token")
            self.assertEqual(seen[1], ("POST", "/app/installations/77/access_tokens", {"permissions": {"administration": "write", "contents": "write"}}))
            with self.assertRaises(RuntimeError):
                lane_credential.org_token(env, lambda m, *a, **k: (200, {"id": 77}) if m == "GET" else (403, {"message": "denied"}))

    def test_the_owner_step_is_recorded_once_with_a_default(self):
        d = json.loads((ROOT / "foundation/data/needs-you.json").read_text(encoding="utf-8"))
        items = [i for i in d["items"] if i["id"] == "lane-credential"]
        if items:  # still open: one consent click on GitHub with its default, never a token to mint (POINT-AND-CLICK-1)
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["class"], "owner_account")
            self.assertIn("needs-pat", items[0]["default"])
        else:  # GATE-SETTLE-2: settled on its own evidence, recorded once
            self.assertEqual(sum(x.startswith("Connect GitHub: settled") for x in d["done_for_you"]), 1)
        wf = (ROOT / ".github/workflows/lane.yml").read_text()
        for name in ("LANE_PAT", "LANE_APP_ID", "LANE_APP_PRIVATE_KEY"):
            self.assertIn("secrets." + name, wf)


if __name__ == "__main__":
    unittest.main()
