# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-10 requirements whose only implementation is the seed kernel (R16 to R25) and the tenant sandbox (R31): each test names the requirement it proves.
Hermetic: credentials are removed from the environment, nothing is deployed, the code host and Cloudflare are never called (R19 reads through a fake urlopen).
Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_10_seed_kernel.py"""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "seed"
sys.path.insert(0, str(SEED / "bootstrap"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bootstrap as bs  # noqa: E402  (the seed kernel's bootstrapper)
import intake  # noqa: E402
from foundation import tenantrepos as tr  # noqa: E402

KEYS = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "ORG_ADMIN_TOKEN", "GH_ORG_TOKEN", "GITHUB_REPOSITORY",
        "CLAUDE_CODE_REMOTE", "GITHUB_ACTIONS")
ONE_OFF = "---\norg_name: Birthday\nslug: birthday\nowner: A\n---\n# Idea\n\nA page for my sister's birthday party next month.\n\n# First outcomes\n\n- A page with the time and place\n\n# Constraints\n\n- Budget per month: 5 USD\n"
FORM = "### What should it do?\n\nA living atlas of what works in public policy, every programme graded by its trials and re-graded as evidence lands.\n\n### What should we call it?\n\n_No response_\n"


def copy_seed(dst: Path, idea: str | None = None):
    shutil.copytree(SEED, dst, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", "org", "node_modules", "__pycache__", "config.js", "wrangler.jsonc"))
    shutil.copy(SEED / "tests/fixtures/IDEA.example.md", dst / "IDEA.md")
    if idea is not None:
        (dst / "IDEA.md").write_text(idea, encoding="utf-8")


class SeedKernel(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        for k in KEYS:
            os.environ.pop(k, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def boot(self, *flags, idea=None, hosted=False):
        copy_seed(self.root, idea)
        if hosted:
            f = self.root / "IDEA.md"
            f.write_text(f.read_text().replace("slug: example-co", "slug: example-co\nhosted_by: ultrastable", 1))
        with mock.patch.object(bs.Boot, "_gh_admin_org", staticmethod(lambda: False)):
            code = bs.main(["--root", str(self.root), "--dry-run", *flags])
        org = self.root / "org"
        j = lambda n: json.loads((org / n).read_text())
        return code, org, j

    # ------------------------------------------------------------------------------------------------------------------ R16
    def test_US_10_T07_US_10_R16_a_one_off_is_told_so_in_one_card_and_nothing_is_staffed_while_a_system_is(self):
        code, org, j = self.boot(idea=ONE_OFF)
        self.assertEqual(code, 0)
        cards = j("gate-cards.json")
        self.assertEqual([c["id"] for c in cards if c["id"] == "GATE-FIT"], ["GATE-FIT"])
        self.assertEqual([s["stage"] for s in j("boot-log.json")["stages"]][-1], "qualify", "the boot stops at the system test")
        for f in ("roles.json", "backlog.json", "seed.sql"):
            self.assertFalse((org / f).exists(), f"{f} must not exist: nothing is staffed or provisioned for a one-off")
        self.assertEqual(j("owner-status.json")["state"], "not-a-fit")
        shutil.rmtree(org)
        _, org, j = self.boot()  # the example idea passes the system test
        self.assertTrue((org / "roles.json").exists())
        self.assertFalse([c for c in j("gate-cards.json") if c["id"] == "GATE-FIT"])

    # ------------------------------------------------------------------------------------------------------------------ R17
    def test_US_10_T09_US_10_R17_one_objective_per_outcome_nine_liveness_metrics_and_the_declared_measure_breaches_until_probed(self):
        _, org, j = self.boot()
        doc = j("objectives.json")
        self.assertEqual(len(doc["objectives"]), 3)
        live = [m for m in doc["metrics"] if m["kind"] == "liveness"]
        self.assertEqual(len(live), 9)
        self.assertEqual({m["source"] for m in live}, {"builtin"})
        declared = [m for m in doc["metrics"] if m["source"] == "declared"]
        self.assertEqual(len(declared), 3, "the owner's measure is recorded once per objective")
        self.assertIn("controls out of date", declared[0]["name"])
        self.assertEqual(sorted(m["id"] for m in live)[0:2], ["M-acting", "M-closing"])

    # ------------------------------------------------------------------------------------------------------------------ R18
    def test_US_10_T08_US_10_R18_a_declared_fault_with_no_drill_blocks_the_gate_and_the_shipped_drills_pass(self):
        copy_seed(self.root)
        b = bs.Boot(self.root, self.root / "org", apply=False)
        status, detail = b.year_gate()
        self.assertEqual(status, "ok", detail)
        y = self.root / "autonomy/yearsim.json"
        cfg = json.loads(y.read_text())
        cfg["faults"] = [{"id": "undrilled", "what": "w", "rate_per_year": 1, "duration_days": [1, 1], "basis": "assumed: test"}]
        y.write_text(json.dumps(cfg))
        status, detail = bs.Boot(self.root, self.root / "org2", apply=False).year_gate()
        self.assertEqual(status, "blocked")
        self.assertIn("undrilled", detail)

    # ------------------------------------------------------------------------------------------------------------------ R19
    def _live(self, statuses):
        """A Boot in apply mode whose only network is a fake urlopen: the subdomain lookup, then one health answer per entry of `statuses`."""
        copy_seed(self.root)
        os.environ.update({"CLOUDFLARE_ACCOUNT_ID": "acct", "CLOUDFLARE_API_TOKEN": "placeholder"})
        b = bs.Boot(self.root, self.root / "org", apply=True)
        b.runtime = {"workers_dev": "true", "worker_name": "demo"}
        answers = list(statuses)
        seen = []

        class Resp(io.BytesIO):
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def urlopen(req, timeout=None):
            url = req.full_url
            seen.append(url)
            if url.endswith("/workers/subdomain"):
                return Resp(json.dumps({"result": {"subdomain": "sub"}}).encode())
            s = answers.pop(0)
            if s == 200:
                return Resp(b'{"ok":true}')
            raise urllib.error.HTTPError(url, s, "x", {}, None)
        with mock.patch("urllib.request.urlopen", urlopen), mock.patch("time.sleep", lambda s: None):
            return b.verify_live(), seen

    def test_US_10_R19_a_boot_is_live_only_when_health_answers_200_after_serving_503_before_the_first_tick(self):
        (status, detail), seen = self._live([503, 503, 200])
        self.assertEqual(status, "ok", detail)
        self.assertIn("https://demo.sub.workers.dev/health", seen)
        self.assertEqual(len(seen), 4, "one subdomain lookup and three health reads")

    def test_US_10_R19_a_health_route_that_never_answers_200_blocks_the_boot_and_a_dry_run_probes_nothing(self):
        (status, detail), seen = self._live([503] * 78)
        self.assertEqual(status, "blocked")
        self.assertIn("live probe failed", detail)
        b = bs.Boot(self.root, self.root / "org", apply=False)
        self.assertEqual(b.verify_live()[0], "degraded")

    # ------------------------------------------------------------------------------------------------------------------ R21, R22, R23, R24
    def test_US_10_T12_US_10_R21_a_hosted_system_is_asked_for_no_secret_and_no_budget_approval(self):
        _, org, j = self.boot(hosted=True)
        asked = [c["id"] for c in j("gate-cards.json") if c["id"].startswith(("GATE-SECRET", "GATE-CONNECT", "GATE-RUNTIME", "GATE-BUDGET"))]
        self.assertEqual(asked, [])
        detect = next(s for s in j("boot-log.json")["stages"] if s["stage"] == "detect")
        self.assertIn("no secret is asked of the owner", detect["detail"])

    def test_US_10_R22_each_card_has_at_most_one_link_and_no_card_names_a_key_or_asks_for_a_model_key(self):
        _, org, j = self.boot()
        cards = j("gate-cards.json")
        self.assertTrue(cards)
        for c in cards:
            links = [v for v in c.values() if isinstance(v, str) and (v.startswith("https://") or v.startswith("/connect") or "http://" in v or "https://" in v)]
            self.assertLessEqual(len(links), 1, f"{c['id']}: {links}")
            self.assertEqual(intake.developer_words(c["what"]), [], c["what"])
            self.assertNotRegex(c["what"] + c["why_gated"], r"(?i)model key|api key|ANTHROPIC|paste|token")
        self.assertTrue(any(c["id"] == "GATE-RUNTIME" and c["connect"].startswith("https://") for c in cards))

    def test_US_10_T11_US_10_R23_the_templates_example_idea_is_not_staffed_in_a_persons_own_system(self):
        copy_seed(self.root)
        with mock.patch.object(bs.Boot, "_gh_admin_org", staticmethod(lambda: False)):
            code = bs.main(["--root", str(self.root), "--dry-run", "--real"])
        org = self.root / "org"
        self.assertEqual(code, 0)
        self.assertFalse((org / "roles.json").exists())
        card = next(c for c in json.loads((org / "gate-cards.json").read_text()) if c["id"] == "GATE-IDEA")
        self.assertTrue(card["connect"])
        self.assertEqual(json.loads((org / "owner-status.json").read_text())["state"], "waiting-for-idea")

    def test_US_10_R24_the_owner_status_note_has_what_happened_what_is_being_done_one_link_and_no_manual_step(self):
        for flags, state in (((), "planned"), (("--real",), "waiting-for-idea")):
            shutil.rmtree(self.root / "org", ignore_errors=True)
            code, org, j = self.boot(*flags)
            st = j("owner-status.json")
            self.assertEqual(st["manual_steps"], 0)
            self.assertTrue(st["say"] and st["doing"], st)
            self.assertEqual(intake.developer_words(" ".join(str(st.get(k, "")) for k in ("headline", "say", "doing", "link_words"))), [])
            self.assertTrue(isinstance(st.get("link"), (str, type(None))), "at most one link")

    # ------------------------------------------------------------------------------------------------------------------ R15
    # What a person must never read: a binding name, the machine's dry-run mode, or a file name for them to handle.
    MACHINE = r"\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|(?i:dry[- ]?run)|\b[\w./-]+\.(?:md|json|jsonc|js|mjs|py|sql|toml|yml)\b"

    def _needs_you(self, org):
        """The seed Worker's Needs-you page, rendered by its own ui.js from the gate_cards rows the boot's seed SQL writes."""
        import sqlite3
        import subprocess
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE gate_cards (id TEXT PRIMARY KEY, what TEXT NOT NULL, why_gated TEXT NOT NULL, default_in_effect TEXT NOT NULL,"
                   " prepared_by_fleet TEXT, closing_probe TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT)")
        for line in (org / "seed.sql").read_text().splitlines():
            if line.startswith("INSERT OR IGNORE INTO gate_cards"):
                db.execute(line)
        rows = [dict(zip(("id", "what", "why_gated", "default_in_effect"), r))
                for r in db.execute("SELECT id, what, why_gated, default_in_effect FROM gate_cards WHERE status='open' ORDER BY id")]
        db.close()
        js = ("import { needsScreen } from %s; const r = needsScreen({ cards: JSON.parse(process.argv[1]), answers: {} });"
              " process.stdout.write(await r.text());") % json.dumps((SEED / "worker/src/ui.js").as_uri())
        p = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(rows)], capture_output=True, text=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return rows, p.stdout

    def test_US_10_R15_every_seed_card_carries_plain_words_and_the_needs_you_page_shows_only_them(self):
        _, org, j = self.boot()  # no credential at all: the hosting card, a connect card, the budget card and the case cards
        cards = j("gate-cards.json")
        ids = {c["id"] for c in cards}
        self.assertTrue({"GATE-RUNTIME", "GATE-BUDGET"} <= ids and any(i.startswith("GATE-CONNECT-") for i in ids) and any(i.startswith("CASE-") for i in ids), ids)
        for c in cards:
            self.assertTrue(c.get("say") and c.get("say_default"), f"{c['id']} has no plain-words lines")
            self.assertNotRegex(c["say"] + " " + c["say_default"], self.MACHINE, c["id"])
        rows, page = self._needs_you(org)
        self.assertEqual(sorted(r["id"] for r in rows), sorted(ids), "every card in the card file is a row the console shows (US-10-R06)")
        by_id = {c["id"]: c for c in cards}
        for r in rows:
            self.assertEqual((r["what"], r["default_in_effect"]), (by_id[r["id"]]["say"], by_id[r["id"]]["say_default"]), r["id"])
            self.assertNotRegex(" ".join((r["what"], r["why_gated"], r["default_in_effect"])), self.MACHINE, r["id"])
        self.assertIn("Needs you", page)
        body = page[page.index("<h1>Needs you</h1>"):page.index("</main>")]
        self.assertNotRegex(body, self.MACHINE, "the Needs-you page names no binding, no dry-run and no file")
        self.assertTrue(any(c["closing_probe"].startswith("connector:") for c in cards), "the machine probe stays in the card file")

    def test_US_10_R15_the_idea_card_says_it_plainly_with_and_without_the_template(self):
        for flags, drop in (((), True), (("--real",), False)):
            shutil.rmtree(self.root / "org", ignore_errors=True)
            copy_seed(self.root)
            if drop:
                (self.root / "IDEA.md").unlink()
            with mock.patch.object(bs.Boot, "_gh_admin_org", staticmethod(lambda: False)):
                bs.main(["--root", str(self.root), "--dry-run", *flags])
            card = next(c for c in json.loads((self.root / "org/gate-cards.json").read_text()) if c["id"] == "GATE-IDEA")
            self.assertTrue(card.get("say") and card.get("say_default"), card)
            self.assertNotRegex(card["say"] + " " + card["say_default"], self.MACHINE, card)

    # ------------------------------------------------------------------------------------------------------------------ R20
    def test_US_10_R20_a_constitution_that_disagrees_with_the_code_blocks_the_boot_before_any_decision(self):
        copy_seed(self.root)
        tick = self.root / "worker/src/tick.js"
        tick.write_text(tick.read_text().replace("  async reap_claims(db, ctx)", "  async reap_claims_renamed(db, ctx)", 1))
        with mock.patch.object(bs.Boot, "_gh_admin_org", staticmethod(lambda: False)):
            code = bs.main(["--root", str(self.root), "--dry-run"])
        stages = {s["stage"]: s for s in json.loads((self.root / "org/boot-log.json").read_text())["stages"]}
        self.assertEqual(stages["constitute"]["status"], "blocked", stages["constitute"])
        self.assertIn("constitution disagreement", stages["constitute"]["detail"])
        self.assertEqual(code, 2)
        self.assertIn("BOOT-CONSTITUTE", [i["id"] for i in json.loads((self.root / "org/backlog.json").read_text())], "the disagreement is a backlog item")
        self.assertEqual(list(stages)[:3], ["read", "adopt", "constitute"], "it is checked before any decision; adopt only writes the copy's own identity (IDENTITY-AT-BIRTH-1)")

    # ------------------------------------------------------------------------------------------------------------------ R34
    def test_US_10_T06_US_10_R34_the_seed_writes_every_backlog_id_once_and_the_nothing_public_item_survives_the_seed_sql(self):
        _, org, j = self.boot()  # the example idea says nothing may be public
        items = j("backlog.json")
        ids = [i["id"] for i in items]
        self.assertEqual(len(ids), len(set(ids)), f"a repeated id is dropped by INSERT OR IGNORE: {ids}")
        hold = [i for i in items if "disclosure gate" in i["title"]]
        self.assertEqual([i["priority"] for i in hold], [5], "the nothing-public item exists once, at priority 5")
        seeded = [l for l in (org / "seed.sql").read_text().splitlines() if l.startswith("INSERT OR IGNORE INTO items")]
        self.assertEqual(len(seeded), len(ids), "every backlog item is a row of the seed SQL")
        self.assertTrue(any(i["title"].startswith("First plus accepted") for i in items))

    # ------------------------------------------------------------------------------------------------------------------ R25
    def test_US_10_R25_only_the_people_who_run_the_repository_can_give_it_its_idea(self):
        copy_seed(self.root)
        before = (self.root / "IDEA.md").read_text()
        refused = intake.take(self.root, FORM, user="stranger", association="CONTRIBUTOR")
        self.assertFalse(refused["ok"])
        self.assertIn("Only the people who run this project", refused["say"])
        self.assertEqual((self.root / "IDEA.md").read_text(), before, "nothing was changed")
        for who in ("OWNER", "MEMBER", "COLLABORATOR"):
            copy_seed(self.root)
            self.assertTrue(intake.take(self.root, FORM, user="ada", association=who)["ok"], who)
            self.assertIn("living atlas", (self.root / "IDEA.md").read_text())
        short = intake.take(self.root, "### What should it do?\n\nmake app\n", user="ada", association="OWNER")
        self.assertFalse(short["ok"], "a stub is answered in plain words")
        self.assertEqual(intake.developer_words(short["say"]), [])


class TenantSandbox(unittest.TestCase):
    def test_US_10_R31_the_registered_tenants_bind_only_their_own_stores_and_a_shared_binding_is_found(self):
        self.assertEqual(tr.isolation(ROOT), [], "every deployment other than the platform is a sandboxed tenant")
        reg = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "own-repo", "worker": "w-a",
                                              "sandbox": {"stores": ["ultrastable-a"], "secrets": [],
                                                          "budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}}
        topo = {"workers": [{"id": "w-a", "bindings": {"d1": {"DB": "ultrastable-a", "SHARED": "ultrastable-org"}}},
                            {"id": "core", "bindings": {"d1": {"X": "ultrastable-a"}}}]}
        with tempfile.TemporaryDirectory() as t:
            errs = tr.isolation(Path(t), reg, topo)
        self.assertTrue(any("binds ultrastable-org" in e for e in errs), errs)
        self.assertTrue(any("core worker core binds ultrastable-a" in e for e in errs), errs)


class HostedFrontDoor(unittest.TestCase):
    """US-19-R23: the platform's own front door turns a definite one-off away before it keeps or builds anything (site/worker.js, read only)."""

    def test_US_19_R23_a_definite_one_off_is_refused_in_plain_words_before_anything_is_stored_and_a_maintained_system_passes(self):
        import subprocess
        js = """
const mod = (await import(%s)).default;
globalThis.fetch = async () => { throw new Error('offline'); };
const kv = new Map();
const env = { ASSETS: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); }, delete: async k => { kv.delete(k); } },
  AI: { run: async () => ({ response: JSON.stringify([{ q: 'Who uses it?', cue: 'e.g. members' }]) }) } };
const post = t => { const f = new FormData(); f.set('idea', t);
  return mod.fetch(new Request('https://ultrastable.io/api/idea', { method: 'POST', body: f, headers: { accept: 'application/json' } }), env, { waitUntil() {} }); };
const one = await post('A packing list for camping trips');
const body = await one.json(), stored = [...kv.keys()];
const kept = await post('A club website that keeps improving its own search ranking every week');
process.stdout.write(JSON.stringify({ one: one.status, body, stored, kept: kept.status }));
""" % json.dumps((ROOT / "site/worker.js").as_uri())
        p = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=120, cwd=ROOT)
        self.assertEqual(p.returncode, 0, p.stderr[-2000:])
        r = json.loads(p.stdout)
        self.assertEqual((r["one"], r["body"]["state"]), (422, "not_a_fit"))
        self.assertRegex(r["body"]["error"], r"site builder", "the refusal names what to use instead")
        self.assertEqual(intake.developer_words(r["body"]["error"]), [], "in plain words")
        self.assertEqual(r["stored"], [], "nothing is stored for a one-off")
        self.assertNotEqual(r["kept"], 422, "a maintained system goes on to the questions")


