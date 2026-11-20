# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# Ultrastable is the foundation for any autonomous system.
import json, tempfile, unittest
from pathlib import Path
from foundation import runway as rw

ROOT = Path(__file__).resolve().parents[2]
NOW = rw.parse_date("2026-11-20")  # the day the target was set; every date below is fixed, so the test does not age
CFG = {"marker": "RUNWAY-1", "version": "1.0.0", "target_days": 365, "ledger": "ops/resilience.jsonl", "item_prefix": "Q-RUNWAY", "file_unmeasured_after_runs": 3,
       "sources": json.loads((ROOT / rw.PATH).read_text(encoding="utf-8"))["sources"],
       "deadlines": [
           {"id": "dom", "kind": "domain", "name": "example.org", "hard": True, "if_lapsed": "site dark", "remedy": "renew", "identity_bound": True},
           {"id": "pat", "kind": "github_token", "env": "GH_TOKEN", "hard": True, "if_lapsed": "pushes fail", "remedy": "use the App"},
           {"id": "cf", "kind": "cloudflare_token", "env": "CF", "account_id": "a", "hard": True, "if_lapsed": "no deploys", "remedy": "roll"},
           {"id": "node", "kind": "eol", "product": "nodejs", "cycle": "22", "hard": False, "if_lapsed": "no patches", "remedy": "upgrade"},
           {"id": "db", "kind": "d1_size", "env": "CF", "account_id": "a", "d1_id": "d", "limit_bytes": 1000, "hard": True, "if_lapsed": "writes refused", "remedy": "retention"}]}


def fetcher(dom="2027-11-10T07:52:16Z", pat="2027-01-31 00:00:00 UTC", cf="2028-06-01T00:00:00Z", node="2027-04-30", size=100, gh_status=200):
    def f(url, headers=None, timeout=30):
        if "rdap" in url:
            return 200, {}, json.dumps({"events": [{"eventAction": "expiration", "eventDate": dom}] if dom else []})
        if "api.github.com" in url:
            return gh_status, ({"github-authentication-token-expiration": pat} if pat else {}), "{}"
        if "tokens/verify" in url:
            return 200, {}, json.dumps({"success": True, "result": {"status": "active", **({"expires_on": cf} if cf else {})}})
        if "endoflife" in url:
            return 200, {}, json.dumps({"eol": node})
        if "/d1/database/" in url:
            return 200, {}, json.dumps({"result": {"file_size": size}})
        return 404, {}, ""
    return f


