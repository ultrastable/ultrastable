# SPDX-License-Identifier: LicenseRef-Ultrastable
import unittest
from foundation import redmerge

class RedMerge(unittest.TestCase):
    def test_only_failed_checks_run_is_red(self):
        cs = [{"sha": "a", "subject": "x"}, {"sha": "b", "subject": "y"}]
        runs = {"a": [("checks", "success")], "b": [("checks", "failure")]}
        self.assertEqual([c["sha"] for c in redmerge.red_commits(cs, lambda s: runs[s])], ["b"])

    def test_unreadable_is_unmeasured_not_zero(self):
        def boom(*a, **k): raise RuntimeError("no")
        with self.assertRaises(RuntimeError): redmerge.read(gh=boom)

if __name__ == "__main__": unittest.main()
