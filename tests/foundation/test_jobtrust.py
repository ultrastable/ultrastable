# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import tempfile, unittest
from pathlib import Path
from foundation import jobtrust

WF = """name: x
on: issues
jobs:
  bad:
    runs-on: ubuntu-latest
    permissions: {contents: write}
    steps:
      - run: echo ${{ github.event.issue.body }}
        env: {K: "${{ secrets.TOKEN }}"}
  ok:
    runs-on: ubuntu-latest
    permissions: {contents: read}
    steps:
      - run: echo ${{ github.event.issue.body }}
        env: {K: "${{ secrets.TOKEN }}"}
"""

class JobTrust(unittest.TestCase):
    def test_flags_only_the_job_holding_all_three(self):
        with tempfile.TemporaryDirectory() as d:
            w = Path(d) / ".github" / "workflows"; w.mkdir(parents=True); (w / "x.yml").write_text(WF)
            self.assertEqual(jobtrust.scan(Path(d)), ["x.yml:bad"])

    def test_an_outsider_event_makes_the_job_untrusted(self):
        wf = ("on: {issues: {types: [opened]}, schedule: [{cron: '5 6 * * *'}]}\npermissions: {issues: write}\njobs:\n"
              "  sweep:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./sla.sh\n        env: {GH_TOKEN: \"${{ secrets.LANE_PAT }}\"}\n")
        with tempfile.TemporaryDirectory() as d:
            w = Path(d) / ".github" / "workflows"; w.mkdir(parents=True)
            (w / "x.yml").write_text(wf)
            self.assertEqual(jobtrust.scan(Path(d)), ["x.yml:sweep"])
            (w / "x.yml").write_text(wf.replace("  sweep:\n", "  sweep:\n    if: ${{ github.event_name != 'issues' }}\n"))
            self.assertEqual(jobtrust.scan(Path(d)), [])

    def test_repo_is_clean(self):
        self.assertEqual(jobtrust.check(), 0)

if __name__ == "__main__": unittest.main()
