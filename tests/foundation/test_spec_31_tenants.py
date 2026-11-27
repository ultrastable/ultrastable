# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-31, tenants: admission, isolation, health, the tenant repository standard, vendoring and the two-way sync. Each test names the requirement it proves."""
import copy, datetime as dt, hashlib, importlib.util, json, shutil, tempfile, types, unittest
from pathlib import Path
from unittest import mock

from foundation import admit, owndb, tenantcontrols, tenantrepos, tenantstd as T, tenantsync
from _repo import scratch

ROOT = Path(__file__).resolve().parents[2]
STD = json.loads((ROOT / T.STD_CORE).read_text())
UUID1, UUID2, UUID3 = ("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333")


def tmp(test):
    d = tempfile.TemporaryDirectory()
    test.addCleanup(d.cleanup)
    return Path(d.name)


def put(root, rel, data):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(data if isinstance(data, str) else json.dumps(data, indent=1) + "\n", encoding="utf-8")


def load_tool(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Registry(unittest.TestCase):
    def world(self, tenants, workers=(), extra=None):
        d = tmp(self)
        put(d, "doctrine/tenant-repos.json", {"org": "ultrastable", "tenants": tenants})
        put(d, "doctrine/topology.json", {"workers": list(workers)})
        for rel in extra or {}:
            (d / rel).mkdir(parents=True, exist_ok=True)
        return d

    def test_US_31_R01_a_tenant_is_a_registry_row_with_a_known_state_and_a_repository_in_the_org(self):
        d = self.world({"a": {"repo": "ultrastable/a", "state": "bogus", "frontend": "https://a.example"}, "b": {"repo": "other/b", "state": "planned"}})
        errs = tenantrepos.check(d)
        self.assertIn("a: state must be one of ['moved', 'moving', 'own-repo', 'planned', 'retired']", errs)
        self.assertIn("b: repo must be in the ultrastable organization", errs)
        ok = self.world({"a": {"repo": "ultrastable/a", "state": "own-repo", "frontend": "https://a.example"}})
        self.assertEqual(tenantrepos.check(ok), [])
        self.assertEqual(tenantrepos.STATES, {"own-repo", "moving", "moved", "planned", "retired"})
        self.assertEqual([t["slug"] for t in tenantrepos.missing({"tenants": {"a": {"state": "moved"}, "b": {"state": "planned"}, "c": {"state": "moving"}}})], ["b", "c"])

    def test_US_31_R02_a_moved_tenant_leaves_no_code_in_the_core_and_unregistered_tenant_code_is_a_finding(self):
        d = self.world({"m": {"repo": "ultrastable/m", "state": "moved", "frontend": "https://m.example"}},
                       [{"id": "w-y", "state": "live", "routes": ["y.example"], "main": "instances/y/worker/index.js"},
                        {"id": "w-z", "state": "live", "routes": ["z.example"], "source": {"repo": "ultrastable/nobody"}}],
                       ["instances/m/worker", "instances/x/worker"])
        errs = "\n".join(tenantrepos.check(d))
        self.assertIn("m: moved to ultrastable/m but instances/m/worker is still in the core", errs)
        self.assertIn("instances/x: tenant code lives in the core; register it", errs)
        self.assertIn("topology w-y: builds from instances/y/worker/index.js in the core", errs)
        self.assertIn("topology w-z: source ultrastable/nobody is not the registered repository of a tenant", errs)

    def test_US_31_R02_a_moved_tenant_with_a_worker_must_be_built_by_the_core_from_its_own_repository(self):
        tenants = {"m": {"repo": "ultrastable/m", "state": "moved", "worker": "w-m", "sandbox": {"stores": [], "secrets": [], "budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}
        bad = self.world(tenants, [{"id": "w-m", "state": "live", "routes": ["m.example"]}])
        self.assertIn("m: moved, but topology w-m does not build from ultrastable/m (the core's second deploy route)", tenantrepos.check(bad))
        good = self.world(tenants, [{"id": "w-m", "state": "live", "routes": ["m.example"], "source": {"repo": "ultrastable/m"}}])
        self.assertEqual(tenantrepos.check(good), [])

    def test_US_31_R03_every_deployed_tenant_names_a_live_public_front_end(self):
        bud = {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}
        d = self.world({"nofront": {"repo": "ultrastable/nofront", "state": "own-repo"},
                        "dead": {"repo": "ultrastable/dead", "state": "own-repo", "worker": "w-dead", "sandbox": {"budget": bud}},
                        "plan": {"repo": "ultrastable/plan", "state": "planned"}, "gone": {"repo": "ultrastable/gone", "state": "retired"}},
                       [{"id": "w-dead", "state": "planned", "routes": ["dead.example"]}])
        errs = tenantrepos.check(d)
        self.assertTrue(any(e.startswith("nofront: no deployed public front end") for e in errs), errs)
        self.assertTrue(any(e.startswith("dead: worker w-dead is not a live topology Worker with a public route") for e in errs), errs)
        self.assertFalse(any(e.startswith(("plan:", "gone:")) for e in errs), "a planned or retired tenant has nothing deployed to check")

    def test_US_31_R04_a_tenant_worker_touches_only_its_own_stores_secrets_and_budget(self):
        reg = {"tenants": {"s": {"repo": "ultrastable/s", "state": "moved", "worker": "w-s",
                                 "sandbox": {"stores": ["ultrastable-s", "shared-db"], "secrets": ["K1"], "budget": {"requests_per_day": 10, "d1_reads_per_day": 0, "ai_neurons_per_day": 5}}}}}
        topo = {"workers": [{"id": "w-s", "bindings": {"d1": {"DB": "ultrastable-s", "X": "core-db"}, "services": {"SVC": "core-worker"}, "secrets": ["K1", "K2"]}}]}
        errs = "\n".join(tenantrepos.isolation(tmp(self), reg, topo))
        self.assertIn("s: sandbox store shared-db is not named for the tenant (ultrastable-s*)", errs)
        self.assertIn("s: worker w-s binds core-db, which is not in its sandbox (no shared stores)", errs)
        self.assertIn("binds services ['core-worker']; a tenant reaches the core only over its public API", errs)
        self.assertIn("uses secrets outside its scope: ['K2']", errs)
        self.assertIn("s: sandbox needs a daily budget (requests_per_day, d1_reads_per_day, ai_neurons_per_day)", errs)
        clean = {"tenants": {"s": {"repo": "ultrastable/s", "state": "moved", "worker": "w-s", "sandbox": {"stores": ["ultrastable-s"], "secrets": ["K1"], "budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}}
        topo_ok = {"workers": [{"id": "w-s", "bindings": {"d1": {"DB": "ultrastable-s"}, "secrets": ["K1"]}}]}
        self.assertEqual(tenantrepos.isolation(tmp(self), clean, topo_ok), [])

    def test_US_31_R05_no_core_worker_binds_a_tenant_store_and_every_tenant_database_is_sampled_against_its_budget(self):
        reg = {"tenants": {"s": {"repo": "ultrastable/s", "state": "moved", "worker": "w-s", "sandbox": {"stores": ["ultrastable-s"], "secrets": [], "budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}}
        topo = {"workers": [{"id": "w-s", "bindings": {"d1": {"DB": "ultrastable-s"}}}, {"id": "w-core", "bindings": {"d1": {"DB": "ultrastable-s"}}}]}
        d = tmp(self)
        put(d, "instances/ultrastable/cost-budgets.json", {"budgets": [{"database_name": "something-else"}]})
        errs = "\n".join(tenantrepos.isolation(d, reg, topo))
        self.assertIn("core worker w-core binds ultrastable-s, which belongs to tenant s", errs)
        self.assertIn("s: D1 ultrastable-s has no row in instances/ultrastable/cost-budgets.json, so its budget is never sampled", errs)
        put(d, "instances/ultrastable/cost-budgets.json", {"budgets": [{"database_name": "ultrastable-s"}]})
        self.assertNotIn("never sampled", "\n".join(tenantrepos.isolation(d, reg, topo)))

    def test_US_31_R09_a_tenant_is_healthy_only_when_it_says_ok_and_no_part_it_reports_says_otherwise(self):
        self.assertEqual(tenantrepos.health_problems({"ok": True, "evidence": {"ok": True}}), [])
        bad = tenantrepos.health_problems({"ok": False, "clock": "stopped", "last_error": "boom", "evidence": {"ok": False, "n": 0}})
        self.assertEqual(len(bad), 2)
        self.assertIn("ok is False", bad[0])
        self.assertTrue(bad[1].startswith("evidence not ok"))
        self.assertEqual(tenantrepos.health_problems(["not", "an", "object"]), ["/health is not a JSON object"])
        d = self.world({"a": {"repo": "ultrastable/a", "state": "moved", "worker": "w-a"}, "b": {"repo": "ultrastable/b", "state": "own-repo", "worker": "w-b"},
                        "c": {"repo": "ultrastable/c", "state": "planned", "worker": "w-c"}}, [{"id": "w-a", "routes": ["a.example"]}])
        seen = []
        def fetch(url):
            seen.append(url)
            if "w-b" in url:
                raise OSError("down")
            return {"ok": True}
        out = tenantrepos.health(d, fetch)
        self.assertEqual(seen, ["https://a.example/health", "https://w-b.ultrastable.workers.dev/health"])
        self.assertEqual((out["a"]["ok"], out["b"]["ok"]), (True, False))
        self.assertTrue(out["b"]["problems"][0].startswith("unreadable: OSError"), "an unreadable tenant is a failure, never a pass")
        self.assertNotIn("c", out)

    def test_US_31_R10_a_moved_tenant_is_behind_when_its_main_is_not_the_commit_the_last_live_verified_deploy_carried(self):
        d = self.world({"a": {"repo": "ultrastable/a", "state": "moved", "worker": "w-a"}, "b": {"repo": "ultrastable/b", "state": "own-repo", "worker": "w-b"}})
        rows = [{"worker": "w-a", "live_matches_commit": True, "source_sha": "old"}, "not json at all", {"worker": "w-a", "live_matches_commit": False, "source_sha": "unverified"},
                {"worker": "w-a", "live_matches_commit": True, "source_sha": "s1"}, {"worker": "w-b", "live_matches_commit": True, "source_sha": "b1"}]
        put(d, "ops/deploys.jsonl", "\n".join(r if isinstance(r, str) else json.dumps(r) for r in rows) + "\n")
        self.assertEqual(tenantrepos.last_deployed(d, "w-a"), "s1")
        self.assertEqual(tenantrepos.last_deployed(d, "nobody"), "")
        self.assertEqual(tenantrepos.behind(d, head=lambda repo: "s2"), ["w-a"], "only a moved tenant is redeployed from here")
        self.assertEqual(tenantrepos.behind(d, head=lambda repo: "s1"), [])
        self.assertEqual(tenantrepos.behind(d, head=lambda repo: ""), [], "a main that cannot be read is not read as behind")


class Controls(unittest.TestCase):
    def test_US_31_R12_the_hosted_tier_stays_closed_while_any_control_is_unproven_and_a_gated_control_is_never_work_for_a_model(self):
        rec = tenantcontrols.evaluate(ROOT)
        self.assertEqual(rec["hosted_tier"], "ready to offer" if not rec["unproven"] else "closed")
        self.assertEqual(rec["proven"] + len(rec["unproven"]), rec["total"])
        for c in rec["controls"]:
            self.assertEqual(c["status"] == "proven", all(p["passes"] for p in c["probes"]), c["id"])
            if c["status"] == "unproven" and c.get("gate"):
                self.assertIn(c["gate"], {g["id"] for g in json.loads((ROOT / "doctrine/open-loops.json").read_text())["gates"]})
        hosted = next(o for o in json.loads((ROOT / tenantcontrols.PILOT).read_text())["options"] if o["id"] == "hosted")
        if rec["unproven"]:
            self.assertTrue(hosted["status"].startswith("deferred"), hosted["status"])
        d = tmp(self)
        put(d, tenantcontrols.DEFS, {"controls": [{"id": "gated", "obligation": "a legal text", "owner": "product-manager", "probes": ["file:nope.txt"], "gate": "g1"}]})
        put(d, tenantcontrols.PILOT, {"options": [{"id": "hosted", "status": "offered"}]})
        put(d, "doctrine/open-loops.json", {"gates": []})
        (d / "docs/issues").mkdir(parents=True)
        wrote = tenantcontrols.write(d)
        self.assertEqual((wrote["hosted_tier"], wrote["filed"]), ("closed", []))
        bad = tenantcontrols.check(d)
        self.assertTrue(any("its gate g1 is not in doctrine/open-loops.json" in b for b in bad), bad)
        self.assertTrue(any("the hosted option is offered ('offered') while controls are unproven: gated" in b for b in bad), bad)


class OwnDatabase(unittest.TestCase):
    def record(self, d, bound):
        put(d, owndb.PATH, {"account": {"id": "acc", "name": "core"}, "core": [{"name": "core-db", "id": UUID1, "binding": "DB", "holds": "", "bound_by": bound}],
                            "tenant": [{"name": "ultrastable-t", "id": UUID2}], "live": {"databases": [{"name": "core-db", "id": UUID1}]}})

    def test_US_31_R13_a_core_config_binds_only_declared_core_databases_never_a_tenants_or_the_originating_fleets(self):
        d = tmp(self)
        self.record(d, ["wrangler.toml"])
        put(d, "wrangler.toml", f'[[d1_databases]]\nbinding = "DB"\ndatabase_name = "core-db"\ndatabase_id = "{UUID1}"\n')
        self.assertEqual(owndb.check(d), [])
        put(d, "wrangler.toml", f'[[d1_databases]]\nbinding = "DB"\ndatabase_name = "ultrastable-t"\ndatabase_id = "{UUID2}"\n')
        self.assertTrue(any("binds tenant database ultrastable-t: a core Worker never binds a tenant's database" in e for e in owndb.check(d)))
        put(d, "doctrine/single-account.json", {"required_account": {"id": "acc"}, "forbidden": [{"pattern": UUID3, "id": "originating fleet"}]})
        put(d, "wrangler.toml", f'[[d1_databases]]\nbinding = "DB"\ndatabase_name = "other"\ndatabase_id = "{UUID3}"\n')
        self.assertTrue(any("a database of the originating fleet" in e for e in owndb.check(d)))
        put(d, "wrangler.toml", 'database_name = "core-db"\ndatabase_id = "filled at deploy"\n')
        self.assertTrue(any("bound_by is stale" in e for e in owndb.check(d)), "a placeholder binding is not a binding")

    def test_US_31_R13_the_live_reading_is_unmeasured_without_a_credential_and_never_ok_without_a_reading(self):
        d = tmp(self)
        self.record(d, [])
        self.assertEqual(owndb.live(d, env={})[0], 2)
        got = {}
        def get(url, tok):
            got["tok"] = tok
            return {"result": [{"uuid": UUID1, "name": "core-db"}]}
        self.assertEqual(owndb.live(d, env={"CLOUDFLARE_API_TOKEN": "t"}, get=get)[0], 0)
        self.assertEqual(got["tok"], "t")
        self.assertEqual(owndb.live(d, env={"CLOUDFLARE_API_TOKEN": "t"}, get=lambda u, t: {"result": []})[0], 1)
        def boom(u, t):
            raise OSError("no route")
        self.assertEqual(owndb.live(d, env={"CLOUDFLARE_API_TOKEN": "t"}, get=boom)[0], 2)


class Admission(unittest.TestCase):
    FILES = ["doctrine/tenant-repos.json", "doctrine/topology.json", "doctrine/stakeholders.json", "doctrine/admission.json", "doctrine/tenant-promotion.json",
             "social/gate.json", "github/org-settings.json", "doctrine/clocks.json", "instances/ultrastable/progress.json", "instances/ultrastable/cost-budgets.json"]

    def setUp(self):
        self.d = tmp(self)
        for f in self.FILES:
            (self.d / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / f, self.d / f)
        (self.d / "instances/ultrastable/system").mkdir(parents=True, exist_ok=True)

    def j(self, rel):
        return json.loads((self.d / rel).read_text())

    def add_tenant(self, state="moved", **extra):
        reg = self.j("doctrine/tenant-repos.json")
        reg["tenants"]["spec-tenant"] = {"repo": "ultrastable/spec-tenant", "state": state, "worker": "ultrastable-spec-tenant", "description": "Spec Tenant: a test tenant.", **extra}
        put(self.d, "doctrine/tenant-repos.json", reg)
        topo = self.j("doctrine/topology.json")
        topo["workers"].append({"id": "ultrastable-spec-tenant", "state": "live", "crons": ["7 * * * *"], "routes": ["spec-tenant.ultrastable.org"]})
        put(self.d, "doctrine/topology.json", topo)
        (self.d / "instances/ultrastable/system/ultrastable-spec-tenant.wrangler.jsonc").write_text('{"d1_databases":[{"database_id":"%s"}]}' % UUID3)

    def test_US_31_R06_one_tenant_row_derives_a_row_in_each_of_the_seven_registries(self):
        self.assertEqual(admit.run(ROOT, fix=False), [], "every live tenant of the repository is admitted everywhere")
        self.assertEqual([r["id"] for r in self.j("doctrine/admission.json")["registries"]], ["progress", "promotion", "gate", "org-settings", "showcase", "clock", "budget"])
        self.assertEqual(set(admit.REGISTRIES), {"progress", "promotion", "gate", "org-settings", "showcase", "clock", "budget"})
        self.add_tenant()
        gaps = admit.run(self.d, fix=False)
        self.assertEqual(sorted(g.split(": ")[1].split(" ")[0] for g in gaps if g.startswith("spec-tenant")), ["budget", "clock", "gate", "org-settings", "progress", "promotion", "showcase"])
        admit.run(self.d, fix=True)
        self.assertEqual(admit.run(self.d, fix=False), [])
        row = next(s for s in self.j("instances/ultrastable/progress.json")["systems"] if s["id"] == "spec-tenant")
        self.assertEqual((row["repo"], row["url"], row["expect_hours"], row["heal"]), ("ultrastable/spec-tenant", "https://spec-tenant.ultrastable.org/", 168, ["ci.yml"]))
        self.assertEqual(self.j("social/gate.json")["tenant_queues"].count("https://spec-tenant.ultrastable.org/social-queue.json"), 1)
        self.assertEqual(next(b for b in self.j("instances/ultrastable/cost-budgets.json")["budgets"] if b["id"] == "ultrastable-spec-tenant")["database_id"], UUID3)

    def test_US_31_R06_only_live_states_are_admitted_and_a_tenant_without_a_database_gets_no_clock_or_budget_row(self):
        self.assertEqual(admit.LIVE, ("own-repo", "moving", "moved"))
        reg = self.j("doctrine/tenant-repos.json")
        reg["tenants"]["planned-one"] = {"repo": "ultrastable/planned-one", "state": "planned"}
        put(self.d, "doctrine/tenant-repos.json", reg)
        self.assertNotIn("planned-one", admit.tenants(self.d))
        self.assertFalse(any(g.startswith("planned-one") for g in admit.run(self.d, fix=False)))
        self.add_tenant()
        (self.d / "instances/ultrastable/system/ultrastable-spec-tenant.wrangler.jsonc").unlink()
        admit.run(self.d, fix=True)
        left = [g for g in admit.run(self.d, fix=False) if g.startswith("spec-tenant")]
        self.assertEqual(sorted(g.split(": ")[1].split(" ")[0] for g in left), ["budget", "clock"], "a row is never written with an invented database id")

    def test_US_31_R07_admission_writes_nothing_twice_and_progress_follows_a_tenant_whose_code_moves_to_its_own_repository(self):
        self.add_tenant("moving", source="instances/spec-tenant")
        admit.run(self.d, fix=True)
        prog = lambda: next(s for s in self.j("instances/ultrastable/progress.json")["systems"] if s["id"] == "spec-tenant")
        self.assertEqual((prog()["repo"], prog()["heal"]), ("ultrastable/ultrastable", ["deploy-ultrastable.yml"]))
        self.assertEqual(self.j("doctrine/tenant-promotion.json")["tenants"]["spec-tenant"]["worker_dir"], "instances/spec-tenant/worker")
        before = {f: (self.d / f).read_text() for f in self.FILES}
        admit.run(self.d, fix=True)
        self.assertEqual(before, {f: (self.d / f).read_text() for f in self.FILES}, "a second pass writes nothing")
        reg = self.j("doctrine/tenant-repos.json")
        reg["tenants"]["spec-tenant"]["state"] = "moved"
        put(self.d, "doctrine/tenant-repos.json", reg)
        self.assertTrue(any("is not where the code lives" in g for g in admit.run(self.d, fix=False)))
        admit.run(self.d, fix=True)
        self.assertEqual((prog()["repo"], prog()["heal"]), ("ultrastable/spec-tenant", ["ci.yml"]))

    def test_US_31_R08_the_check_fails_a_registry_without_a_generator_and_an_instruction_file_that_lost_the_rule(self):
        self.add_tenant()
        contract = self.j("doctrine/admission.json")
        contract["registries"].append({"id": "mystery", "file": "x.json", "why": "w"})
        put(self.d, "doctrine/admission.json", contract)
        errs = admit.check(self.d)
        self.assertIn("doctrine/admission.json: registry mystery has no generator in foundation/admit.py", errs)
        self.assertEqual(sorted(e for e in errs if e.endswith("rule ADMIT-1 missing")), [f"{rel}: rule ADMIT-1 missing" for rel in sorted(contract["rule_files"])])
        for rel in contract["rule_files"]:
            put(self.d, rel, "ADMIT-1 is named here\n")
        self.assertFalse(any(e.endswith("rule ADMIT-1 missing") for e in admit.check(self.d)))


def planned(slug="base-rates"):
    """A new tenant's repository as tenant-repos.yml makes it: its manifest folder, then the scaffold."""
    d = scratch()
    for f in (ROOT / "instances" / slug).iterdir():
        shutil.copy(f, d / f.name)
    T.scaffold(d, slug, ROOT, STD)
    return d


class Standard(unittest.TestCase):
    def test_US_31_R14_the_registry_and_the_scaffold_meet_the_standard_and_an_undated_exception_or_an_unreasoned_exemption_does_not(self):
        self.assertEqual(T.check_core(ROOT, STD), [])
        std = copy.deepcopy(STD)
        std["exceptions"]["zz"] = {"why": "short"}
        std["exempt"]["yy"] = {"why": "x"}
        std["files"].append({"id": "zz", "path": "nowhere.txt", "why": "w"})
        bad = "\n".join(T.check_core(ROOT, std))
        self.assertIn("exception for zz needs a reason, a queue item and an `until` date", bad)
        self.assertIn("exempt yy needs a reason", bad)
        self.assertIn("standard file nowhere.txt is written by no part of the scaffold", bad)
        self.assertEqual(set(STD["vendor"]["base"].values()), {f"vendor/ultrastable/{n}" for n in ("contract.js", "promoqueue.js", "tenant-standard.json", "tools/tenantstd.py", "tools/vendor_sync.mjs",
                                                                         # REPO-CONFORM-2: the conformance reader and what it reads, so a tenant reads itself offline
                                                                         "tools/repoconform.py", "tools/surfaces.py", "tools/deprot.py", "autonomy/repo-conformance.json", "standards/system.schema.json")})

    def test_US_31_R15_a_repository_is_read_against_the_standard_part_by_part_and_a_scaffolded_one_meets_it(self):
        empty = tmp(self)
        bad = T.check_tenant(empty, STD, ROOT)
        for f in STD["files"]:
            self.assertTrue(any(b.startswith(f["id"] + ":") for b in bad), f["id"])
        d = planned()
        self.assertEqual(T.check_tenant(d, STD, ROOT), [])
        pkg = json.loads((d / "package.json").read_text())
        pkg["dependencies"] = {"left-pad": "1.0.0"}
        (d / "package.json").write_text(json.dumps(pkg))
        (d / "README.md").write_text((d / "README.md").read_text() + "\n<<<<<<< ours\n")
        lc = json.loads((d / "lifecycle.json").read_text())
        lc["build"]["paths"].append("worker/not-there.js")
        lc["survival"].pop("credentials", None)
        (d / "lifecycle.json").write_text(json.dumps(lc))
        got = "\n".join(T.check_tenant(d, STD, ROOT))
        self.assertIn("package: package.json has dependencies", got)
        self.assertIn("merge: README.md carries an unresolved merge marker", got)
        self.assertIn("build names worker/not-there.js, which is not in the repository", got)
        self.assertIn("no answer for survival class credentials", got)

    def test_US_31_R16_a_tenant_workflow_declares_its_minute_budget_pins_its_actions_honours_the_halt_and_runs_no_matrix(self):
        sha = "a" * 40
        good = f"# budget: 1 minute\n# trigger: daily\n# free-alternative: a cron Worker\nname: x\non: {{workflow_dispatch: {{}}}}\nconcurrency: {{group: x}}\njobs:\n  a:\n    if: vars.HALT != '1'\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@{sha}\n"
        self.assertEqual(T.lint_workflow(good, STD), [])
        got = "\n".join(T.lint_workflow(good.replace("# budget: 1 minute\n", "").replace("actions/checkout@" + sha, "actions/checkout@v4")
                                        .replace("    timeout-minutes: 5\n", "").replace("    if: vars.HALT != '1'\n", "").replace("concurrency: {group: x}\n", "")
                                        + "    strategy:\n      matrix: {n: [1]}\n", STD))
        for want in ("no `# budget:` header comment", "`uses: actions/checkout@v4` is not pinned to a full commit sha", "a job has no timeout-minutes", "a job does not honour the halt (HALT-1)", "no `concurrency:`", "uses a matrix"):
            self.assertIn(want, got)

    def test_US_31_R17_core_files_live_only_under_the_vendor_directory_with_a_hash_each_and_a_hand_edit_is_a_finding(self):
        d = planned()
        self.assertEqual(T.check_tenant(d, STD, ROOT), [])
        head = (d / "vendor/ultrastable/VENDORED_FROM").read_text().splitlines()[0]
        self.assertRegex(head, r"^ultrastable/ultrastable@\S+$")
        (d / "vendor/ultrastable/contract.js").write_text("// edited by hand\n")
        (d / "vendor/ultrastable/stray.js").write_text("x\n")
        (d / "worker/vendor").mkdir()
        got = "\n".join(T.check_tenant(d, STD, ROOT))
        self.assertIn("vendor: vendor/ultrastable/contract.js was edited by hand: it no longer matches the hash of core seed/worker/src/contract.js", got)
        self.assertIn("vendor: vendor/ultrastable/stray.js is in vendor/ultrastable/ and not in VENDORED_FROM", got)
        self.assertIn("vendor: worker/vendor/ is a second vendor directory; core files live only under vendor/ultrastable/", got)
        e = planned()
        (e / "vendor/ultrastable/VENDORED_FROM").write_text("garbage\n")
        self.assertTrue(any("does not start with `<core repo>@<commit>`" in b for b in T.check_tenant(e, STD, ROOT)))
        self.assertEqual(T.excepted("practical-solutions", STD, "2999-01-01"), set())
        std = copy.deepcopy(STD)
        std["exceptions"]["x"] = {"why": "w" * 40, "item": "Q-X", "until": "2026-12-01", "vendor_outside": ["lib/a.js"]}
        self.assertEqual(T.excepted("x", std, "2026-11-30"), {"lib/a.js"})
        self.assertEqual(T.excepted("x", std, "2026-12-02"), set(), "a dated exception ends on its date and the rule fails again")

    def test_US_31_R18_the_scaffold_writes_every_standard_file_once_and_never_overwrites_a_tenants_own_code_or_words(self):
        d = planned()
        self.assertEqual(T.scaffold(d, "base-rates", ROOT, STD), [], "a second run changes nothing")
        ident = json.loads((d / "ultrastable.json").read_text())["identity"]
        self.assertTrue(all(k in ident for k in STD["identity"]["keys"]))
        self.assertEqual((ident["slug"], ident["public_url"], ident["runs_as"]), ("base-rates", None, []))
        (d / "worker/index.js").write_text("// the tenant's own Worker\n")
        (d / "README.md").write_text((d / "README.md").read_text() + "\nOur own words about the project.\n")
        pkg = json.loads((d / "package.json").read_text())
        pkg["keywords"] = ["mine"]
        (d / "package.json").write_text(json.dumps(pkg))
        T.scaffold(d, "base-rates", ROOT, STD)
        self.assertEqual((d / "worker/index.js").read_text(), "// the tenant's own Worker\n")
        self.assertIn("Our own words about the project.", (d / "README.md").read_text())
        self.assertEqual(json.loads((d / "package.json").read_text())["keywords"], ["mine"])
        self.assertEqual(T._cron("same", 1), T._cron("same", 1))
        self.assertRegex(T._cron("same", 1), r"^\d+ \* \* \* \*$")
        self.assertRegex(T._cron("same", 24), r"^\d+ \d+ \* \* \*$")
        self.assertRegex(T._cron("same", 168), r"^\d+ \d+ \* \* 1$")
        self.assertEqual(T.render("{{slug}} {{json:name}}", {"slug": "a", "name": 'b"c'}), 'a "b\\"c"')
        with self.assertRaises(KeyError):
            T.render("{{missing}}", {})

    def test_US_31_R19_a_readme_says_where_the_code_runs_and_a_repository_with_nothing_deployed_links_no_host(self):
        d = tmp(self)
        wrap = lambda inner: f"# T\n\n<!-- live:start (generated) -->\n{inner}\n<!-- live:end -->\n"
        live = lambda ident, text, root=None: T.live_problems(d, "t", STD, root, ident)
        (d / "README.md").write_text("# T\nno block\n")
        self.assertEqual(live(None, ""), ["live: README.md has no Live block (where the code runs; written by the scaffold with foundation/livelinks.py between the live:start and live:end markers)"])
        (d / "README.md").write_text(wrap("Not deployed yet. Runs on [Ultrastable](https://ultrastable.io/)."))
        self.assertEqual(live({"public_url": None}, ""), [])
        (d / "README.md").write_text(wrap("Not deployed yet. https://x.example/ Runs on [Ultrastable](https://ultrastable.io/)."))
        self.assertTrue(any("(a dead link)" in b for b in live({"public_url": None}, "")))
        (d / "README.md").write_text(wrap("[x](https://x.example/) https://x.example/health https://x.example/claims.json https://ultrastable.io/"))
        self.assertEqual(live({"public_url": "https://x.example"}, ""), [])
        self.assertTrue(any("ultrastable.json says public_url is https://other.example" in b for b in live({"public_url": "https://other.example"}, "")))


class Vendoring(unittest.TestCase):
    ts = load_tool("tenant_sync_spec31", "workers/tools/tenant_sync.py")
    vendor = load_tool("vendor_spec31", "workers/tools/vendor.py")

    def sha(self, text):
        return hashlib.sha256(text.encode()).hexdigest()

    def tenant(self, upstream=None):
        d = tmp(self)
        put(d, "upstream.json", {"vendor_dir": "vendor/ultrastable", "scan_roots": ["src/"], "tokens": ["acme"], **(upstream or {})})
        put(d, "vendor/ultrastable/core/x.js", "core x\n")
        put(d, "vendor/ultrastable/VENDORED_FROM", {"files": {"core/x.js": self.sha("core x\n")}, "commit": "c1"})
        return d

    def test_US_31_R20_the_tenant_check_names_a_hand_edit_a_missing_or_extra_vendored_file_and_unregistered_generic_code(self):
        d = self.tenant()
        self.assertEqual(self.ts.check(d), [])
        put(d, "src/util.js", "\n".join(f"export const f{i} = () => {i};" for i in range(12)) + "\n")
        self.assertEqual(self.ts.check(d), [f"generic-looking code not registered: src/util.js (lift it into the core: add it to `lifting` with a core path and item, or to `keep` with the reason it is tenant-specific)"])
        put(d, "upstream.json", {"vendor_dir": "vendor/ultrastable", "scan_roots": ["src/"], "tokens": ["acme"], "keep": {"src/util.js": " "}})
        self.assertEqual(self.ts.check(d), ["keep src/util.js: a reason is required"])
        put(d, "upstream.json", {"vendor_dir": "vendor/ultrastable", "scan_roots": ["src/"], "tokens": ["acme"], "keep": {"src/util.js": "acme's own rules"}})
        self.assertEqual(self.ts.check(d), [])
        (d / "vendor/ultrastable/core/x.js").write_text("edited\n")
        put(d, "vendor/ultrastable/core/extra.js", "x\n")
        got = "\n".join(self.ts.check(d))
        self.assertIn("vendored file edited by hand: core/x.js", got)
        self.assertIn("unvendored file inside vendor/ultrastable: core/extra.js", got)
        (d / "vendor/ultrastable/core/x.js").unlink()
        self.assertIn("vendored file missing: core/x.js", "\n".join(self.ts.check(d)))

    def test_US_31_R20_code_that_names_the_tenants_domain_is_specific_a_core_duplicate_is_a_finding_and_a_lifted_file_must_stay_a_shim_or_a_copy(self):
        d = self.tenant({"lifting": {"src/y.js": {"core": "", "item": ""}}, "lifted": {"src/z.js": "core/x.js"}})
        put(d, "src/acme_rules.js", "\n".join(f"// acme acme acme {i}" for i in range(12)) + "\n")
        put(d, "src/dup.js", "core x\n" * 1)
        put(d, "src/y.js", "const y = 1;\n")
        put(d, "src/z.js", "export const z = 'diverged and not a shim';\n")
        inv = self.ts.inventory(d, None, {"core/x.js": self.sha("core x\n")})
        self.assertEqual(inv["specific"], ["src/acme_rules.js"])
        self.assertEqual(inv["duplicate"], ["src/dup.js"])
        self.assertEqual((inv["lifting"], inv["lifted"]), (["src/y.js"], ["src/z.js"]))
        got = "\n".join(self.ts.check(d))
        self.assertIn("lifting src/y.js: needs `core` (target path) and `item`", got)
        self.assertIn("lifted src/z.js diverged from core core/x.js: it is neither a shim nor a copy", got)
        self.assertTrue(self.ts.is_shim('export * from "../vendor/ultrastable/mod/y.js";\n'))
        self.assertFalse(self.ts.is_shim("export const a = 1;\n"))

    def test_US_31_R21_generic_code_flows_up_with_its_imports_rewritten_a_held_entry_stays_and_a_second_pass_changes_nothing(self):
        d = self.tenant({"lifting": {"src/y.js": {"core": "mod/y.js", "item": "Q-1"}, "src/held.js": {"core": "mod/held.js", "item": "Q-2", "hold": "waiting on a design"}}})
        put(d, "src/y.js", "import { a } from '../vendor/ultrastable/core/x.js';\nimport { b } from './local.js';\nexport const y = a + b;\n")
        put(d, "src/held.js", "export const held = 1;\n")
        core = tmp(self)
        acts = self.ts.send_up(d, core)
        self.assertEqual(acts, ["add mod/y.js <- src/y.js"], "a held entry is not sent and a dry run writes nothing")
        self.assertFalse((core / "mod/y.js").exists())
        self.ts.send_up(d, core, apply=True)
        text = (core / "mod/y.js").read_text()
        self.assertTrue(text.startswith("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c)"))
        self.assertIn("from '../core/x.js'", text)
        self.assertIn("from './local.js'", text)
        self.assertEqual(self.ts.send_up(d, core), [])
        (d / "vendor/ultrastable/core/x.js").write_text("hand-edited core code\n")
        put(core, "core/x.js", "core x\n")  # the file exists in the core it came from
        self.assertIn("edit core/x.js", self.ts.send_up(d, core))
        self.ts.send_up(d, core, apply=True)
        self.assertEqual((core / "core/x.js").read_text(), "hand-edited core code\n")

    def test_US_31_R22_the_core_flows_down_as_a_manifest_with_a_hash_per_file_and_lifted_code_settles_to_a_shim(self):
        d = self.tenant({"lifting": {"src/y.js": {"core": "mod/y.js", "item": "Q-1"}}})
        put(d, "vendor/ultrastable/core/old.js", "old\n")
        put(d, "vendor/ultrastable/VENDORED_FROM", {"files": {"core/x.js": self.sha("core x\n"), "core/old.js": self.sha("old\n")}, "commit": "c1"})
        put(d, "src/y.js", "export const y = 1;\n")
        core = tmp(self)
        for rel, body in {"core/x.js": "core x v2\n", "core/z.js": "z\n", "mod/y.js": "export const y = 1;\n"}.items():
            put(core, rel, body)
        names = ["core/x.js", "core/z.js", "mod/y.js"]
        with mock.patch.object(self.ts, "_vendor_tool", lambda: types.SimpleNamespace(select=lambda c: names)):
            dry = self.ts.revendor(d, core)
            self.assertEqual((dry["changed"], dry["removed"], dry["settled"], dry["files"]), (3, ["core/old.js"], ["src/y.js"], 3))
            self.assertEqual((d / "vendor/ultrastable/core/x.js").read_text(), "core x\n", "a dry run writes nothing")
            self.ts.revendor(d, core, apply=True, commit="abc123")
        man = json.loads((d / "vendor/ultrastable/VENDORED_FROM").read_text())
        self.assertEqual((man["commit"], man["schema"]), ("abc123", "vendored-from/1"))
        self.assertEqual(man["files"], {n: self.sha((core / n).read_text()) for n in names})
        self.assertFalse((d / "vendor/ultrastable/core/old.js").exists())
        self.assertEqual((d / "src/y.js").read_text().splitlines()[-1], 'export * from "../vendor/ultrastable/mod/y.js";')
        up = json.loads((d / "upstream.json").read_text())
        self.assertEqual((up["lifted"], up["lifting"]), ({"src/y.js": "mod/y.js"}, {}))
        self.assertEqual(self.ts.check(d), [])

    def test_US_31_R24_a_vendored_tree_is_checked_against_its_manifest(self):
        d = tmp(self)
        put(d, "a.txt", "a\n")
        put(d, "b.txt", "b\n")
        put(d, "VENDORED_FROM", {"files": {"a.txt": self.vendor.sha(d / "a.txt"), "b.txt": self.vendor.sha(d / "b.txt")}})
        self.assertEqual(self.vendor.check(d), [])
        (d / "a.txt").write_text("changed\n")
        (d / "b.txt").unlink()
        self.assertEqual(sorted(self.vendor.check(d)), ["changed a.txt", "missing b.txt"])
        self.assertIn("org", self.vendor.fix_gitignore.__doc__ or "org")
        g = d / ".gitignore"
        g.write_text("/org/\nnode_modules\n")
        self.vendor.fix_gitignore(d)
        self.assertEqual(g.read_text().strip(), "node_modules")


    def test_US_31_R62_each_tool_reads_only_its_own_form_of_vendored_from_and_a_tenant_kept_on_the_json_form_is_exempt_with_that_reason(self):
        d = planned()
        vd = d / "vendor/ultrastable"
        text = (vd / "VENDORED_FROM").read_text()
        self.assertRegex(text.splitlines()[0], r"^ultrastable/ultrastable@\S+$", "the scaffold writes the text form")
        self.assertEqual(T.check_tenant(d, STD, ROOT), [])
        # US-31-R63 landed: tenant_sync.py and vendor.py read the text form through one reader instead of failing on it, never as empty.
        rows = [ln.split() for ln in text.splitlines()[1:] if ln.strip()]
        want = {r[2][len("vendor/ultrastable/"):]: r[3][len("sha256:"):] for r in rows}
        self.assertTrue(want, "the scaffold records at least one file")
        got_text = self.ts.read_manifest(d, {"vendor_dir": "vendor/ultrastable"})
        self.assertEqual((got_text["form"], got_text["files"]), ("text", want), "tenant_sync.py reads the text form, keyed inside the vendor directory")
        self.assertEqual(self.vendor.check(vd), [], "vendor.py --check reads the text form and finds the scaffolded files unchanged")
        manifest = {"schema": "vendored-from/1", "source": "ultrastable/workers", "commit": "c1", "files": {"contract.js": "0" * 64}}
        put(vd, "VENDORED_FROM", manifest)
        self.assertEqual(self.ts.read_manifest(d, {"vendor_dir": "vendor/ultrastable"})["files"], manifest["files"], "the JSON form is the one tenant_sync.py reads")
        got = "\n".join(T.check_tenant(d, STD, ROOT))
        self.assertIn("does not start with `<core repo>@<commit>`", got, "the standard check reports the JSON form instead of accepting it")
        ex = STD["exempt"]["practical-solutions"]
        self.assertIn("JSON", ex["why"], "a tenant kept on the JSON form is exempt, and the reason says so")
        self.assertIn("tenant_sync.py", ex["why"])


class SyncLoop(unittest.TestCase):
    NOW = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)

    def world(self, rows, repos=None):
        d = tmp(self)
        put(d, tenantsync.CFG, {"core": {"repo": "o/c", "dir": "workers", "tool": "workers/tools/tenant_sync.py"}, "ledger": "ops/tenant-sync/ledger.jsonl",
                                 "repos": repos or {"t": {"role": "tenant", "clone": "o/t", "pr_repo": "o/t"}}, "drift_max_days": 2, "upstream_min_30d": 1})
        put(d, "ops/tenant-sync/ledger.jsonl", "\n".join(json.dumps(r) for r in rows) + "\n")
        (d / "docs/issues").mkdir(parents=True)
        return d

    def ago(self, **kw):
        return (self.NOW - dt.timedelta(**kw)).isoformat()

    def test_US_31_R25_how_far_behind_each_tenant_is_and_whether_its_general_code_reaches_the_core_are_measured_from_the_ledger_and_each_breach_files_one_item(self):
        rows = [{"at": self.ago(days=6), "tenant": "t", "status": "in-sync"}, {"at": self.ago(days=4), "tenant": "t", "status": "needs-pr", "revendor": {"changed": 3}, "send_up": ["add x"]}]
        d = self.world(rows)
        m = tenantsync.metrics(d, self.NOW)
        self.assertEqual((m["tenants"]["t"]["ok"], m["tenants"]["t"]["days_behind"], m["tenants"]["t"]["drift_files"]), (False, 6.0, 3))
        self.assertEqual((m["upstream_candidates_30d"], m["upstream_prs_30d"], m["upstream_ok"]), (1, 0, False))
        self.assertEqual(sorted(tenantsync.file_items(d, m)), ["Q-SYNC-DRIFT-t", "Q-SYNC-UPSTREAM"])
        self.assertEqual(tenantsync.file_items(d, m), [], "an item that is open is not filed again")
        body = json.loads((d / "docs/issues/Q-SYNC-DRIFT-t.json").read_text())["body"]
        self.assertIn("**Closing probe:** cmd:python3 -m foundation tenantsync --probe drift:t", body)
        self.assertFalse(tenantsync.probe(d, "drift:t", self.NOW))
        self.assertFalse(tenantsync.probe(d, "upstream", self.NOW))
        self.assertFalse(tenantsync.probe(d, "nonsense:t", self.NOW))

    def test_US_31_R25_a_tenant_back_in_sync_or_inside_the_limit_is_ok_and_a_lift_that_reached_the_core_counts(self):
        d = self.world([{"at": self.ago(days=1), "tenant": "t", "status": "in-sync"}, {"at": self.ago(hours=2), "tenant": "t", "status": "needs-pr", "revendor": {"changed": 1}, "send_up": ["add x"]},
                        {"at": self.ago(hours=1), "tenant": "t", "action": "core-pr", "result": "https://github.com/o/c/pull/9"}])
        m = tenantsync.metrics(d, self.NOW)
        self.assertEqual((m["tenants"]["t"]["ok"], m["upstream_prs_30d"], m["upstream_ok"]), (True, 1, True))
        self.assertTrue(tenantsync.probe(d, "drift:t", self.NOW))
        self.assertEqual(tenantsync.file_items(d, m), [])
        self.assertEqual(tenantsync.metrics(self.world([]), self.NOW)["tenants"]["t"], {"status": "unmeasured", "drift_files": 0, "days_behind": 0, "ok": False})

    def test_US_31_R25_every_repository_of_the_org_has_a_role_and_a_tenant_names_where_to_clone_and_where_to_open_its_pull_request(self):
        d = self.world([], {"t": {"role": "tenant"}, "p": {"role": "pointer"}})
        put(d, "workers/tools/tenant_sync.py", "# tool\n")
        put(d, "org/repos.json", {"repos": [{"name": "t"}, {"name": "newcomer"}], "target": ["o/future"]})
        errs = tenantsync.check(d)
        self.assertIn("repository newcomer has no role in doctrine/tenant-sync.json (core, tenant, tracker, pointer or org-profile)", errs)
        self.assertIn("repository future has no role in doctrine/tenant-sync.json (core, tenant, tracker, pointer or org-profile)", errs)
        self.assertIn("tenant t needs clone and pr_repo", errs)
        self.assertIn("p: why is required", errs)


if __name__ == "__main__":
    unittest.main()
