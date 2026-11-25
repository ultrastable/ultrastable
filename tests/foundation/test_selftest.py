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


# OUTCOME-PROBE-1 and OWNER-FIRST-1
import json as _j, tempfile as _t, shutil as _sh
from pathlib import Path as _P
from datetime import datetime as _dt, timezone as _tz
from foundation import selftest as _st


def _root(papers, cal, loops=0):
    d = _P(_t.mkdtemp())
    for rel in ("doctrine/selftest.json", "doctrine/detectors.json"):
        (d / rel).parent.mkdir(parents=True, exist_ok=True); _sh.copy(_st.REPO / rel, d / rel)
    (d / "site").mkdir(); (d / "site/research-data.js").write_text("export default " + _j.dumps({"papers": papers}) + ";\n")
    (d / "social").mkdir(); (d / "social/calendar.json").write_text(_j.dumps({"posts": cal}))
    (d / "doctrine/topology.json").write_text(_j.dumps({"workers": [{"id": "x", "routes": ["x.example.org"]}]}))
    (d / "instances/ultrastable").mkdir(parents=True)
    (d / "instances/ultrastable/loop-registry.json").write_text(_j.dumps([{"id": f"l{i}"} for i in range(loops)]))
    return d


NOW = _dt(2026, 11, 25, 12, tzinfo=_tz.utc)
PAGE = "<html>" + "x" * 600


def _fetch(outcomes, sitemap, changes=3):
    def f(url):
        if url.endswith("/api/social/outcomes"): return 200, _j.dumps(outcomes)
        if url.endswith("/api/live/changes"): return 200, _j.dumps({"changes": [{}] * changes})
        if url.endswith("sitemap.xml"): return 200, sitemap
        return 200, PAGE
    return f


def test_unposted_paper_and_missing_sitemap_entry_are_found():
    d = _root([{"slug": "a"}, {"slug": "b"}], [{"kind": "paper", "paper": "a", "date": "2026-11-01", "id": "paper:a:1"}])
    out = _st.outcome_findings(d, fetch=_fetch({"channels": {"bluesky": {"reached": ["paper:a:1"]}}}, "<loc>https://ultrastable.io/research/a</loc>"), now=NOW)
    assert any("paper b: never scheduled" in x for x in out)
    assert any("never reached relay:mastodon" in x for x in out)
    assert any("research/b missing" in x for x in out)
    assert not any("never reached bluesky" in x for x in out)


def test_failing_channel_and_empty_domain_are_found():
    d = _root([], [])
    f = _fetch({"channels": {"relay:facebook": {"fail_streak": 8, "reached": []}}}, "<loc>u</loc>")
    out = _st.outcome_findings(d, fetch=lambda u: (200, "") if u == "https://x.example.org/" else f(u), now=NOW)
    assert any("relay:facebook: last 8" in x for x in out)
    assert any("x.example.org/: HTTP 200, 0 bytes" in x for x in out)


def test_zero_count_against_nonzero_source_is_found(monkeypatch):
    d = _root([], [])
    monkeypatch.setattr(_st, "_source", lambda root, name, now: 12)
    out = _st.outcome_findings(d, fetch=_fetch({"channels": {}}, "<loc>u</loc>", changes=0), now=NOW)
    assert any("reads 0 while git_merges_7d shows 12" in x for x in out)


def test_unreadable_outcome_surface_is_unmeasured_not_passed():
    d = _root([{"slug": "a"}], [{"kind": "paper", "paper": "a", "date": "2026-11-01"}])
    out = _st.outcome_findings(d, fetch=lambda u: (503, ""), now=NOW)
    assert any("unmeasured" in x for x in out)


def test_new_loop_without_metric_fails():
    cfg = _st.load(); cfg = {**cfg, "effects": {"baseline": 2}}
    assert _st.effect_findings(_root([], [], loops=3), cfg)
    assert not _st.effect_findings(_root([], [], loops=2), cfg)


def test_owner_report_without_detector_is_a_gap():
    d = _root([], [])
    (d / "ops").mkdir()
    (d / "ops/owner-reports.jsonl").write_text(_j.dumps({"id": "x", "at": "2026-11-20T00:00:00Z", "what": "page frozen", "detectors": []}) + "\n"
                                               + _j.dumps({"id": "y", "at": "2026-11-20T00:00:00Z", "what": "z", "detectors": ["selftest-data"]}) + "\n")
    out, m = _st.owner_findings(d, now=NOW)
    assert len(out) == 1 and "detector gap" in out[0]
    assert m["owner_found_first_30d"] == 2 and m["target"] == 0


def test_every_owner_report_names_a_live_detector():
    out, _ = _st.owner_findings()
    assert out == []
