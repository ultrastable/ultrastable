"""cf_account: probe, copy dry-run and cutover ordering against a fake API."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import cf_account as cf  # noqa: E402

SRC, DST = "edb167b78c9fb901ea5bca3ce58ccc4b", "81e3a4efb4eb66e613529b87682911bb"


def fake(calls, reach=(SRC,)):
    def api(method, path, body=None, raw=False, headers=None):
        calls.append((method, path))
        ok = lambda r: {"success": True, "result": r}
        if path == "/accounts": return ok([{"id": i, "name": i[:4]} for i in reach])
        if path.endswith("/workers/scripts"): return ok([{"id": "ultrastable-tick"}, {"id": "qnfo-ops"}])
        if path.endswith("/settings"): return ok({"bindings": [{"type": "d1", "name": "DB", "id": "old"}], "compatibility_date": "2026-10-01"})
        if path.endswith("/secrets"): return ok([{"name": "ANALYTICS_TOKEN"}])
        if path.endswith("/d1/database"): return ok([{"name": "ultrastable-org", "uuid": "old"}])
        if path.endswith("/kv/namespaces"): return ok([])
        if path.endswith("/r2/buckets"): return ok({"buckets": []})
        return ok(None)
    return api


class CfAccount(unittest.TestCase):
    def test_probe_says_target_unreachable(self):
        p = cf.probe(fake([]))
        self.assertFalse(p["target_reachable"]); self.assertTrue(p["source_reachable"])

    def test_probe_sees_target_when_token_covers_it(self):
        self.assertTrue(cf.probe(fake([], (SRC, DST)))["target_reachable"])

    def test_copy_dry_run_changes_nothing_and_scopes_workers(self):
        calls = []
        plan = json.loads((ROOT / "deploy/transfer/plan.json").read_text())
        out = cf.copy(fake(calls), SRC, DST, False, plan)
        self.assertTrue(any("ultrastable-tick" in s for s in out["steps"]))
        self.assertFalse(any("qnfo-ops" in s for s in out["steps"]))
        self.assertEqual(out["secrets_to_rebind"], {"ultrastable-tick": ["ANALYTICS_TOKEN"]})
        self.assertTrue(all(m == "GET" for m, _ in calls), calls)

    def test_cutover_enables_target_before_disabling_source(self):
        calls = []
        plan = json.loads((ROOT / "deploy/transfer/plan.json").read_text())
        cf.cutover(fake(calls), SRC, DST, True, plan)
        puts = [p for m, p in calls if m == "PUT"]
        self.assertIn(DST, puts[0]); self.assertIn(SRC, puts[1])
        (ROOT / "deploy/transfer/state.json").unlink(missing_ok=True)

    def test_no_token_is_recorded_not_crashed(self):
        import os, unittest.mock as m
        with m.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(cf.main(["probe"]), 2)


if __name__ == "__main__":
    unittest.main()


class MultiModuleCopy(unittest.TestCase):
    def test_parse_modules_picks_default_export_as_main(self):
        import importlib.util, pathlib
        spec = importlib.util.spec_from_file_location("cfa", pathlib.Path(__file__).resolve().parents[2] / "scripts" / "cf_account.py")
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        nl = bytes([13, 10])
        raw = b"--B" + nl + b'Content-Disposition: form-data; name="util.js"' + nl + nl + b"export const x=1;" + nl + b"--B" + nl + b'Content-Disposition: form-data; name="index.js"' + nl + nl + b"export default {};" + nl + b"--B--" + nl
        mods = m.parse_modules(raw)
        self.assertEqual([x[0] for x in mods], ["util.js", "index.js"])
        self.assertEqual(m.main_module(mods), "index.js")
        self.assertEqual(m.parse_modules(b"export default {}")[0][0], "worker.js")