class DoorD(unittest.TestCase):
    """US-19-R26: a person who copied the template answers one form; the repository's own workflow does everything else."""
    form = (SEED / ".github/ISSUE_TEMPLATE/start.yml").read_text()
    workflow = (SEED / ".github/workflows/bootstrap.yml").read_text()

    def test_US_19_R26_the_form_has_one_required_question_and_the_rest_are_optional_with_stated_defaults(self):
        import re
        fields = re.findall(r"- type: (textarea|input)\n    id: (\w+)", self.form)
        self.assertEqual([i for _, i in fields], ["idea", "name", "budget"])
        self.assertEqual(self.form.count("required: true"), 1, "only the idea is required")
        self.assertIn("Leave it empty and it stays inside 5 dollars a month", self.form)
        self.assertEqual(intake.developer_words(self.form), [], "the form's words hand nobody a developer's job")

    def test_US_19_R26_the_workflow_writes_the_idea_from_the_form_boots_it_and_tells_the_person_without_a_manual_step(self):
        for step in ("bootstrap/intake.py --root . --from-env", "bootstrap/bootstrap.py --apply --real", "bootstrap/intake.py --root . --tell"):
            self.assertIn(step, self.workflow)
        self.assertLess(self.workflow.index("--from-env"), self.workflow.index("--apply --real"))
        self.assertLess(self.workflow.index("--apply --real"), self.workflow.index("--tell"))
        import re
        secrets = set(re.findall(r"secrets\.(\w+)", self.workflow))
        self.assertTrue(secrets <= {"CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "GITHUB_TOKEN"}, secrets)  # hosting sign-in when one exists; never a model key
        self.assertIn("schedule", self.workflow, "the start is tried again every day")


if __name__ == "__main__":
    unittest.main()
