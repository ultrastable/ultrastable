"""SYS-1: the topology is consistent, renders deployable configs, hides no secrets, and drift finds differences (fake account, no network)."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import topology as T  # noqa: E402


class Topology(unittest.TestCase):
    def test_declaration_is_consistent(self):
        self.assertEqual(T.check(), [])

    def test_render_every_worker_with_live_bindings_only(self):
        with tempfile.TemporaryDirectory() as d:
            files = T.render(T.REPO, d)
            self.assertEqual(len(files), len(T.load()["workers"]))
            site = json.loads((Path(d) / "ultrastable-site.json").read_text())
            self.assertIn({"binding": "OWNER", "service": "ultrastable-dashboard"}, site["services"])
            self.assertEqual(site["d1_databases"][0]["database_name"], "ultrastable-ops")
            tick = json.loads((Path(d) / "ultrastable-tick.json").read_text())
            self.assertNotIn("queues", tick)  # the queue is planned, so it is pending, not rendered
            self.assertTrue(any("ultrastable-work" in p for p in tick["_pending"]))

    def test_no_secret_or_address_values(self):
        t = T.load()
        t["workers"][1]["bindings"]["vars"] = {"X": "someone@example.com"}
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "doctrine").mkdir()
            (Path(d) / T.PATH).write_text(json.dumps(t))
            self.assertTrue(any("looks like a secret" in b for b in T.check(d)))

    def test_undeclared_reference_is_caught(self):
        t = T.load()
        t["workers"][0]["bindings"]["d1"]["DB"] = "ultrastable-nope"
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "doctrine").mkdir()
            (Path(d) / T.PATH).write_text(json.dumps(t))
            self.assertTrue(any("ultrastable-nope" in b for b in T.check(d)))

    def test_drift_reports_missing_undeclared_and_undeployed_bindings(self):
        t = T.load()
        def fetch(path):
            if path.startswith("d1"):
                return {"result": [{"name": "ultrastable-ops"}, {"name": "ultrastable-stray"}]}
            if path.startswith("workers/scripts/") and path.endswith("/settings"):
                return {"result": {"bindings": [{"type": "d1", "name": "DB"}]}}
            if path.startswith("workers/scripts"):
                return {"result": [{"id": "ultrastable-site"}, {"id": "ultrastable-extra"}]}
            return {"result": []}
        d = T.drift(T.REPO, token="x", fetch=fetch)
        joined = "\n".join(d)
        self.assertIn("d1 ultrastable-org is declared live but missing", joined)
        self.assertIn("d1 ultrastable-stray exists in the account but is not declared", joined)
        self.assertIn("worker ultrastable-extra exists in the account but is not declared", joined)
        self.assertIn("binding OWNER (service) is declared but not deployed", joined)
        self.assertNotIn("ultrastable-work", joined)  # planned and absent is not drift

    def test_system_json_is_generated_from_the_topology(self):
        self.assertEqual(json.loads((T.REPO / "doctrine/system.json").read_text(encoding="utf-8")), T.emit_system())
        self.assertEqual(json.loads((T.REPO / "doctrine/system.json").read_text(encoding="utf-8"))["resources"]["d1"]["org"]["id"], "7468898a-b515-495f-9910-e91cb80f5810")

    def test_deploy_script_reads_the_same_declaration(self):
        src = (T.REPO / "deploy/deploy-site.mjs").read_text(encoding="utf-8")
        self.assertIn("doctrine/topology.json", src)
        self.assertIn("topologyBindings(\"ultrastable-site\")", src)

    def test_every_live_worker_is_deployed_and_verified_by_a_workflow(self):
        """DEPLOY-ALL-1: a live worker with no deploy path drifts (the tick sat on a 11-day-old build)."""
        t = T.load()
        wf = (T.REPO / ".github/workflows")
        text = "\n".join(p.read_text(encoding="utf-8") for p in wf.glob("deploy-*.yml"))
        src = (T.REPO / "deploy/deploy-workers.mjs").read_text(encoding="utf-8")
        own = {"ultrastable-site": "deploy-site.mjs", "ultrastable-agents": "deploy-system.mjs"}
        for w in t["workers"]:
            if w["state"] != "live" or w.get("retire_candidate"):
                continue
            if w["id"] in own:
                self.assertIn(own[w["id"]], text)
            else:
                self.assertIn("deploy-workers.mjs", text)
        self.assertIn("live code matches", src)
        lane = (T.REPO / "scripts/lane.sh").read_text(encoding="utf-8")
        self.assertIn("dispatched deploy-workers", lane)  # lane merges fire no push events


if __name__ == "__main__":
    unittest.main()
