"""REDTEAM-1: each blind-spot check fires on the failure the owner found first on 2026-11-25, and stays quiet when it is fixed."""
import datetime as dt, json, tempfile, unittest
from pathlib import Path
from foundation import redteam, research

AT = dt.datetime(2026, 11, 25, 20, tzinfo=dt.timezone.utc)


class Vacuous(unittest.TestCase):
    def test_no_data_is_never_met(self):
        f = {"metric": "human_touches", "target": {"op": "<=", "value": 0}}
        self.assertEqual(research.verdict(f, {"human_touches": {"value": 0, "n": 0}})["status"], "unmeasured")
        self.assertEqual(research.verdict(f, {"human_touches": {"value": 0, "n": 4}})["status"], "met")


class Stale(unittest.TestCase):
    def test_old_snapshot_is_a_finding(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "ops/research"; p.mkdir(parents=True)
            (p / "prs.json").write_text(json.dumps({"fetched_at": "2026-11-21T09:30:00Z"}))
            self.assertEqual(len(redteam.check_stale(t, at=AT)), 1)
            (p / "prs.json").write_text(json.dumps({"fetched_at": "2026-11-25T09:30:00Z"}))
            self.assertEqual(redteam.check_stale(t, at=AT), [])


class Phantom(unittest.TestCase):
    def test_outside_deploys_with_zero_touches(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "ops").mkdir()
            (Path(t) / "ops/criticality.jsonl").write_text(json.dumps({"at": "x", "human_touches": 0, "origins": {"outside": 12}}) + "\n")
            self.assertEqual(redteam.check_phantom(t)[0]["cls"], "phantom")


class Live(unittest.TestCase):
    def page(self, apps_at, weekly, claims='{"claims":[]}', home="ok"):
        pages = {"/": home, "/api/claims": claims, "/progress.json": json.dumps({"apps": {"as_of": apps_at}, "digests": {"weekly": {"substantive": weekly}}}),
                 "/pulse.json": json.dumps({"week": {"substantive": 249}})}
        def get(url, token=None):
            if "api.github.com" in url:
                return "[]"
            return pages[url.replace("https://ultrastable.io", "")]
        return get

    def test_owner_findings_of_2026_11_25(self):
        bad = redteam.check_live(".", get=self.page("2026-11-17T21:00:00Z", 345, '"One loop, " + VERIFIED.ledgers.length + " ledgers', "371 claims at commit generated."), at=AT)
        self.assertEqual({b["id"] for b in bad}, {"unsourced:home-placeholder", "unsourced:claims-template", "stale:progress-apps", "conflict:weekly-substantive"})

    def test_clean(self):
        self.assertEqual(redteam.check_live(".", get=self.page("2026-11-25T10:00:00Z", 250), at=AT), [])


class Ledger(unittest.TestCase):
    def test_metric_counts_who_found_it_first(self):
        with tempfile.TemporaryDirectory() as t:
            redteam.record_owner(t, "x", "stale", "redteam:stale", "w", at="2026-11-25T10:00:00Z")
            m = redteam.metric(t, at=AT)
            self.assertEqual((m["owner_found_30d"], m["redteam_found_30d"]), (1, 0))

    def test_repo_owner_findings_name_live_detectors(self):
        self.assertEqual(redteam.check_undetected(), [])


if __name__ == "__main__":
    unittest.main()
