# SPDX-License-Identifier: LicenseRef-Ultrastable
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

    def test_repo_is_clean(self):
        self.assertEqual(jobtrust.check(), 0)

if __name__ == "__main__": unittest.main()
