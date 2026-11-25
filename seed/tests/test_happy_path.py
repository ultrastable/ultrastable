#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CLONE-PATH-1: the user stories of a person who copied the template and has only an idea. Each story walks the steps the seed's own workflow
runs (.github/workflows/bootstrap.yml) and FAILS when any step would need the person to do a developer's work: use a terminal, make or store a
key, edit a file, or know what GitHub or Cloudflare are beyond one form and one link. The failure branches (the host has no room, the sign-in
ran out, GitHub refuses, a step breaks on our side) must each end in plain words with the system still acting, never in a dead end.
Run: python3 -m unittest discover -s tests"""
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
import bootstrap as bs  # noqa: E402
import intake  # noqa: E402
import interview as iv  # noqa: E402

FORM = ("### What should it do?\n\nA living atlas of what works in public policy: every programme graded by its trials and re-graded as evidence lands.\n\n"
        "### What should we call it?\n\n_No response_\n\n### How much may it cost a month, in US dollars?\n\n_No response_\n")
KEYS = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "ANTHROPIC_API_KEY", "GITHUB_TOKEN", "ORG_ADMIN_TOKEN", "GH_ORG_TOKEN", "GITHUB_REPOSITORY")


def fresh(d):
    """A person's own copy of the template, exactly as GitHub hands it over: nothing edited."""
    shutil.copytree(ROOT, d, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", "org", "node_modules", "__pycache__", "config.js", "wrangler.jsonc"))
    shutil.copy(ROOT / "tests/fixtures/IDEA.example.md", Path(d) / "IDEA.md")  # the template's own IDEA.md; in a real system that file is the owner's idea
    return Path(d)


class Story(unittest.TestCase):
    def setUp(self):
        self.saved = {k: os.environ.pop(k, None) for k in KEYS}
        os.environ["GITHUB_REPOSITORY"] = "ada/my-system"

    def tearDown(self):
        for k in KEYS:
            os.environ.pop(k, None)
        os.environ.update({k: v for k, v in self.saved.items() if v is not None})

    def boot(self, d, apply=True):
        code = bs.main(["--root", str(d), "--apply" if apply else "--dry-run", "--real"])
        return code, json.loads((Path(d) / "org/owner-status.json").read_text()), json.loads((Path(d) / "org/gate-cards.json").read_text())

    def plain(self, st, cards=()):
        """What a person reads: no developer's word, zero manual steps, one link at most, and the system says what it is doing."""
        text = " ".join(str(st.get(k, "")) for k in ("headline", "say", "doing", "link_words")) + " " + intake.message(st)
        self.assertEqual(intake.developer_words(text), [], text)
        self.assertEqual(st["manual_steps"], 0)
        self.assertTrue(st["say"] and st["doing"], "every state says what happened and what the system is doing about it")
        self.assertLessEqual(len(re.findall(r"\]\(https?://", intake.message(st))), 1, "one link at most")
        for c in cards:
            self.assertEqual(intake.developer_words(c["what"]), [], c["what"])
            self.assertTrue(c["default_in_effect"] and c["closing_probe"], c["id"])

    # ---- the happy path ---------------------------------------------------------------------------------------------------------------
    def test_1_a_fresh_copy_staffs_nothing_and_asks_one_question(self):
        with tempfile.TemporaryDirectory() as d:
            code, st, cards = self.boot(fresh(d))
            self.assertEqual(code, 0, "a copy that waits for its idea is not a failed run")
            self.assertEqual(st["state"], "waiting-for-idea")
            self.assertEqual(st["link"], "https://github.com/ada/my-system/issues/new?template=start.yml")
            self.assertFalse((Path(d) / "org/roles.json").exists(), "nobody is hired for the template's example")
            self.assertEqual([c["id"] for c in cards], ["GATE-IDEA"])
            self.plain(st, cards)

    def test_2_the_idea_typed_in_a_form_becomes_a_planned_system_with_one_link(self):
        with tempfile.TemporaryDirectory() as d:
            r = intake.take(fresh(d), FORM, "ada", "OWNER")
            self.assertTrue(r["ok"]); self.assertEqual(intake.developer_words(r["say"]), [])
            idea = bs.parse_idea((Path(d) / "IDEA.md").read_text())
            self.assertIn("living atlas", idea["sections"]["idea"]["prose"])
            self.assertEqual(bs.budget_from(idea), intake.DEFAULT_USD)
            code, st, cards = self.boot(d)
            self.assertEqual(code, 0, "no hosting sign-in is a recorded state with a default in effect, not a red run")
            self.assertEqual(st["state"], "needs-home")
            self.assertTrue(st["link"].startswith("https://ultrastable.io/start?idea=A%20living%20atlas"), st["link"])
            self.assertTrue((Path(d) / "org/roles.json").exists() and (Path(d) / "org/backlog.json").exists(), "the default in effect: the plan exists")
            ids = [c["id"] for c in cards]
            self.assertIn("GATE-RUNTIME", ids)
            self.assertFalse([i for i in ids if i.startswith("GATE-SECRET")], "no card names a key for a person to make")
            self.assertFalse([c["id"] for c in cards if "connect" not in c and c["id"] not in ("GATE-BUDGET", "CASE-ENTITY")], "every card the owner can act on is one link")
            self.plain(st, cards)
            log = json.loads((Path(d) / "org/boot-log.json").read_text())
            self.assertEqual(next(s["status"] for s in log["stages"] if s["stage"] == "qualify"), "ok")
            self.assertEqual(next(s["status"] for s in log["stages"] if s["stage"] == "year_gate"), "ok", "the year gate ran on the person's own idea")

    def test_3_the_guided_interview_also_ends_in_a_system_not_in_not_a_fit(self):
        answers = {}
        for k, v in {"idea": "A tool library for the neighbourhood that tracks who has what", "audience": "customers", "success": "ten loans a week",
                     "budget": "small"}.items():
            try:
                answers = iv.apply_answer(answers, k, v)
            except ValueError:  # the budget choice ids belong to questions.json; take its first paid choice
                q = next(x for x in iv.questions() if x["id"] == k)
                answers = iv.apply_answer(answers, k, next(c["id"] for c in q["choices"] if c.get("value", 0) > 0))
        with tempfile.TemporaryDirectory() as d:
            fresh(d); iv.write_outputs(answers, Path(d), "Tool Library", "Dana")
            code, st, _ = self.boot(d, apply=False)
            self.assertNotIn(st["state"], ("not-a-fit", "waiting-for-idea"), "a person who answered the interview is not turned away")

    def test_4_only_the_people_who_run_the_project_can_give_it_its_idea_and_a_stub_is_answered_in_words(self):
        with tempfile.TemporaryDirectory() as d:
            before = (fresh(d) / "IDEA.md").read_text()
            for body, who in ((FORM, "NONE"), ("### What should it do?\n\nhello\n", "OWNER")):
                r = intake.take(Path(d), body, "x", who)
                self.assertFalse(r["ok"]); self.assertEqual(intake.developer_words(r["say"]), [])
            self.assertEqual((Path(d) / "IDEA.md").read_text(), before)

    def test_5_a_one_off_is_told_so_plainly_and_nothing_is_started(self):
        with tempfile.TemporaryDirectory() as d:
            p = fresh(d) / "IDEA.md"
            p.write_text("---\norg_name: Party\nslug: party\nowner: ada\n---\n\n# Idea\n\nAn invitation page for one birthday party.\n\n# First outcomes\n\n- A page\n")
            code, st, cards = self.boot(d)
            self.assertEqual((code, st["state"]), (0, "not-a-fit"))
            self.assertFalse((Path(d) / "org/roles.json").exists())
            self.plain(st)

    # ---- the failure branches: each ends with the system still acting -------------------------------------------------------------------
    def failing_boot(self, d, stderr):
        intake.take(fresh(d), FORM, "ada", "OWNER")
        os.environ.update(CLOUDFLARE_API_TOKEN="x", CLOUDFLARE_ACCOUNT_ID="y")
        real_run, real_which = bs.Boot.run, bs.shutil.which

        def run(self, cmd, cwd):
            raise RuntimeError(f"{' '.join(cmd[:4])} exited 1: {stderr}")
        bs.Boot.run, bs.shutil.which = run, (lambda t: "/usr/bin/" + t)
        try:
            return self.boot(d)
        finally:
            bs.Boot.run, bs.shutil.which = real_run, real_which

    def test_6_the_host_has_no_room(self):
        with tempfile.TemporaryDirectory() as d:
            code, st, cards = self.failing_boot(d, "You have exceeded the limit of 10 databases on the free plan [code: 7406]")
            self.assertEqual(st["state"], "retrying"); self.assertIn("no room", st["say"]); self.assertIn("tried again every day", st["doing"])
            self.assertEqual(code, 2, "a failed start stays red for the system's own detectors; the person is told in words")
            self.plain(st, cards)
            backlog = json.loads((Path(d) / "org/backlog.json").read_text())
            self.assertTrue(any(i["id"] == "BOOT-PROVISION" for i in backlog), "the failure is a work item with a closing probe, not a note")

    def test_7_the_hosting_sign_in_ran_out(self):
        with tempfile.TemporaryDirectory() as d:
            _, st, cards = self.failing_boot(d, "Authentication error [code: 10000]")
            self.assertEqual(st["state"], "retrying"); self.assertTrue(st["link"].startswith("https://ultrastable.io/start"))
            self.plain(st, cards)

    def test_8_a_step_breaks_on_our_side(self):
        with tempfile.TemporaryDirectory() as d:
            _, st, cards = self.failing_boot(d, "TypeError: fetch failed")
            self.assertEqual(st["state"], "retrying"); self.assertIn("on our side", st["say"]); self.assertIsNone(st["link"])
            self.assertNotIn("TypeError", intake.message(st), "backend text stays in the boot log")
            self.plain(st, cards)

    def test_9_github_refuses_the_note_and_the_boot_still_stands(self):
        with tempfile.TemporaryDirectory() as d:
            intake.take(fresh(d), FORM, "ada", "OWNER"); self.boot(d)
            calls = []

            def refuse(cmd, **kw):
                calls.append(cmd); return SimpleNamespace(returncode=1, stdout="", stderr="HTTP 403: Resource not accessible by integration")
            out = intake.tell(Path(d), run=refuse)
            self.assertFalse(out["told"]); self.assertIn("403", out["why"])
            st = json.loads((Path(d) / "org/owner-status.json").read_text())
            self.assertEqual(st["state"], "needs-home"); self.assertFalse(st["told"]["told"], "recorded, so the next run tells again")

            def ok(cmd, **kw):
                calls.append(cmd); return SimpleNamespace(returncode=0, stdout="[]", stderr="")
            self.assertTrue(intake.tell(Path(d), run=ok)["told"])
            self.assertEqual(calls[-1][1:3], ["issue", "create"])
            self.assertEqual(intake.developer_words(calls[-1][calls[-1].index("--body") + 1]), [])

    def test_10_no_model_key_is_asked_of_anyone(self):
        cfg = json.loads((ROOT / "ultrastable.json").read_text())["connectors"]["model_api"]
        self.assertTrue(cfg.get("optional"))
        self.assertIn('"ai": { "binding": "AI" }', (ROOT / "worker/wrangler.template.jsonc").read_text(), "the runtime binds the account's own models")

    # ---- the surfaces a person reads, and the workflow that acts for them ----------------------------------------------------------------
    def test_11_the_person_facing_words_hand_nobody_a_developers_job(self):
        readme = (ROOT / "README.md").read_text()
        start = readme[readme.index("## Start with an idea"):readme.index("Engineers:")]
        you = start[start.index("What you do:"):start.index("What the system does")]
        self.assertEqual(intake.developer_words(you), [], you)
        self.assertEqual(len(re.findall(r"^\d+\. ", you, flags=re.M)), 2, "two steps: copy the template, say the idea")
        form = (ROOT / ".github/ISSUE_TEMPLATE/start.yml").read_text()
        self.assertEqual(intake.developer_words(form), [], form)
        self.assertEqual(form.count("required: true"), 1, "one question must be answered; the rest have defaults")
        for c in json.loads((ROOT / "bootstrap/cases.json").read_text())["cases"]:
            oc = c.get("owner_card")
            if oc:
                self.assertEqual(intake.developer_words(oc["what"]), [], oc["what"])

    def test_11b_the_fixture_is_the_template_example(self):
        self.assertTrue(intake.is_template((ROOT / "tests/fixtures/IDEA.example.md").read_text()))

    def test_12_the_workflow_does_every_step_itself(self):
        wf = (ROOT / ".github/workflows/bootstrap.yml").read_text()
        for must in ("issues:", "schedule:", "intake.py --root . --from-env", "bootstrap.py --apply --real", "intake.py --root . --tell", "author_association",
                     "vars.HALT != '1'", "issues: write", "contents: write"):
            self.assertIn(must, wf, must)
        self.assertNotIn("${{ github.event.issue.body }}\"", wf)  # the person's words reach the script through the environment, never the shell line
        self.assertEqual(len(re.findall(r"if: always\(\)", wf)), 2, "the record is committed and the person is told even when a step failed")
        org = (ROOT / ".github/workflows/org-init.yml").read_text()
        self.assertIn("workflow_run:", org, "nobody has to start the organization set-up")
        self.assertNotIn("exit 1; }'", org.split("Create repos")[0], "a missing approval is a recorded state, not a red run someone must read")


if __name__ == "__main__":
    unittest.main()
