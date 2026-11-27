# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-13: US-13-R15, the service-level detector that is independent of the enforcer (foundation/slawatch.py reads the written table
doctrine/sla.json; the enforcer is the seed sweeper, seed/worker/src/sla.js). It reads every open change request whatever its merge state and
every open item, fails when one is past its limit, and counts a repository it cannot read as a failure, never as clean.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_13_service_levels.py"""
import io
import json
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from foundation import slawatch

ROOT = Path(__file__).resolve().parents[2]
SLA = json.loads((ROOT / "doctrine" / "sla.json").read_text())
NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)
OLD = "2026-11-21T16:00:00Z"     # 120 minutes before NOW, past the hard limit of the table
YOUNG = "2026-11-21T17:50:00Z"   # 10 minutes before NOW


class IndependentDetector(unittest.TestCase):
    def test_us_13_r15_every_merge_state_is_read(self):
        """US-13-R15: a request past its limit breaches in every merge state, merge-ready and draft included; a young one does not."""
        states = ["CLEAN", "DIRTY", "BLOCKED", "BEHIND", "UNSTABLE", "UNKNOWN", "DRAFT", "HAS_HOOKS"]
        prs = [{"number": i, "createdAt": OLD, "mergeStateStatus": s} for i, s in enumerate(states, 1)]
        prs.append({"number": 99, "createdAt": YOUNG, "mergeStateStatus": "DIRTY"})
        found = slawatch.breaches(prs, [], NOW, SLA)
        self.assertEqual(len(found), len(states))
        for s in states:
            self.assertTrue(any(f"state {s}" in b for b in found), s)
        self.assertFalse(any("#99 " in b for b in found))

    def test_us_13_r15_items_are_read_with_their_priority_limit(self):
        """US-13-R15: an open item past the limit of its priority breaches; the same age under a longer limit does not."""
        three_days = "2026-11-18T17:00:00Z"
        issues = [{"number": 1, "createdAt": three_days, "labels": [{"name": "p0"}]},
                  {"number": 2, "createdAt": three_days, "labels": ["p1"]},
                  {"number": 3, "createdAt": three_days, "labels": []}]
        found = slawatch.breaches([], issues, NOW, SLA)
        self.assertEqual(found, [b for b in found if b.startswith("issue #1 ")])
        self.assertEqual(len(found), 1)

    def test_us_13_r15_the_check_fails_on_a_breach_and_on_an_unreadable_repository(self):
        """US-13-R15: the command exits 1 when a request is past its limit or a repository cannot be read, and 0 when all are inside their limits."""
        def gh_with(prs, issues, refuse=()):
            def fake(kind, repo, fields):
                if repo in refuse:
                    raise RuntimeError("HTTP 403")
                return prs if kind == "pr" else issues
            return fake

        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return NOW

        def run(fake, repos):
            out = io.StringIO()
            with mock.patch.object(slawatch, "_gh", fake), mock.patch.object(slawatch, "datetime", Clock), redirect_stdout(out):
                code = slawatch.main(sum((["--repo", r] for r in repos), []))
            return code, out.getvalue()

        code, text = run(gh_with([{"number": 7, "createdAt": OLD, "mergeStateStatus": "CLEAN"}], []), ["o/a"])
        self.assertEqual(code, 1); self.assertIn("o/a: PR #7", text)
        code, text = run(gh_with([{"number": 8, "createdAt": YOUNG, "mergeStateStatus": "DIRTY"}], []), ["o/a", "o/b"])
        self.assertEqual(code, 0); self.assertIn("slawatch ok", text)
        code, text = run(gh_with([], [], refuse=("o/b",)), ["o/a", "o/b"])
        self.assertEqual(code, 1); self.assertIn("o/b unmeasured", text)


if __name__ == "__main__":
    unittest.main()
