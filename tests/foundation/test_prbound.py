# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import prbound
NOW = 1_800_000_000
def ts(min_ago):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(NOW - min_ago * 60, timezone.utc).isoformat().replace("+00:00", "Z")
def pr(n, created, updated, *labels, labelled=None): return {"number": n, "createdAt": ts(created), "updatedAt": ts(updated), "labels": [{"name": l} for l in labels], "since": {l: ts(created if labelled is None else labelled) for l in labels}}
class Bound(unittest.TestCase):
    def test_closes_past_bound_only(self):
        close, _ = prbound.read([pr(1, 50, 1, "conflict"), pr(2, 20, 1, "conflict"), pr(3, 90, 1, "ci-failed"), pr(4, 50, 1, "ci-failed")], NOW)
        self.assertEqual([n for n, _ in close], [1, 3])
    def test_hold_never_closed_and_stale_counted(self):
        close, stale = prbound.read([pr(5, 600, 400, "conflict", "hold"), pr(6, 180, 1)], NOW)
        self.assertEqual(close, []); self.assertEqual([n for n, _ in stale], [6])
    def test_the_clock_is_the_conditions_not_the_pull_requests(self):  # PR-BOUND-3
        close, stale = prbound.read([pr(7, 90, 1, "conflict", labelled=1), pr(8, 90, 1, "conflict", labelled=31), pr(9, 200, 1, "ci-failed", labelled=10)], NOW)
        self.assertEqual(close, [(8, "merge conflict with main unresolved for 31 min")])
        self.assertEqual([n for n, _ in stale], [9], "a pull request open past max_open_h is still reported, whatever its labels")
        unread = dict(pr(10, 90, 1, "conflict"), since={})
        self.assertEqual(prbound.read([unread], NOW)[0], [], "a label whose time was not read is unmeasured: nothing is closed on a guess")
    def test_an_unreadable_label_time_keeps_the_pull_request_open(self):
        import io, contextlib
        from unittest import mock
        prs = [{"number": 3, "created_at": ts(500), "updated_at": ts(1), "labels": [{"name": "conflict"}]}]
        def api(path, *a, **k):
            if "/events" in path: raise RuntimeError("HTTP 502")
            return prs
        closed, out = [], io.StringIO()
        with mock.patch.object(prbound.prsafe, "gh_api", api), mock.patch.object(prbound.prsafe, "safe_close", lambda *a: closed.append(a)), contextlib.redirect_stdout(out):
            self.assertEqual(prbound.main(["--apply"]), 0)
        self.assertEqual(closed, []); self.assertIn('"unmeasured": [3]', out.getvalue())
if __name__ == "__main__": unittest.main()
