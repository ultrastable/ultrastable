# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-01: a backup counts only after it restores (US-01-R19), provenance rows settle and the public view is redacted (US-01-R20), a person's
data leaves as open-standard JSON with no secret and comes back idempotently (US-01-R21).

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_01_records.py"""
import datetime as dt
import gzip
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from _repo import ROOT, scratch
from foundation import backup, provenance as P
from test_backup import FakeAccount

DAY = dt.date(2026, 11, 26)
O = lambda c, a, ch="pr": {"class": c, "actor": a, "channel": ch}


class Backups(unittest.TestCase):
    def setUp(self):
        self.tmp = scratch()
        (self.tmp / "doctrine").mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "doctrine/backup.json", self.tmp / "doctrine/backup.json")

    def drill(self, acct):
        return backup.run(self.tmp, apply=True, api=acct.api, download=acct.download, sleep=lambda s: None, today=DAY)

    def test_us_01_r19_a_dump_counts_only_when_it_restores_matches_the_live_counts_and_reads_back_from_the_store(self):
        a = FakeAccount(); out = self.drill(a); d = out["databases"][0]
        self.assertTrue(out["ok"], out)
        self.assertEqual((d["rows"], d["integrity"], d["mismatches"], d["restored"]), (3, "ok", [], True))
        self.assertTrue(d["stored"]["readback"], "the stored copy was read back")
        dump = gzip.decompress(a.r2["backups/d1/org/2026-11-26.sql.gz"]).decode()
        self.assertIn("items", dump)
        self.assertNotIn("credentials", dump, "a table that holds sealed credentials is left out")
        self.assertEqual(d["excluded_tables"], ["credentials"], "and named in the record")

    def test_us_01_r19_a_dump_that_does_not_restore_or_cannot_be_stored_is_not_a_backup_and_the_record_holds_no_row(self):
        bad = self.drill(FakeAccount(corrupt=True)); self.assertFalse(bad["ok"]); self.assertFalse(bad["databases"][0]["restored"])
        self.assertTrue(backup.due(self.tmp, DAY), "a failed drill is due again at once")
        unstored = self.drill(FakeAccount(r2=False)); self.assertFalse(unstored["ok"]); self.assertTrue(unstored["restore_ok"]); self.assertFalse(unstored["stored_ok"])
        self.drill(FakeAccount())
        record = (self.tmp / backup.OUT).read_text()
        self.assertNotIn("'a'", record); self.assertNotIn("sealed", record)


class Provenance(unittest.TestCase):
    def setUp(self):
        self.root = scratch()
        (self.root / "doctrine").mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "doctrine/provenance.json", self.root / "doctrine/provenance.json")

    def test_us_01_r20_a_row_carries_its_origin_and_effect_and_a_later_row_settles_it_without_rewriting_history(self):
        r = P.record(self.root, O("loop", "insight-loop"), "change", "raise a knob", affected=["doctrine/insight.json"], public=True)
        self.assertEqual({k: r["origin"][k] for k in ("class", "actor", "channel")}, O("loop", "insight-loop"))
        self.assertEqual(r["effect"]["status"], "pending")
        P.settle(self.root, r["id"], "kept", "the metric moved")
        rows = P.entries(self.root)
        self.assertEqual((len(rows), rows[0]["effect"]["status"]), (1, "kept"))
        self.assertEqual(len(P.entries(self.root, raw=True)), 2, "the original row is still there")
        for bad in (O("robot", "x"), O("loop", ""), O("loop", "x", "carrier-pigeon")):
            with self.assertRaises(ValueError):
                P.make(bad, "change", "s")

    def test_us_01_r20_the_public_view_shows_only_public_rows_with_contact_details_tokens_and_query_strings_removed(self):
        P.record(self.root, O("end_user", "visitor", "form"), "suggestion", "mail me at jane@example.org", public=False)
        P.record(self.root, O("end_user", "visitor", "form"), "suggestion", "fix a typo, call 10.1.2.3 ghp_" + "b" * 24 + " https://x.example/p?token=abc", public=True)
        v = P.changelog(self.root); txt = json.dumps(v)
        self.assertEqual(len(v["entries"]), 1)
        for leak in ("jane@", "10.1.2.3", "ghp_", "token=abc"):
            self.assertNotIn(leak, txt)


class Portability(unittest.TestCase):
    def test_us_01_r21_an_export_holds_no_token_or_salt_and_an_import_of_the_same_content_creates_nothing_twice(self):
        r = subprocess.run(["node", "--no-warnings", "site/mydata.test.mjs"], cwd=ROOT, capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("mydata ok", r.stdout)
        src = (ROOT / "site/portability.js").read_text()
        self.assertIn("ultrastable-export/v1", src)


if __name__ == "__main__":
    unittest.main()
