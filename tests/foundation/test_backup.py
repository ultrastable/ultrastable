# BLINDSPOT-1 need backup-restore: export, restore into a scratch database, compare, store, read back.
import datetime as dt, gzip, json, shutil, sqlite3, unittest
from pathlib import Path
import _repo  # noqa: E402
from foundation import backup

REPO = Path(__file__).resolve().parents[2]
DAY = dt.date(2026, 11, 20)


class FakeAccount:
    """A Cloudflare account small enough to hold in memory: one D1 database (a real SQLite database), one KV namespace and an R2 bucket."""
    def __init__(self, corrupt=False, r2=True):
        self.db = sqlite3.connect(":memory:")
        self.db.executescript("CREATE TABLE items(id INTEGER PRIMARY KEY, t TEXT); INSERT INTO items(t) VALUES ('a'),('b'),('c');"
                              "CREATE TABLE credentials(id INTEGER PRIMARY KEY, sealed TEXT); INSERT INTO credentials(sealed) VALUES ('x');")
        self.kv, self.r2, self.corrupt, self.has_r2, self.exported = {"k1": b"v1", "k2": b"\x00\x01"}, {}, corrupt, r2, None

    def api(self, method, path, body=None, raw=False):
        if path.startswith("d1/database?"):
            return {"result": [{"name": "org", "uuid": "db1"}]}
        if path == "d1/database/db1/query":
            cur = self.db.execute(body["sql"]); cols = [c[0] for c in cur.description]
            return {"result": [{"results": [dict(zip(cols, r)) for r in cur.fetchall()]}]}
        if path == "d1/database/db1/export":
            self.exported = body.get("dump_options", {}).get("tables", self.exported)
            return {"result": {"status": "complete", "result": {"signed_url": "https://signed.example/dump.sql"}}} if "current_bookmark" in body else {"result": {"status": "active", "at_bookmark": "b1"}}
        if path.startswith("storage/kv/namespaces?"):
            return {"result": [{"id": "ns1", "title": "private"}]}
        if path.startswith("storage/kv/namespaces/ns1/keys"):
            return {"result": [{"name": k} for k in self.kv], "result_info": {"cursor": ""}}
        if path.startswith("storage/kv/namespaces/ns1/values/"):
            return self.kv[path.rsplit("/", 1)[1]]
        if path.startswith("r2/buckets/"):
            if not self.has_r2:
                raise OSError(f"{method} r2: HTTP 403")
            key = path.split("/objects", 1)[1].lstrip("/")
            if method == "PUT":
                self.r2[key] = body; return b""
            if method == "DELETE":
                self.r2.pop(key, None); return b""
            if key.startswith("?"):
                import urllib.parse
                pre = urllib.parse.parse_qs(key[1:])["prefix"][0]
                return {"result": [{"key": k} for k in self.r2 if k.startswith(pre)]}
            return self.r2[key]
        raise AssertionError(path)

    def download(self, url):
        sql = "\n".join(l for l in self.db.iterdump() if "credentials" not in l)
        return (sql[: len(sql) // 2] if self.corrupt else sql).encode()


class Backup(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        (self.tmp / "doctrine").mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / "doctrine/backup.json", self.tmp / "doctrine/backup.json")

    def run_with(self, acct, **kw):
        return backup.run(self.tmp, apply=True, api=acct.api, download=acct.download, sleep=lambda s: None, today=DAY, **kw)

    def test_repo_config_is_valid(self):
        self.assertEqual(backup.check(REPO), [])

    def test_drill_restores_counts_and_reads_the_copy_back(self):
        a = FakeAccount(); out = self.run_with(a)
        d = out["databases"][0]
        self.assertTrue(out["ok"], out)
        self.assertEqual((d["rows"], d["integrity"], d["mismatches"], d["excluded_tables"]), (3, "ok", [], ["credentials"]))
        self.assertEqual(a.exported, ["items"])                                    # the sealed table never leaves the database
        dump = gzip.decompress(a.r2["backups/d1/org/2026-11-20.sql.gz"]).decode()
        self.assertIn("items", dump); self.assertNotIn("credentials", dump)
        self.assertTrue(d["stored"]["readback"]); self.assertEqual(out["kv"][0]["saved"], 2)
        rec = (self.tmp / backup.OUT).read_text()
        self.assertNotIn("'a'", rec); self.assertNotIn("sealed", rec)             # the record holds counts and hashes, never a row
        self.assertEqual(backup.run(self.tmp, api=a.api, today=DAY + dt.timedelta(days=3)), {"skipped": "last drill is fresh"})
        self.assertTrue(backup.due(self.tmp, DAY + dt.timedelta(days=7)))

    def test_a_dump_that_does_not_restore_fails_the_drill(self):
        out = self.run_with(FakeAccount(corrupt=True))
        self.assertFalse(out["ok"]); self.assertFalse(out["databases"][0]["restored"])
        self.assertTrue(backup.due(self.tmp, DAY))                                 # a failed drill is due again at once

    def test_a_copy_that_cannot_be_stored_is_not_a_backup(self):
        out = self.run_with(FakeAccount(r2=False))
        self.assertTrue(out["restore_ok"]); self.assertFalse(out["stored_ok"]); self.assertFalse(out["ok"])
        self.assertIn("HTTP 403", out["databases"][0]["stored"]["error"])

    def test_retention_keeps_the_newest_copies(self):
        a = FakeAccount()
        for i in range(10):
            a.r2[f"backups/d1/org/2026-10-{i + 1:02d}.sql.gz"] = b"x"
        self.run_with(a)
        keys = sorted(k for k in a.r2 if k.startswith("backups/d1/org/"))
        self.assertEqual(len(keys), 8); self.assertEqual(keys[-1], "backups/d1/org/2026-11-20.sql.gz")

    def test_no_credential_is_unmeasured_not_ok(self):
        self.assertIn("unmeasured", backup.run(self.tmp, env={})["skipped"])


if __name__ == "__main__":
    unittest.main()
