# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""APP-REUSE-1: one active GitHub App per role, and the connect routes consult the stored app before registering another."""
import json, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class Connections(unittest.TestCase):
    def test_one_active_app_per_role(self):
        apps = json.loads((ROOT / "ops/connections/github-apps.json").read_text(encoding="utf-8"))["apps"]
        for role in ("github-app", "github-admin"):
            self.assertEqual(len([a for a in apps if a["role"] == role and a["state"] == "active"]), 1, role)
        self.assertEqual(len({a["slug"] for a in apps}), len(apps))
        self.assertTrue(all(a["state"] in ("active", "superseded") for a in apps))

    def test_connect_routes_reuse_the_stored_app(self):
        src = (ROOT / "seed/worker/src/auth/routes.js").read_text(encoding="utf-8")
        for provider in ("github-app", "github-admin"):
            self.assertIn(f"reuseApp(env, tenant, '{provider}'", src)
        # the reuse check comes before the manifest form on both routes
        self.assertLess(src.index("reuseApp(env, tenant, 'github-app'"), src.index("fields: { manifest: JSON.stringify(manifest(origin, uniqueName(name)))"))


if __name__ == "__main__":
    unittest.main()
