# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""OWN-DB-1: a core Worker config that binds a tenant's or the originating fleet's database fails the build."""
import json
import shutil
import unittest

from _repo import ROOT, scratch
from foundation import owndb

FILES = ["instances/ultrastable/own-database.json", "doctrine/single-account.json", "site/wrangler.toml", "dashboard/wrangler.toml", "spinoffs/wrangler.toml", "wrangler.toml"]


def repo():
    d = scratch()
    for f in FILES + [p.relative_to(ROOT).as_posix() for p in (ROOT / "instances/ultrastable/system").glob("*.wrangler.jsonc")]:
        (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / f, d / f)
    return d


class OwnDb(unittest.TestCase):
    def test_repository_passes(self):
        self.assertEqual(owndb.check(ROOT), [])

    def test_core_config_binding_a_tenant_database_fails(self):
        d = repo(); rec = owndb.load(d)
        p = d / "site/wrangler.toml"; p.write_text(p.read_text().replace(rec["core"][1]["id"], rec["tenant"][0]["id"]))
        self.assertTrue(any("never binds a tenant" in b for b in owndb.check(d)))

    def test_originating_fleet_database_fails(self):
        d = repo()
        fleet = json.loads((d / "doctrine/single-account.json").read_text())["forbidden"][2]["pattern"]
        p = d / "site/wrangler.toml"; p.write_text(p.read_text().replace(owndb.load(d)["core"][1]["id"], fleet))
        self.assertTrue(any("originating fleet" in b for b in owndb.check(d)))

    def test_undeclared_database_and_stale_bound_by_fail(self):
        d = repo()
        p = d / "site/wrangler.toml"; p.write_text(p.read_text() + '\n[[d1_databases]]\nbinding = "X"\ndatabase_name = "new-db"\ndatabase_id = "11111111-2222-3333-4444-555555555555"\n')
        self.assertTrue(any("does not declare" in b for b in owndb.check(d)))
        d2 = repo(); (d2 / "site/wrangler.toml").unlink()
        self.assertTrue(any("bound_by is stale" in b for b in owndb.check(d2)))
        owndb.write(d2); self.assertEqual(owndb.check(d2), [])

    def test_write_restores_a_topology_database_the_record_lost(self):
        # The merge lane takes this record from main and reruns --write; a database the topology declares and a config binds comes back.
        d = repo(); (d / "doctrine").mkdir(exist_ok=True); shutil.copy(ROOT / "doctrine/topology.json", d / "doctrine/topology.json")
        rec = owndb.load(d); gone = rec["core"].pop(); rec["live"]["databases"] = [x for x in rec["live"]["databases"] if x["id"] != gone["id"]]
        (d / owndb.PATH).write_text(json.dumps(rec))
        self.assertTrue(any("does not declare" in b for b in owndb.check(d)))
        owndb.write(d); self.assertEqual(owndb.check(d), [])

    def test_live_is_unmeasured_without_a_credential_and_never_ok(self):
        self.assertEqual(owndb.live(ROOT, env={})[0], 2)
        def boom(url, tok): raise OSError("down")
        self.assertEqual(owndb.live(ROOT, env={"CLOUDFLARE_API_TOKEN": "t"}, get=boom)[0], 2)

    def test_live_reads_the_account(self):
        rec, env = owndb.load(ROOT), {"CLOUDFLARE_API_TOKEN": "t"}
        full = lambda url, tok: {"result": [{"uuid": x["id"], "name": x["name"]} for x in rec["core"] + rec["tenant"]]}
        self.assertEqual(owndb.live(ROOT, env=env, get=full)[0], 0)
        self.assertEqual(owndb.live(ROOT, env=env, get=lambda u, t: {"result": [{"uuid": rec["core"][0]["id"], "name": rec["core"][0]["name"]}]})[0], 1)


if __name__ == "__main__":
    unittest.main()
