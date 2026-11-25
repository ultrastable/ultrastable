# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REDTEAM-1 in the seed: each check fires on the failure it exists for and stays quiet otherwise."""
import datetime as dt, json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import redteam  # noqa: E402

AT = dt.datetime(2026, 11, 25, 20, tzinfo=dt.timezone.utc)


class Seed(unittest.TestCase):
    def test_unscored_and_vacuous(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "ops").mkdir()
            (Path(t) / "ops/log.jsonl").write_text('{"n": 0, "status": "met"}\n{"prediction": "paper_referrals >= 1 within 168 h"}\n')
            self.assertEqual({f["cls"] for f in redteam.check_unscored(t) + redteam.check_vacuous(t)}, {"unscored", "vacuous"})
            (Path(t) / "m.py").write_text('M = {"paper_referrals": 1}\n')
            self.assertEqual(redteam.check_unscored(t), [])

    def test_live_placeholder_and_stale_feed(self):
        pages = {"/": "371 claims at commit generated", "/feed.json": '{"items":[{"date_published":"2026-11-17T00:00:00Z"}]}'}
        def get(u):
            k = u.replace("https://x.test", "")
            if k not in pages:
                raise OSError("404")
            return pages[k]
        ids = {f["id"] for f in redteam.check_live("https://x.test", get, AT)}
        self.assertEqual(ids, {"stale-placeholder", "stale-feed"})

    def test_apply_files_items_and_counts_owner(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "ops").mkdir()
            (Path(t) / "ops/log.jsonl").write_text('{"prediction": "x_rate >= 1 within 24 h"}\n')
            redteam.run(t, apply=True)
            self.assertTrue((Path(t) / "docs/issues/RT-unscored-x_rate.json").is_file())
            self.assertEqual(json.loads((Path(t) / redteam.METRIC).read_text())["redteam_found_30d"], 1)


if __name__ == "__main__":
    unittest.main()
