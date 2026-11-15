"""PUBLICATION-1: policy is data with proofs; each repo is flipped only on its own clean audit; unmeasured is never clean."""
import json, subprocess, unittest
from pathlib import Path
from unittest import mock
from foundation import publication
from _repo import ROOT, copy_repo, scratch

FAKE = "ghp_" + "Z" * 36  # built at run time so no token-shaped literal sits in this file


def _clean(vis="private"):
    return {"history": {"state": "clean", "hits": 0}, "text": {"state": "clean", "objects": 0, "hits": 0},
            "settings": {"state": "read", "visibility": vis, "unprotected": []}, "required_missing": [], "tripwires": [], "clean": True}


def _org(**over):
    d = publication.load(ROOT)
    o = {r: _clean() for r in d["repos"]}
    o.update(over)
    return o


def _repo_with(path, text):
    """A real git repo whose history holds `text` at `path`, then loses it from the tree."""
    r = Path(scratch())
    g = lambda *a: subprocess.run(["git", "-C", str(r), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *a], capture_output=True, text=True, check=True)
    g("init", "-q")
    (r / path).parent.mkdir(parents=True, exist_ok=True)
    (r / path).write_text(text, encoding="utf-8")
    g("add", "-A"); g("commit", "-q", "-m", "add")
    (r / path).write_text("gone\n", encoding="utf-8")
    g("add", "-A"); g("commit", "-q", "-m", "remove")
    return r


class Publication(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(publication.check(ROOT), [])

    def test_missing_lesson_probe_fails(self):
        r = copy_repo()
        p = Path(r) / publication.PATH
        d = json.loads(p.read_text(encoding="utf-8"))
        d["lessons"][0]["probe"] = "grep:foundation/publication.py::no_such_text_xyz"
        p.write_text(json.dumps(d), encoding="utf-8")
        self.assertTrue(any("probe fails" in e for e in publication.check(r)))

    def test_allow_entry_without_reason_fails_check(self):
        r = copy_repo()
        p = Path(r) / publication.PATH
        d = json.loads(p.read_text(encoding="utf-8"))
        d["history_allow"].append({"path": "x.py", "sha256": "0" * 64})
        p.write_text(json.dumps(d), encoding="utf-8")
        self.assertTrue(any("history_allow" in e for e in publication.check(r)))

    def test_history_finds_a_secret_removed_from_the_tree(self):
        d = publication.load(ROOT)
        h = publication.history(_repo_with("src/a.py", f"k = '{FAKE}'\n"), d)
        self.assertEqual((h["state"], h["hits"]), ("dirty", 1))
        self.assertNotIn(FAKE, json.dumps(h))  # reported by hash, never by value

    def test_history_allow_is_exact(self):
        d = dict(publication.load(ROOT))
        r = _repo_with("src/a.py", f"k = '{FAKE}'\n")
        d["history_allow"] = [{"path": "src/a.py", "sha256": publication._sha(FAKE), "reason": "fixture"}]
        self.assertEqual(publication.history(r, d)["state"], "clean")
        d["history_allow"] = [{"path": "src/other.py", "sha256": publication._sha(FAKE), "reason": "fixture"}]
        self.assertEqual(publication.history(r, d)["state"], "dirty")

    def test_repo_audit_reports_missing_files_and_tripwires(self):
        d = publication.load(ROOT)
        r = _repo_with("ip/claim.md", "x\n")
        run = lambda cmd, **k: mock.Mock(returncode=0, stdout=json.dumps({"visibility": "private"}) if "--paginate" not in cmd else "[[]]")
        a = publication.repo_audit(ROOT, d, "somerepo", r, run)
        self.assertIn("LICENSE", a["required_missing"])
        self.assertEqual(a["tripwires"], ["ip/"])
        self.assertFalse(a["clean"])

    def test_text_surface_hit_is_dirty_and_unreadable_is_unmeasured(self):
        d = publication.load(ROOT)
        page = json.dumps([[{"title": "t", "body": f"token {FAKE}", "html_url": "u"}]])
        self.assertEqual(publication.text_surfaces(d, "r", lambda cmd, **k: mock.Mock(returncode=0, stdout=page))["state"], "dirty")
        self.assertEqual(publication.text_surfaces(d, "r", lambda cmd, **k: mock.Mock(returncode=1, stdout=""))["state"], "unmeasured")

    def test_public_repo_without_push_protection_is_not_clean(self):
        d = publication.load(ROOT)
        j = json.dumps({"visibility": "public", "security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "disabled"}}})
        s = publication.settings(d, "r", lambda cmd, **k: mock.Mock(returncode=0, stdout=j))
        self.assertEqual(s["unprotected"], ["secret_scanning_push_protection"])
        self.assertFalse(publication.repo_clean({**_clean("public"), "settings": s}))

    def test_unmirrorable_repo_is_unmeasured_never_clean(self):
        o = publication.org_audit(ROOT, workdir=scratch(), mirror=lambda *a, **k: False)
        self.assertTrue(o and all(not v["clean"] and v["history"]["state"] == "unmeasured" for v in o.values()))

    def test_flip_refuses_only_the_repo_that_is_not_clean(self):
        dirty = {**_clean(), "tripwires": ["ip/"], "clean": False}
        seen = []
        run = lambda cmd, **k: seen.append(cmd) or mock.Mock(returncode=0)
        with mock.patch.object(publication, "org_audit", return_value=_org(workers=dirty)), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {"GH_TOKEN": "x"}):
            self.assertEqual(publication.flip(ROOT, apply=True, run=run, verify=lambda d, r: True), 2)
        flipped = [c[3] for c in seen if c[:3] == ["gh", "repo", "edit"]]
        self.assertNotIn("ultrastable/workers", flipped)
        self.assertEqual(len(flipped), len(publication.load(ROOT)["repos"]) - 1)

    def test_flip_without_credential_changes_nothing(self):
        calls = []
        with mock.patch.object(publication, "org_audit", return_value=_org()), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(publication.flip(ROOT, apply=True, run=lambda *a, **k: calls.append(a)), 3)
        self.assertEqual(calls, [])

    def test_flip_runs_in_order_skips_public_and_protects(self):
        seen = []
        run = lambda cmd, **k: seen.append(cmd) or mock.Mock(returncode=0)
        with mock.patch.object(publication, "org_audit", return_value=_org(ultrastable=_clean("public"))), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {"GH_TOKEN": "x"}):
            self.assertEqual(publication.flip(ROOT, apply=True, run=run, verify=lambda d, r: True), 0)
        order = [r for r in publication.load(ROOT)["flip_order"] if r != "ultrastable"]
        self.assertEqual([c[3] for c in seen if c[:3] == ["gh", "repo", "edit"]], [f"ultrastable/{r}" for r in order])
        self.assertEqual(len([c for c in seen if c[:2] == ["gh", "api"]]), len(order))

    def test_flip_that_cannot_be_verified_stops(self):
        run = lambda cmd, **k: mock.Mock(returncode=0)
        with mock.patch.object(publication, "org_audit", return_value=_org()), mock.patch.object(publication, "_log"), mock.patch.dict("os.environ", {"GH_TOKEN": "x"}):
            self.assertEqual(publication.flip(ROOT, apply=True, run=run, verify=lambda d, r: False), 1)


if __name__ == "__main__":
    unittest.main()
