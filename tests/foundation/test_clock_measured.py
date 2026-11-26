# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import json, tempfile, unittest
from pathlib import Path
from unittest import mock
from foundation import clock


class _Resp:
    def __init__(self, body): self.body = json.dumps(body).encode()
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False


class ClockMeasured(unittest.TestCase):
    def test_unmeasured_clock_is_a_finding(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "ops").mkdir()
            (Path(d) / "ops" / "transparency.json").write_text(json.dumps({"clocks": [{"id": "a", "status": "ticking"}, {"id": "b", "status": "unmeasured", "why": "no token"}]}))
            self.assertEqual(clock.unmeasured(d), ["b: unmeasured (no token)"])
            (Path(d) / "ops" / "transparency.json").write_text(json.dumps({"clocks": []}))
            self.assertTrue(clock.unmeasured(d))  # an empty record is never a pass

    def test_health_route_reads_last_beat_without_a_token(self):
        now = 1_800_000_000.0
        with mock.patch("urllib.request.urlopen", return_value=_Resp({"last_beat_minutes_ago": 30})):
            self.assertEqual(clock.health_beats({"health": {"url": "https://x/health", "age_min": "last_beat_minutes_ago"}}, now), [now - 1800])
        with mock.patch("urllib.request.urlopen", return_value=_Resp({"last_tick": {"started_at": "2027-01-15T08:00:00Z"}})):
            self.assertEqual(len(clock.health_beats({"health": {"url": "https://x/health", "at": "last_tick.started_at"}}, now)), 1)
        with mock.patch("urllib.request.urlopen", return_value=_Resp({})):
            with self.assertRaises(RuntimeError):
                clock.health_beats({"health": {"url": "https://x/health", "age_min": "nope"}}, now)


if __name__ == "__main__":
    unittest.main()
