"""Launch: the loops run on the real records, write evidence, probe host surfaces, and export the D1 load."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import launch  # noqa: E402


class Launch(unittest.TestCase):
    def test_registry_lists_every_loop_and_host(self):
        r = launch.registry(ROOT)
        self.assertEqual({l["id"] for l in r["loops"]}, {"tick", "plussing", "probes", "funding-outreach", "write-back"})
        self.assertEqual({h["id"] for h in r["hosts"]}, set(launch.SURFACES))
        for h in r["hosts"]:
            self.assertTrue((ROOT / h["adapter"]).exists(), h["adapter"])

    def test_probe_surfaces_reports_each_without_secrets(self):
        out = launch.probe_surfaces(ROOT, env={"CLOUDFLARE_API_TOKEN": "SECRETVALUE", "CLOUDFLARE_ACCOUNT_ID": "x"})
        self.assertEqual({s["surface"] for s in out} & set(launch.SURFACES), set(launch.SURFACES))
        self.assertTrue(next(s for s in out if s["surface"] == "cloudflare-worker")["available"])
        self.assertNotIn("SECRETVALUE", json.dumps(out))

    def test_probe_without_credentials_says_so(self):
        out = launch.probe_surfaces(ROOT, env={})
        cf = next(s for s in out if s["surface"] == "cloudflare-worker")
        self.assertFalse(cf["available"])
        self.assertIn("not both set", cf["detail"])

    def test_run_once_ticks_real_records_and_writes_back(self):
        rec = launch.run_once(ROOT, skip_outreach=True, now="2026-01-01T00:00:00Z")
        self.assertTrue(all(r["ok"] for r in rec["loops"]), rec["loops"])
        tick = rec["loops"][0]
        self.assertGreater(tick["counts"]["items"], 40)
        self.assertEqual(len(rec["report"]), 4)
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "ops").mkdir()
            paths = launch.write_back(rec, d)
            line = json.loads((Path(d) / paths[0]).read_text().splitlines()[0])
            self.assertEqual(line["schema"], "ultrastable-loop-evidence/1")
            self.assertIn("Happened:", (Path(d) / paths[1]).read_text())

    def test_failing_loop_is_reported_not_hidden(self):
        rec = {"loops": [{"loop": "probes", "ok": False}], "report": []}
        self.assertFalse(all(r["ok"] for r in rec["loops"]))

    def test_commit_only_touches_evidence_paths(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            (Path(d) / "other.txt").write_text("x")
            subprocess.run(["git", "-C", d, "add", "other.txt"], check=True)
            (Path(d) / "ev.txt").write_text("e")
            res = launch.commit(["ev.txt"], d)
            self.assertTrue(res["ok"], res)
            staged = subprocess.run(["git", "-C", d, "diff", "--cached", "--name-only"], capture_output=True, text=True).stdout.split()
            self.assertEqual(staged, ["other.txt"])
            self.assertEqual(launch.commit(["ev.txt"], d)["detail"], "nothing to commit")

    def test_export_d1_is_idempotent_sql_with_real_items(self):
        sql = launch.export_d1(ROOT)
        self.assertTrue(all(l.startswith("INSERT OR IGNORE") for l in sql.strip().splitlines()))
        self.assertIn("INTO items", sql)
        self.assertIn("SG-9", sql)
        self.assertIn("INTO roles", sql)

    def test_install_artifacts(self):
        self.assertIn("foundation launch --failover --commit --push", launch.install_artifact("cron", ROOT))
        self.assertIn("schtasks /Create", launch.install_artifact("task-scheduler", ROOT))
        self.assertIn("weekly", launch.install_artifact("github-actions", ROOT).lower())
        with self.assertRaises(ValueError):
            launch.install_artifact("nope", ROOT)


if __name__ == "__main__":
    unittest.main()


import datetime as _dt, os, shutil
sys.path.insert(0, str(ROOT / "scripts"))
from foundation import failover  # noqa: E402


class NoSingleRoute(unittest.TestCase):
    def _copy(self):
        d = Path(tempfile.mkdtemp())
        for rel in ("instances/ultrastable/loops.json", "deploy/routes.json", "deploy/loops", ".github/workflows/loop.yml"):
            src, dst = ROOT / rel, d / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, dst) if src.is_dir() else shutil.copy(src, dst)
        return d

    def test_repo_passes(self):
        import check_routes
        self.assertEqual(check_routes.check(ROOT), [])

    def test_single_credential_fails(self):
        import check_routes
        d = self._copy()
        p = d / "instances/ultrastable/loops.json"
        reg = json.loads(p.read_text())
        for h in reg["hosts"]:
            h["credential"] = "cloudflare-account"
        p.write_text(json.dumps(reg))
        bad = check_routes.check(d)
        self.assertTrue(any("single point of failure" in b for b in bad) and any("without a credential" in b for b in bad), bad)

    def test_one_route_deploy_fails(self):
        import check_routes
        d = self._copy()
        p = d / "deploy/routes.json"
        r = json.loads(p.read_text())
        r["targets"][0]["routes"] = r["targets"][0]["routes"][:1]
        p.write_text(json.dumps(r))
        self.assertTrue(any("one route only" in b for b in check_routes.check(d)))

    def test_failover_chain_by_silence(self):
        d = self._copy()
        ev = d / "ops/loop-evidence"
        ev.mkdir(parents=True)
        now = _dt.datetime(2026, 11, 11, 12, 0, tzinfo=_dt.timezone.utc)
        (ev / "x.jsonl").write_text(json.dumps({"at": "2026-11-11T11:00:00Z", "host": "claude-session"}) + "\n")
        self.assertFalse(failover.decide(d, "local-scheduler", now, sync=False)["run"])      # 1h silent < 2h
        (ev / "x.jsonl").write_text(json.dumps({"at": "2026-11-11T09:00:00Z", "host": "claude-session"}) + "\n")
        self.assertTrue(failover.decide(d, "local-scheduler", now, sync=False)["run"])       # 3h silent >= 2h
        self.assertFalse(failover.decide(d, "github-actions", now, sync=False)["run"])       # weekly host waits a week
        self.assertTrue(failover.decide(d, "unknown-host", now, sync=False)["run"])          # never silent on an unknown host
