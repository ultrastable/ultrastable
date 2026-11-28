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

    def test_a_work_record_done_when_line_is_a_probe_and_a_404_is_a_fail_not_a_pass(self):
        # WORK-RECORD-1 records say `Done when: GET <url> and <path> answer 200`; it used to read as no probe at all, so the record was never closed or counted
        body = "**Goal:** x\n\n**Done when:** GET https://a.io/base/ and /other/ answer 200\n\n**Next step:** y"
        self.assertEqual(il.parse_probe(body), ("status", ["https://a.io/base/", "https://a.io/other/"], 200))
        iss = {"body": body}
        self.assertEqual(il.evaluate("o/r", iss, status=lambda u: 404)[0], "fail")
        self.assertEqual(il.evaluate("o/r", iss, status=lambda u: 200 if u.endswith("/base/") else 404)[0], "fail")  # every url must answer
        self.assertEqual(il.evaluate("o/r", iss, status=lambda u: 200)[0], "pass")
        def boom(u): raise OSError("down")
        self.assertEqual(il.evaluate("o/r", iss, status=boom)[0], "unmeasured")

    def test_a_work_record_with_the_queue_label_is_still_probed_a_mirrored_item_is_not(self):
        lab = lambda *n: {"labels": [{"name": x} for x in n]}
        self.assertFalse(il.probeable(lab("queue")))  # mirrors a docs/issues file: the queue loop owns it
        self.assertTrue(il.probeable(lab("queue", "work", "resume")))  # `worklog reap` adds `queue`; there is no file behind a work record
        self.assertTrue(il.probeable(lab("p2")))
        self.assertFalse(il.probeable({**lab("p2"), "pull_request": {}}))

    def test_the_sla_clock_ages_a_work_record_but_not_a_mirrored_queue_item_or_a_held_one(self):
        import re
        src = (il.REPO / "scripts/sla.sh").read_text()
        m = re.search(r'(  case "\$l" in \*,hold.*?\n)(?:  #.*?\n)*(  case "\$l" in \*,work,\*\).*?\n)', src, re.S)
        self.assertTrue(m, "the issue loop of scripts/sla.sh lost its skip rules")
        def skipped(*labels):
            script = f'l=",{",".join(labels)},"\nfor _ in 1; do\n{m.group(1)}{m.group(2)}  echo kept\ndone\n'
            return subprocess.run(["bash", "-c", script], capture_output=True, text=True).stdout.strip() != "kept"
        self.assertTrue(skipped("p2", "queue"))
        self.assertFalse(skipped("p2", "queue", "work", "resume"))
        self.assertTrue(skipped("p2", "queue", "work", "hold"))
        self.assertFalse(skipped("p2"))

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
