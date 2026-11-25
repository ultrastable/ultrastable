# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, sys, tempfile, unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import selftest as S  # noqa: E402

NOW = datetime(2026, 11, 25, 12, tzinfo=timezone.utc)
CFG = {"data": {"default_max_age_h": 72, "max_age_h": {}, "exempt": {}}, "workflows": {"repos": ["o/r"], "window": 3, "stale_h": 120}}


class Data(unittest.TestCase):
    def test_frozen_module_is_found_and_fresh_one_is_not(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "site").mkdir()
            (Path(d) / "site/old-data.js").write_text('export const X = {"at": "2026-11-21T00:00:00Z"};')
            (Path(d) / "site/new-data.js").write_text('export const X = {"at": "2026-11-25T10:00:00Z"};')
            (Path(d) / "site/none-data.js").write_text('export const X = [];')
            f = S.data_findings(d, NOW, CFG)
        self.assertEqual(len(f), 1); self.assertIn("site/old-data.js", f[0])


class Workflows(unittest.TestCase):
    def fake(self, runs):
        def get(url):
            if url.endswith("workflows?per_page=100"):
                return {"workflows": [{"id": 1, "path": ".github/workflows/x.yml", "state": "active"}]}
            return {"workflow_runs": runs}
        return get

    def test_three_failed_runs_is_a_silent_stop(self):
        runs = [{"status": "completed", "conclusion": "failure", "created_at": "2026-11-25T05:00:00Z"}] * 3
        f = S.workflow_findings(CFG, self.fake(runs), NOW)
        self.assertTrue(any("all failed" in x for x in f))

    def test_one_success_clears_it(self):
        runs = [{"status": "completed", "conclusion": "success", "created_at": "2026-11-25T05:00:00Z"}] + [{"status": "completed", "conclusion": "failure", "created_at": "2026-11-24T05:00:00Z"}] * 2
        self.assertEqual(S.workflow_findings(CFG, self.fake(runs), NOW), [])

    def test_stopped_schedule_is_found(self):
        runs = [{"status": "completed", "conclusion": "success", "created_at": "2026-11-15T05:00:00Z"}]
        self.assertTrue(any("no scheduled run" in x for x in S.workflow_findings(CFG, self.fake(runs), NOW)))

    def test_unreadable_repo_is_unmeasured_not_fine(self):
        def get(url): raise OSError("403")
        f = S.workflow_findings(CFG, get, NOW)
        self.assertTrue(f and "unmeasured" in f[0])


class Config(unittest.TestCase):
    def test_repo_config_is_valid(self):
        self.assertEqual(S.check(), [])


if __name__ == "__main__":
    unittest.main()
