# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# SEED-ADMIT-1: a seed is built, deployed and admitted by the system, and is launched only when it can run a year unattended.
import json, shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch
from foundation import manifest as mf, seedadmit

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "instances/second-tenant/instance.json"


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = scratch()  # removed when the class ends (_repo.scratch)
        cls.out = cls.tmp / "sys"
        cls.res = seedadmit.onboard(mf.load(str(MANIFEST)), cls.out, apply=False, root=cls.tmp)

    def test_check(self):
        self.assertEqual(seedadmit.check(REPO), [])

    def test_onboard_admits(self):
        self.assertEqual(self.res["admission"], "admitted", self.res["reasons"])
        launch = json.loads((self.out / "org/launch.json").read_text())
        self.assertTrue(launch["launched"])
        self.assertIn(".github/workflows/autonomy.yml", launch["wired"])
        self.assertIn(".github/workflows/bootstrap.yml", launch["wired"])
        self.assertGreaterEqual(self.res["year"]["p10"], 365)
        self.assertGreaterEqual(self.res["year"]["strict_p10"], 365)

    def test_workflow_uses_no_new_credential(self):
        wf = (self.out / ".github/workflows/autonomy.yml").read_text()
        self.assertNotIn("secrets.", wf.replace("secrets.GITHUB_TOKEN", ""))
        self.assertIn("vars.HALT", wf)

    def test_template_is_not_under_the_protected_path(self):
        self.assertTrue((REPO / "seed/autonomy-kit/autonomy.workflow.yml").is_file())
        self.assertFalse((REPO / "seed/.github/workflows/autonomy.yml").exists())

    def _copy(self):
        d = self.tmp / ("c" + str(len(list(self.tmp.iterdir()))))
        shutil.copytree(self.out, d, ignore=shutil.ignore_patterns("node_modules"))
        return d

    def test_missing_drill_holds_the_seed(self):
        d = self._copy()
        p = d / "autonomy/yearsim.json"
        c = json.loads(p.read_text())
        for f in c["faults"]:
            if f["id"] == "silent-drop":
                f.pop("drill")
        p.write_text(json.dumps(c))
        r = seedadmit._engine().admit(d, slug="x")
        self.assertEqual(r["status"], "held")
        self.assertTrue(any("silent-drop" in x and "no drill" in x for x in r["reasons"]), r["reasons"])

    def test_platform_import_holds_the_seed(self):
        d = self._copy()
        (d / "worker/src/leak.js").write_text("import x from '../../../site/worker.js';\n")
        r = seedadmit._engine().admit(d, slug="x")
        self.assertEqual(r["status"], "held")
        self.assertTrue(any("self-contained" in x for x in r["reasons"]), r["reasons"])

    def test_failing_recovery_holds_the_seed(self):
        d = self._copy()
        (d / "worker/src/sweeper.js").write_text("export const sweepOpenLoops = () => { throw new Error('broken'); };\n")
        r = seedadmit._engine().admit(d, slug="x")
        self.assertEqual(r["status"], "held")
        self.assertTrue(any(x.startswith("sla-sweeper") for x in r["reasons"]), r["reasons"])

    def test_launched_needs_a_fresh_record(self):
        e = seedadmit._engine()
        reg = self.tmp / "core"
        rec = e.admit(self.out, slug="second-tenant")
        p = reg / "instances/second-tenant/admission.json"
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps(rec))
        self.assertTrue(seedadmit.launched(reg, "second-tenant"))
        p.write_text(json.dumps({**rec, "expires": "2020-01-01T00:00:00Z"}))
        self.assertFalse(seedadmit.launched(reg, "second-tenant"))
        p.write_text(json.dumps({**rec, "status": "held"}))
        self.assertFalse(seedadmit.launched(reg, "second-tenant"))

    def test_probe_admits_the_template(self):
        ok, why = seedadmit.probe(REPO)
        self.assertTrue(ok, why)


    def test_live_needs_a_verified_deploy_row_and_an_answering_health(self):
        root = scratch()
        (root / "doctrine").mkdir(); (root / "ops").mkdir()
        (root / "doctrine/seed-deploys.json").write_text('{"seeds": ["a"]}')
        (root / "ops/deploys.jsonl").write_text("")
        self.assertTrue(seedadmit.live(root, fetch=lambda u: {}))
        (root / "ops/deploys.jsonl").write_text('{"kind": "seed", "slug": "a", "live_ok": true, "url": "https://x"}\n')
        self.assertEqual(seedadmit.live(root, fetch=lambda u: {"ok": True}), [])
        def down(u):
            raise OSError("refused")
        self.assertTrue(seedadmit.live(root, fetch=down))

    def test_the_seed_deploy_step_is_wired_into_the_platform_deploy(self):
        self.assertIn("deploy-seed.mjs", (REPO / "deploy/deploy-workers.mjs").read_text(encoding="utf-8"))
        self.assertIn("second-tenant", (REPO / "doctrine/seed-deploys.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
