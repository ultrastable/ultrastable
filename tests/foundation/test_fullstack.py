# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FULLSTACK-1: every system has a repository, a back end and a public front end, or an open item for the part it lacks."""
import json, shutil, unittest
from pathlib import Path
from foundation import fullstack as F
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
FILES = ["doctrine/full-stack.json", "instances/ultrastable/progress.json", "doctrine/seed-deploys.json", "docs/issues/Q-FULLSTACK-second-tenant.json"] + F.RULE_FILES


def copy():
    d = scratch()
    for f in FILES:
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    return d


class FullStack(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(F.check(REPO), [])

    def test_a_new_system_with_no_back_end_fails(self):
        d = copy()
        p = json.loads((d / "instances/ultrastable/progress.json").read_text())
        p["systems"].append({"id": "newcomer", "repo": "ultrastable/newcomer", "url": "https://newcomer.example"})
        (d / "instances/ultrastable/progress.json").write_text(json.dumps(p))
        self.assertTrue(any("newcomer: no backend" in b for b in F.check(d)))

    def test_a_new_system_is_read_from_its_own_lifecycle(self):
        d = copy()
        p = json.loads((d / "instances/ultrastable/progress.json").read_text())
        p["systems"].append({"id": "newcomer", "repo": "ultrastable/newcomer", "url": "https://newcomer.example"})
        (d / "instances/ultrastable/progress.json").write_text(json.dumps(p))
        (d / "instances/newcomer").mkdir(parents=True)
        (d / "instances/newcomer/lifecycle.json").write_text(json.dumps({"verify": {"url": "https://newcomer.example/health"}}))
        self.assertFalse(any(b.startswith("newcomer") for b in F.check(d)))

    def test_a_gap_needs_an_open_item(self):
        d = copy()
        pol = json.loads((d / "doctrine/full-stack.json").read_text())
        pol["systems"]["second-tenant"] = {"backend": "https://x.example/health", "gaps": {"repo": "Q-FULLSTACK-second-tenant", "frontend": "Q-FULLSTACK-second-tenant"}}
        (d / "doctrine/full-stack.json").write_text(json.dumps(pol))
        # The test sets the item's state itself: the live item closes once the gap is filled.
        f = d / "docs/issues/Q-FULLSTACK-second-tenant.json"
        f.write_text(f.read_text().replace("**Status:** closed", "**Status:** open"))
        self.assertFalse(any(b.startswith("second-tenant") for b in F.check(d)))
        f.write_text(f.read_text().replace("**Status:** open", "**Status:** closed"))
        self.assertTrue(any("second-tenant: no repo" in b and "closed" in b for b in F.check(d)))

    def test_live_goes_red_on_a_missing_or_silent_part(self):
        answers = {"front": (200, "text/html", "<html>"), "health": (503, "application/json", '{"org":"x"}')}
        fetch = lambda url, ua: (404, "", "") if "github.com" in url else (0, "", "refused") if "unlearn" in url else answers["health" if "/health" in url else "front"]
        rows = {r["id"]: r for r in F.live(REPO, fetch)}
        self.assertTrue(rows["ultrastable"]["ok"])
        self.assertEqual(rows["ultrastable"]["backend"], "live")
        self.assertFalse(rows["unlearn"]["ok"])
        self.assertEqual(rows["second-tenant"]["repo"], "missing (404)", "declared and never made is not a repository")
        self.assertFalse(rows["second-tenant"]["ok"])
        made = {r["id"]: r for r in F.live(REPO, lambda url, ua: (200, "text/html", "<html>") if "github.com" in url else answers["health" if "/health" in url else "front"])}
        self.assertTrue(made["second-tenant"]["ok"])


if __name__ == "__main__":
    unittest.main()
