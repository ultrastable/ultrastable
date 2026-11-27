# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import tempfile, unittest
from pathlib import Path

from foundation import ruleoftwo

REPO = Path(__file__).resolve().parents[2]
BAD = """on: {issue_comment: {types: [created]}}
permissions: {contents: write}
jobs:
  act:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ github.event.comment.body }}" | ./agent --key "${{ secrets.ANTHROPIC_API_KEY }}" && git push
"""
SPLIT = """on: {issue_comment: {types: [created]}}
permissions: {contents: read}
jobs:
  read:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${{ github.event.comment.body }}" > out.json
  write:
    runs-on: ubuntu-latest
    permissions: {contents: write}
    steps:
      - run: git push
"""


class RuleOfTwo(unittest.TestCase):
    def wf(self, text):
        d = Path(tempfile.mkdtemp())
        (d / ".github/workflows").mkdir(parents=True)
        (d / ".github/workflows/x.yml").write_text(text)
        return d

    def test_all_three_fails(self):
        self.assertEqual(len(ruleoftwo.check(self.wf(BAD))), 1)

    def test_split_jobs_pass(self):
        rows = ruleoftwo.jobs(self.wf(SPLIT))
        self.assertEqual(ruleoftwo.check(self.wf(SPLIT)), [])
        self.assertEqual([(r["untrusted"], r["sensitive"]) for r in rows], [(True, False), (True, False)])

    def test_a_job_the_untrusted_event_cannot_start_is_not_untrusted(self):
        job = ("jobs:\n  act:\n    if: ${{ github.event_name != 'issue_comment' }}\n    runs-on: ubuntu-latest\n    steps:\n"
               "      - run: ./sweep --key \"${{ secrets.LANE_PAT }}\" && git push\n")
        head = "on: {issue_comment: {}, schedule: [{cron: '1 1 * * *'}]}\npermissions: {contents: write}\n"
        self.assertEqual(ruleoftwo.check(self.wf(head + job)), [])
        self.assertEqual(len(ruleoftwo.check(self.wf(head + job.replace("    if: ${{ github.event_name != 'issue_comment' }}\n", "")))), 1)

    def test_github_token_is_not_a_secret(self):
        self.assertFalse(ruleoftwo.SECRET.search("${{ secrets.GITHUB_TOKEN }}"))

    def test_repo_passes(self):
        self.assertEqual(ruleoftwo.check(REPO), [])


if __name__ == "__main__":
    unittest.main()
