"""SLA-1: a PR or issue past its written limit is reported in every state; inside the limit is not."""
import json, unittest
from datetime import datetime, timezone
from pathlib import Path
from foundation import slawatch

NOW = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)
SLA = json.loads((Path(__file__).resolve().parents[2] / "doctrine" / "sla.json").read_text())


class SlaWatch(unittest.TestCase):
    def test_old_pr_in_any_state_breaches(self):
        prs = [{"number": 1, "createdAt": "2026-11-21T11:00:00Z", "mergeStateStatus": "DIRTY"}, {"number": 2, "createdAt": "2026-11-21T17:30:00Z", "mergeStateStatus": "DIRTY"}]
        self.assertEqual(len(slawatch.breaches(prs, [], NOW, SLA)), 1)

    def test_issue_limit_follows_priority(self):
        old = "2026-11-18T00:00:00Z"
        issues = [{"number": 3, "createdAt": old, "labels": [{"name": "p0"}]}, {"number": 4, "createdAt": old, "labels": [{"name": "p2"}]}]
        self.assertEqual(len(slawatch.breaches([], issues, NOW, SLA)), 1)


if __name__ == "__main__":
    unittest.main()
