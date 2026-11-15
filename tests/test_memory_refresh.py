import importlib.util, pathlib, unittest

spec = importlib.util.spec_from_file_location("memory_refresh", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "memory_refresh.py")
mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)

TEXT = "# Project memory\n\nLast updated: 2026-11-14\n\n- 2026-11-14: OLD-1: something\nMaintained by: every agent\n"


class MemoryRefresh(unittest.TestCase):
    def test_records_merged_work_and_bumps_the_date(self):
        out = mr.refresh(TEXT, [("2026-11-15", "NEW-2: second (#2)"), ("2026-11-15", "NEW-1: first (#1)")], "2026-11-15")
        self.assertIn("Last updated: 2026-11-15\n\n- 2026-11-15: NEW-2: second (#2)\n- 2026-11-15: NEW-1: first (#1)\n- 2026-11-14: OLD-1", out)

    def test_bookkeeping_commits_are_not_recorded(self):
        out = mr.refresh(TEXT, [("2026-11-15", "lane: server-owned loops (SERVER-OWNS-LOOPS-1)"), ("2026-11-15", "deploy-workers: record live-verified deploy")], "2026-11-15")
        self.assertEqual(out, TEXT)

    def test_idempotent(self):
        commits = [("2026-11-15", "NEW-1: first (#1)")]
        once = mr.refresh(TEXT, commits, "2026-11-15")
        self.assertEqual(mr.refresh(once, commits, "2026-11-15"), once)

    def test_lane_runs_the_refresh(self):
        lane = (pathlib.Path(__file__).resolve().parents[1] / "scripts" / "lane.sh").read_text(encoding="utf-8")
        self.assertIn("scripts/memory_refresh.py", lane)
        self.assertIn("docs/PROJECT-MEMORY.md", lane)


if __name__ == "__main__":
    unittest.main()
