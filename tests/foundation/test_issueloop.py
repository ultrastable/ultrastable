# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import subprocess, sys, unittest
from foundation import issueloop as il


class IssueLoop(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(il.parse_probe("x\nprobe: npm test"), None)
        self.assertEqual(il.parse_probe("**Closing probe:** `file:LICENSE`")[1], "file:LICENSE")
        self.assertEqual(il.parse_probe('Closing probe: GET https://a.io/x expect "ok"')[:3], ("get", "https://a.io/x", "ok"))

    def test_verdicts(self):
        iss = {"body": 'Closing probe: GET https://a.io/x expect "ok"'}
        self.assertEqual(il.evaluate("o/r", iss, fetch=lambda u: "all ok")[0], "pass")
        self.assertEqual(il.evaluate("o/r", iss, fetch=lambda u: "no")[0], "fail")
        def boom(u): raise OSError("down")
        self.assertEqual(il.evaluate("o/r", iss, fetch=boom)[0], "unmeasured")
        self.assertEqual(il.evaluate("o/r", {"body": "nothing"})[0], "unprobed")
        self.assertEqual(il.evaluate("o/r", {"body": "probe: file:LICENSE"})[0], "unmeasured")
        self.assertEqual(il.evaluate(il.THIS, {"body": "probe: file:LICENSE"})[0], "pass")

    def test_run_closes_only_passing(self):
        closed = []
        res = il.run(apply=True, issues=lambda r: [{"number": 1, "body": "probe: file:LICENSE"}, {"number": 2, "body": "probe: file:NOPE"}] if r == il.THIS else [],
                     closer=lambda r, n, e: closed.append(n) or True)
        self.assertEqual(closed, [1])
        self.assertEqual([r["closed"] for r in res["rows"]], [True, False])

    def test_cli_registered(self):
        r = subprocess.run([sys.executable, "-m", "foundation", "issueloop", "--help-unknown"], capture_output=True, text=True)
        self.assertNotIn("invalid choice", r.stderr)

    def test_metrics(self):
        m = il.metrics({"rows": [{"verdict": "unprobed", "closed": False}, {"verdict": "pass", "closed": True}], "unreadable": ["x"]})
        self.assertEqual((m["unprobed"], m["closed"], m["unreadable_repos"]), (1, 1, 1))

    def test_file_items(self):
        import tempfile, pathlib
        with tempfile.TemporaryDirectory() as d:
            got = il.file_items(d, {"rows": [{"repo": "o/r", "number": 7, "title": "t", "verdict": "unprobed", "evidence": "x"},
                                             {"repo": "o/r", "number": 8, "title": "t", "verdict": "pass", "evidence": "x"}]})
            self.assertEqual(got, ["Q-ISSUE-r-7"])
            self.assertIn("issueloop --closed o/r#7", (pathlib.Path(d) / "docs/issues/Q-ISSUE-r-7.json").read_text())
