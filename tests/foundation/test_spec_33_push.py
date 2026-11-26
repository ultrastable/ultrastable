# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-33, the data writer a workflow uses instead of a direct push to main (MAIN-WRITER-1): what it sends, how it classifies a change, and which route
it takes when the Worker route cannot start. The git repository is a scratch one and every network call is replaced; nothing here reaches GitHub or the Worker."""
import base64, importlib.util, io, json, os, shutil, subprocess, sys, tempfile, unittest, urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("push_main_spec33", ROOT / "tools/push_main.py")
pm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pm)


def sh(cwd, *a):
    return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout


class Writer(unittest.TestCase):
    def repo(self):
        d = Path(tempfile.mkdtemp(prefix="ultrastable-test-spec33-push-"))
        self.addCleanup(shutil.rmtree, d, True)
        sh(d, "init", "-q", "-b", "main")
        (d / "ops").mkdir()
        (d / "ops/ledger.jsonl").write_text('{"n":1}\n', encoding="utf-8")
        (d / "ops/notes.json").write_text('{"a":1}\n', encoding="utf-8")
        (d / "gone.txt").write_text("bye\n", encoding="utf-8")
        sh(d, "add", "-A"); sh(d, "commit", "-qm", "base")
        return d

    def test_us_33_r81_the_main_writer_sends_appends_as_appends_content_as_content_and_deletes_as_deletes_in_commits_of_at_most_the_workers_cap_and_takes_its_second_route_only_when_nothing_landed(self):
        """US-33-R81"""
        d = self.repo()
        # a ledger that only grew is an append of the new tail; a rewritten ledger or any other file is whole content; a removed file is a delete
        (d / "ops/ledger.jsonl").write_text('{"n":1}\n{"n":2}\n', encoding="utf-8")
        (d / "ops/notes.json").write_text('{"a":2}\n', encoding="utf-8")
        (d / "gone.txt").unlink()
        (d / "new.log").write_text("first\n", encoding="utf-8")
        sh(d, "add", "-A"); sh(d, "commit", "-qm", "data")
        cwd = os.getcwd()
        os.chdir(d)
        try:
            got = {c["path"]: c for c in pm.changes()}
        finally:
            os.chdir(cwd)
        self.assertEqual(base64.b64decode(got["ops/ledger.jsonl"]["append"]), b'{"n":2}\n'); self.assertNotIn("content", got["ops/ledger.jsonl"], "concurrent writers never overwrite each other's lines")
        self.assertEqual(base64.b64decode(got["ops/notes.json"]["content"]), b'{"a":2}\n'); self.assertNotIn("append", got["ops/notes.json"], "only a ledger-shaped file (.jsonl, .ndjson, .log) is ever sent as an append")
        self.assertEqual(got["gone.txt"], {"path": "gone.txt", "delete": True})
        self.assertEqual(base64.b64decode(got["new.log"]["content"]), b"first\n", "a file with no earlier version is whole content, never an append")
        (d / "ops/ledger.jsonl").write_text('{"n":9}\n', encoding="utf-8"); sh(d, "add", "-A"); sh(d, "commit", "-qm", "rewrite")
        os.chdir(d)
        try:
            rewrite = {c["path"]: c for c in pm.changes()}
        finally:
            os.chdir(cwd)
        self.assertIn("content", rewrite["ops/ledger.jsonl"], "a ledger whose old bytes are no longer its prefix is content")
        # the cap is the Worker's own, so a big pass is consecutive commits and the Worker never answers 400
        self.assertIn(f"MAX_FILES = {pm.MAX_FILES};", (ROOT / "seed/worker/src/maincommit.js").read_text(encoding="utf-8"))
        # the message always carries [skip ci] so a data commit by the App does not start the deploy that started it
        sent = []
        with mock.patch.object(pm, "git", return_value=b"queue: verdicts"), mock.patch.object(pm, "changes", return_value=[{"path": f"a/{i}", "content": ""} for i in range(21)]), \
             mock.patch.object(pm, "post", side_effect=lambda m, f: sent.append((m, len(f))) or 0):
            self.assertEqual(pm.main(), 0)
        self.assertEqual(sent, [("queue: verdicts (part 1/2) [skip ci]", 20), ("queue: verdicts (part 2/2) [skip ci]", 1)])
        # the answers it retries are 409, 502 and 503 (four tries); any other HTTP answer ends the attempt; the body carries the message and the files
        calls = []
        def urlopen(req, timeout=0):
            calls.append(req)
            if len(calls) < 3:
                raise urllib.error.HTTPError(req.full_url, 503, "busy", {}, io.BytesIO(b"busy"))
            return io.BytesIO(json.dumps({"sha": "abc123"}).encode())
        with mock.patch.object(pm, "oidc", return_value="tok"), mock.patch.object(pm.time, "sleep"), mock.patch.object(pm.urllib.request, "urlopen", urlopen):
            self.assertEqual(pm.post("m [skip ci]", [{"path": "x", "content": ""}]), 0)
        self.assertEqual(len(calls), 3); self.assertEqual(json.loads(calls[0].data), {"message": "m [skip ci]", "files": [{"path": "x", "content": ""}]}); self.assertEqual(calls[0].get_header("Authorization"), "Bearer tok"); self.assertTrue(calls[0].get_header("User-agent"), "a named client: the edge refuses the default Python agent")
        calls.clear()
        def refuse(req, timeout=0):
            calls.append(req); raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, io.BytesIO(b"too many files"))
        with mock.patch.object(pm, "oidc", return_value="tok"), mock.patch.object(pm.time, "sleep"), mock.patch.object(pm.urllib.request, "urlopen", refuse):
            self.assertEqual(pm.post("m", []), 1); self.assertEqual(len(calls), 1, "a 400 is not retried")
        # the second route (a rebased direct push) runs when the first part did not land or the job has no identity token, and never after a part landed
        with mock.patch.object(pm, "git", return_value=b"m"), mock.patch.object(pm, "changes", return_value=[{"path": "a", "content": ""}]), mock.patch.object(pm, "post", return_value=1), mock.patch.object(pm, "fallback", return_value=77):
            self.assertEqual(pm.main(), 77)
        with mock.patch.object(pm, "git", return_value=b"m"), mock.patch.object(pm, "changes", return_value=[{"path": f"a/{i}", "content": ""} for i in range(21)]), mock.patch.object(pm, "post", side_effect=[0, 1]), mock.patch.object(pm, "fallback", return_value=77):
            self.assertEqual(pm.main(), 1, "part 1 is on main: a direct push would duplicate it")
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ACTIONS_ID_TOKEN_REQUEST_URL", None); os.environ.pop("ACTIONS_ID_TOKEN_REQUEST_TOKEN", None)
            with self.assertRaises(SystemExit) as raised:
                pm.oidc()
        self.assertIn("id-token: write", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
