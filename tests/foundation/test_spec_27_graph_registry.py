# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""US-SPEC-27 (knowledge graph, vector space and connection engine): the platform check `python3 -m foundation datagraph` as a requirement of the specification.

US-27-R61 every system has a registry row; US-27-R62 the vendored copy, the migration and the wiring cannot drift; US-27-R63 a deploy is confirmed live by reading the graph."""
import json, shutil, unittest
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import datagraph

REPO = Path(__file__).resolve().parents[2]
POL = json.loads((REPO / datagraph.POLICY).read_text())
FILES = [datagraph.POLICY, "instances/ultrastable/progress.json", "doctrine/tenant-repos.json", "seed/worker/src/index.js", "seed/worker/migrations/index.json",
         datagraph.RESEARCH, POL["core_module"], POL["seed_vendor"], POL["seed_step"], POL["migration"], *POL["rule_files"], "seed/worker/src/knowledge.js"] \
    + [f"docs/issues/{r['item']}.json" for r in POL["systems"].values() if r.get("item")]


class Spec27Registry(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for f in FILES:
            (self.tmp / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REPO / f, self.tmp / f)

    def edit_json(self, rel, fn):
        p = self.tmp / rel
        d = json.loads(p.read_text())
        fn(d)
        p.write_text(json.dumps(d))

    def edit_text(self, rel, fn):
        p = self.tmp / rel
        p.write_text(fn(p.read_text()))

    def bad(self):
        return datagraph.check(self.tmp)

    def test_us_27_r61_the_repository_passes_and_every_live_system_has_a_row(self):
        """US-27-R61: the repository passes and every live system has a row."""
        self.assertEqual(datagraph.check(REPO), [])
        progress = {s["id"] for s in json.loads((REPO / "instances/ultrastable/progress.json").read_text()).get("systems", [])}
        tenants = {k for k, v in json.loads((REPO / "doctrine/tenant-repos.json").read_text()).get("tenants", {}).items() if v.get("state") not in ("planned", "retired")}
        self.assertTrue((progress | tenants) <= set(POL["systems"]), sorted((progress | tenants) - set(POL["systems"])))
        for row in POL["systems"].values():
            self.assertIn(row["state"], ("seed-step", "pending", "built"))

    def test_us_27_r61_a_system_without_a_row_a_bad_state_or_a_pending_row_without_an_item_fails(self):
        """US-27-R61: a system without a row, a bad state or a pending row without its item fails."""
        self.edit_json(datagraph.POLICY, lambda d: d["systems"].pop("unlearn"))
        self.assertTrue(any("system unlearn has no row" in b for b in self.bad()))
        self.edit_json(datagraph.POLICY, lambda d: d["systems"].update({"unlearn": {"state": "someday"}}))
        self.assertTrue(any("unlearn: state 'someday' is not seed-step, pending or built" in b for b in self.bad()))
        self.edit_json(datagraph.POLICY, lambda d: d["systems"].update({"unlearn": {"state": "pending", "item": "Q-KG-nope"}}))
        self.assertTrue(any("unlearn: pending with no queue item docs/issues/Q-KG-nope.json" in b for b in self.bad()))
        self.edit_json("instances/ultrastable/progress.json", lambda d: d["systems"].append({"id": "newbie", "repo": "x/y"}))
        self.assertTrue(any("system newbie has no row" in b and "pending row with a queue item" in b for b in self.bad()))

    def test_us_27_r61_a_built_system_on_the_shared_engine_must_vendor_it_where_its_row_says(self):
        """US-27-R61: a built system on the shared engine must vendor it where its row says."""
        self.edit_json("doctrine/tenant-repos.json", lambda d: d["tenants"]["unlearn"]["vendor"].update({"seed/worker/src/knowledge.js": "vendor/elsewhere.js"}))
        self.assertTrue(any("unlearn: doctrine/tenant-repos.json does not vendor seed/worker/src/knowledge.js to vendor/ultrastable/knowledge.js" in b for b in self.bad()))
        (self.tmp / "seed/worker/src/knowledge.js").unlink()
        self.assertTrue(any("engine seed/worker/src/knowledge.js is missing" in b for b in self.bad()))

    def test_us_27_r62_the_seed_copy_of_the_core_module_is_byte_identical_under_one_vendored_header(self):
        """US-27-R62: the seed copy of the core module is byte-identical under one vendored header."""
        vend = self.tmp / POL["seed_vendor"]
        head, _, body = vend.read_text().partition("\n")
        self.assertTrue(head.startswith(datagraph.VENDOR_HEAD))
        self.assertEqual(body, (REPO / POL["core_module"]).read_text())
        self.edit_text(POL["seed_vendor"], lambda t: t + "\n// local edit\n")
        self.assertTrue(any("differs from workers/core/datagraph/index.js" in b for b in self.bad()))
        self.edit_text(POL["seed_vendor"], lambda t: "// copied by hand\n" + t.partition("\n")[2])
        self.assertTrue(any("one-line VENDORED header" in b for b in self.bad()))
        (self.tmp / POL["core_module"]).unlink()
        self.assertEqual(self.bad(), [f"{POL['core_module']} is missing"])

    def test_us_27_r62_the_migration_holds_every_statement_of_the_workers_own_ddl_and_is_listed(self):
        """US-27-R62: the migration holds every statement of the Worker's own DDL and is listed."""
        self.edit_text(POL["migration"], lambda t: t.replace("CREATE TABLE IF NOT EXISTS kg_runs", "CREATE TABLE IF NOT EXISTS kg_runs_renamed"))
        self.assertTrue(any("does not hold every statement of DATAGRAPH_DDL" in b for b in self.bad()))
        self.edit_text(POL["migration"], lambda t: t.replace("CREATE TABLE IF NOT EXISTS kg_runs_renamed", "CREATE TABLE IF NOT EXISTS kg_runs"))
        self.assertEqual(self.bad(), [])
        self.edit_json("seed/worker/migrations/index.json", lambda d: d.remove(Path(POL["migration"]).name))
        self.assertTrue(any("is not listed in migrations/index.json" in b for b in self.bad()))
        (self.tmp / POL["migration"]).unlink()
        self.assertTrue(any(f"{POL['migration']} is missing" in b for b in self.bad()))

    def test_us_27_r62_the_tick_loop_and_every_public_route_are_wired_and_the_rule_and_research_are_carried(self):
        """US-27-R62: the tick loop and every public route are wired, and the rule and the research record are carried."""
        self.edit_text("seed/worker/src/index.js", lambda t: t.replace("b('knowledge-graph', () => datagraphStep(", "b('kg-off', () => datagraphStep("))
        self.assertTrue(any("does not run the knowledge-graph step" in b for b in self.bad()))
        for ep in POL["endpoints"]:
            self.setUp()
            self.edit_text("seed/worker/src/index.js", lambda t, ep=ep: t.replace(f"'{ep}'", "'/gone'"))
            self.assertTrue(any(f"does not serve {ep}" in b for b in self.bad()), ep)
        self.setUp()
        self.edit_text(POL["rule_files"][0], lambda t: t.replace("DATAGRAPH-1", "DATA-GRAPH"))
        self.assertTrue(any(f"{POL['rule_files'][0]} does not carry DATAGRAPH-1" in b for b in self.bad()))
        (self.tmp / datagraph.RESEARCH).unlink()
        self.assertTrue(any(f"{datagraph.RESEARCH} is missing" in b for b in self.bad()))

    def test_us_27_r63_a_probe_reading_is_live_only_with_a_200_a_true_flag_and_nodes(self):
        """US-27-R63: a probe reading is live only with a 200, a true flag and nodes."""
        ok = lambda s, b: datagraph.reading(s, b)[0]
        self.assertTrue(ok(200, '{"ok": true, "nodes": 357, "last_run_hours_ago": 1}'))
        self.assertFalse(ok(503, '{"ok": false, "nodes": 357}'), "a stale graph answers 503 with nodes: not live")
        self.assertFalse(ok(200, '{"ok": true, "nodes": 0}'), "a graph with no nodes is not live")
        self.assertFalse(ok(200, '{"ok": false, "nodes": 4}'))
        self.assertTrue(ok(200, '{"built": true, "last": {"nodes": 12}}'))
        self.assertFalse(ok(200, '{"built": false, "last": null}'))
        self.assertFalse(ok(200, '{"built": true, "last": {"nodes": 0}}'))
        self.assertFalse(ok(0, "refused"), "a probe that cannot be reached is not live")
        self.assertEqual(datagraph.reading(200, "<html>")[1], "HTTP 200, not JSON")
        self.assertEqual(datagraph.reading(200, "[1]")[1], "HTTP 200, unexpected JSON")

    def test_us_27_r63_every_system_is_read_through_its_probe_or_public_api_and_one_with_neither_is_not_live(self):
        """US-27-R63: every system is read through its probe or public API, and one with neither is not live."""
        urls = []
        rows = datagraph.live(REPO, get=lambda url: urls.append(url) or (200, '{"ok": true, "nodes": 1}'))
        self.assertEqual({r["id"] for r in rows}, set(POL["systems"]))
        self.assertTrue(all(r["ok"] for r in rows))
        for sid, row in POL["systems"].items():
            self.assertIn(row.get("probe") or row.get("public_api"), urls, sid)
        self.edit_json(datagraph.POLICY, lambda d: d["systems"]["unlearn"].pop("probe"))
        out = {r["id"]: r for r in datagraph.live(self.tmp, get=lambda url: (200, '{"ok": true, "nodes": 1}'))}
        self.assertFalse(out["unlearn"]["ok"])
        self.assertIn("no probe or public_api", out["unlearn"]["why"])
        down = datagraph.live(REPO, get=lambda url: (503, '{"ok": false, "nodes": 9}'))
        self.assertFalse(any(r["ok"] for r in down))

    def test_us_27_t07_a_missing_row_a_drifted_vendor_copy_and_an_unwired_step_each_fail_the_platform_check_and_the_repository_passes(self):
        """US-27-T07: pass when the repository is clean; fail on each of the three breakages named."""
        self.assertEqual(self.bad(), [])
        self.edit_json(datagraph.POLICY, lambda d: d["systems"].pop("unlearn"))
        self.assertTrue(any("has no row" in b for b in self.bad()))
        self.setUp()
        self.edit_text(POL["seed_vendor"], lambda t: t + "\n// local edit\n")
        self.assertTrue(any("differs" in b for b in self.bad()))
        self.setUp()
        self.edit_text("seed/worker/src/index.js", lambda t: t.replace("b('knowledge-graph'", "b('kg-off'"))
        self.assertTrue(any("knowledge-graph step" in b for b in self.bad()))


if __name__ == "__main__":
    unittest.main()
