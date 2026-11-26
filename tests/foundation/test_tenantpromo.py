# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TENANT-PROMO-1: every tenant promotes itself; a new tenant without promotion fails the check."""
import json, shutil, unittest
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import tenantpromo

REPO = Path(__file__).resolve().parents[2]
FILES = ["doctrine/tenant-promotion.json", "instances/ultrastable/progress.json", "social/gate.json", "doctrine/stakeholders.json"] + tenantpromo.RULE_FILES


class TenantPromo(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for f in FILES:
            (self.tmp / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, self.tmp / f)

    def edit(self, rel, fn):
        p = self.tmp / rel
        d = json.loads(p.read_text())
        fn(d)
        p.write_text(json.dumps(d))

    def test_repo_passes(self):
        self.assertEqual(tenantpromo.check(REPO), [])

    def test_new_tenant_without_promotion_fails(self):
        self.edit("instances/ultrastable/progress.json", lambda d: d["systems"].append({"id": "newbie", "repo": "x/y"}))
        self.assertTrue(any("newbie" in b for b in tenantpromo.check(self.tmp)))

    def test_queue_not_drained_fails(self):
        self.edit("social/gate.json", lambda d: d.__setitem__("tenant_queues", []))
        self.assertTrue(any("unlearn" in b and "tenant_queues" in b for b in tenantpromo.check(self.tmp)))

    def test_missing_showcase_fails(self):
        self.edit("doctrine/stakeholders.json", lambda d: d.__setitem__("showcases", [c for c in d["showcases"] if c["id"] != "unlearn"]))
        self.assertTrue(any("unlearn" in b and "showcase" in b for b in tenantpromo.check(self.tmp)))



if __name__ == "__main__":
    unittest.main()
