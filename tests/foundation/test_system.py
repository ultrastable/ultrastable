"""SYSTEM-1: the system data renders to wrangler configs that match the files, link by service binding and queue, and bind the AI route."""
import copy, json, unittest
from pathlib import Path
from foundation import system

REPO = Path(__file__).resolve().parents[2]


class System(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(system.check(REPO), [])

    def test_links_everything(self):
        d = system.load(REPO)
        tick = system.render_worker(d, "ultrastable-tick")
        for k in ("d1_databases", "ai", "kv_namespaces", "queues", "vectorize", "services", "triggers"):
            self.assertIn(k, tick)
        self.assertIn("AGENTS", {s["binding"] for s in tick["services"]})
        self.assertEqual(system.render_worker(d, "ultrastable-agents")["ai"]["binding"], "AI")

    def test_unknown_service_and_orphan_queue_fail(self):
        d = copy.deepcopy(system.load(REPO)); d["workers"]["ultrastable-site"]["bindings"]["services"]["X"] = "ghost"
        d["workers"]["ultrastable-tick"]["bindings"]["queue_consumers"] = []
        import tempfile, shutil
        with tempfile.TemporaryDirectory() as t:
            r = Path(t); shutil.copytree(REPO / "doctrine", r / "doctrine"); shutil.copytree(REPO / "instances", r / "instances")
            for w in d["workers"].values():
                (r / w["main"]).parent.mkdir(parents=True, exist_ok=True); (r / w["main"]).write_text("x")
            (r / "doctrine/system.json").write_text(json.dumps(d))
            bad = "\n".join(system.check(r))
        self.assertIn("unknown worker ghost", bad); self.assertIn("needs a producer and a consumer", bad)


if __name__ == "__main__":
    unittest.main()