class Runway(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = Path(self.t.name)
        (self.d / "doctrine").mkdir()
        (self.d / rw.PATH).write_text(json.dumps(CFG))
        self.env = {"GH_TOKEN": "x", "CF": "y"}

    def tearDown(self):
        self.t.cleanup()

    def by(self, r):
        return {x["id"]: x for x in r["deadlines"]}

    def test_declaration_is_well_formed_and_the_target_cannot_be_lowered(self):
        self.assertEqual(rw.check(ROOT), [])
        (self.d / rw.PATH).write_text(json.dumps({**CFG, "target_days": 30}))
        self.assertTrue(any("target_days" in e for e in rw.check(self.d)))
        (self.d / rw.PATH).write_text(json.dumps({**CFG, "deadlines": [{"id": "x", "kind": "domain", "hard": True}]}))
        self.assertEqual(len(rw.check(self.d)), 3)  # no name, no consequence, no remedy

    def test_the_runway_is_the_nearest_hard_deadline_and_a_soft_one_does_not_bound_it(self):
        r = rw.reading(self.d, NOW, fetcher(), self.env)
        b = self.by(r)
        self.assertEqual((b["pat"]["status"], b["pat"]["days_left"]), ("short", 72))
        self.assertEqual((b["dom"]["status"], b["dom"]["days_left"]), ("short", 355))
        self.assertEqual(b["cf"]["status"], "ok")
        self.assertEqual((b["node"]["status"], b["node"]["hard"]), ("short", False))
        self.assertEqual((r["runway_days"], r["nearest"]), (72, "pat"))
        r2 = rw.reading(self.d, NOW, fetcher(pat=None, node="2026-12-01"), self.env)
        self.assertEqual(self.by(r2)["pat"]["status"], "unbounded")
        self.assertEqual((r2["runway_days"], r2["nearest"]), (355, "dom"))  # Node ending in 11 days is filed but is not when the system stops

    def test_what_cannot_be_read_is_unmeasured_never_passed(self):
        r = rw.reading(self.d, NOW, fetcher(dom=None, gh_status=503), {})
        b = self.by(r)
        for i in ("dom", "pat", "cf", "db"):
            self.assertEqual(b[i]["status"], "unmeasured", i)
        self.assertIsNone(r["runway_days"])
        self.assertEqual(self.by(rw.reading(self.d, NOW, fetcher(gh_status=401), self.env))["pat"]["status"], "lapsed")

        def boom(url, headers=None, timeout=30):
            raise RuntimeError("source down")
        self.assertTrue(all(x["status"] == "unmeasured" for x in rw.reading(self.d, NOW, boom, self.env)["deadlines"]))

    def test_a_registry_without_an_expiration_event_falls_back_to_a_declared_date_with_its_source(self):
        c = json.loads(json.dumps(CFG))
        c["deadlines"][0].update(declared_expires="2027-11-10", declared_source="the registration record")
        (self.d / rw.PATH).write_text(json.dumps(c))
        b = self.by(rw.reading(self.d, NOW, fetcher(dom=None), self.env))["dom"]
        self.assertEqual((b["days_left"], b["source"]), (355, "declared: the registration record"))

    def test_storage_days_to_full_come_from_measured_growth(self):
        self.assertEqual(self.by(rw.run(self.d, True, NOW, fetcher(size=100), self.env))["db"]["status"], "unmeasured")  # one reading has no slope
        b = self.by(rw.run(self.d, True, NOW + 10 * 86400, fetcher(size=200), self.env))["db"]
        self.assertEqual((b["status"], b["days_left"], b["used_pct"]), ("short", 80, 20.0))  # 10 bytes a day, 800 left
        self.assertEqual(self.by(rw.reading(self.d, NOW + 20 * 86400, fetcher(size=100), self.env))["db"]["status"], "unbounded")
        self.assertEqual(self.by(rw.reading(self.d, NOW + 20 * 86400, fetcher(size=1000), self.env))["db"]["status"], "lapsed")

    def test_a_short_deadline_files_one_item_with_a_closing_probe_and_the_ledger_records_changes_only(self):
        r = rw.run(self.d, True, NOW, fetcher(), self.env)
        self.assertEqual(sorted(r["filed"]), ["Q-RUNWAY-dom", "Q-RUNWAY-node", "Q-RUNWAY-pat"])
        item = json.loads((self.d / "docs/issues/Q-RUNWAY-dom.json").read_text())
        self.assertIn("cmd:python3 -m foundation runway --probe dom", item["body"])
        self.assertIn("IDENTITY-BOUND", item["body"])
        self.assertEqual(json.loads((self.d / "docs/issues/Q-RUNWAY-pat.json").read_text())["labels"][0], "p0")  # hard and under 90 days
        again = rw.run(self.d, True, NOW + 3600, fetcher(), self.env)
        self.assertEqual((again["filed"], again["changed"]), ([], False))
        self.assertEqual(len((self.d / "ops/resilience.jsonl").read_text().splitlines()), 1)
        self.assertTrue(rw.run(self.d, True, NOW + 86400, fetcher(), self.env)["changed"])  # once a day at least
        self.assertEqual(rw.run(self.d, False, NOW, fetcher(pat="2026-12-01 00:00:00 UTC"), self.env)["filed"], [])  # a dry run files nothing

    def test_an_unreadable_deadline_is_filed_only_after_consecutive_runs(self):
        f = fetcher(pat=None, node="2030-01-01", cf=None, dom="2030-01-01T00:00:00Z")
        for day in range(2):
            self.assertEqual(rw.run(self.d, True, NOW + day * 86400, f, {"CF": "y"})["filed"], [])
        self.assertEqual(rw.run(self.d, True, NOW + 2 * 86400, f, {"CF": "y"})["filed"], ["Q-RUNWAY-pat"])

    def test_dates_in_the_forms_the_sources_use(self):
        self.assertEqual(rw.parse_date("2027-01-31 00:00:00 UTC"), rw.parse_date("2027-01-31T00:00:00Z"))
        self.assertEqual(rw.parse_date("2027-01-31"), rw.parse_date("2027-01-31 00:00:00 +0000"))
        self.assertIsNone(rw.parse_date("never"))
        self.assertIsNone(rw.parse_date(None))


if __name__ == "__main__":
    unittest.main()
