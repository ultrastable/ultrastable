# BLINDSPOT-1: the system knows what the owner cannot know to ask for.
import json, shutil, tempfile, unittest, datetime as dt
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import blindspots

REPO = Path(__file__).resolve().parents[2]


class Blindspots(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for p in ["doctrine/blindspots.json", "ops/blindspots", "site/legalpages.js", "site/worker.js", "scripts/outreach_intro.py", "outreach/intro-profile.json", "doctrine/cost.json", "docs/issues", "doctrine/backup.json", "doctrine/dependency-licences.json", "instances/ultrastable/name-clearance.json", "seed/worker/src/freetier.js"]:
            s, d = REPO / p, self.tmp / p
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(s, d) if s.is_dir() else shutil.copy(s, d)
        for f in ("answers.jsonl", "closed.jsonl"):     # each test starts with no sweep answered and no need closed, whatever the repository has recorded
            (self.tmp / "ops/blindspots" / f).write_text("")

    def test_repo_register_is_valid(self):
        self.assertEqual(blindspots.check(REPO), [])

    def test_unmeasured_is_not_ok(self):
        """US-16-R22: a probe that cannot run is unmeasured, never passed."""
        row = {r["id"]: r for r in blindspots.scan(self.tmp)["needs"]}["email-authentication"]
        self.assertEqual(row["state"], "unmeasured")

    def test_failed_probe_files_item_but_identity_bound_does_not(self):
        """US-16-R22: a failed need files its own item; an identity-bound need is a gate and files none."""
        ids = {i["id"] for i in blindspots.items(blindspots.scan(self.tmp))}
        self.assertIn("Q-BLIND-backup-restore", ids)
        self.assertNotIn("Q-BLIND-terms-of-use", ids)
        self.assertNotIn("Q-BLIND-privacy-notice", ids)

    def test_page_removed_reopens_the_gap(self):
        f = self.tmp / "site/legalpages.js"
        f.write_text(f.read_text().replace("export const PRIVACY", "export const GONE"))
        row = {r["id"]: r for r in blindspots.scan(self.tmp)["needs"]}["privacy-notice"]
        self.assertEqual(row["state"], "gap")

    def test_sweep_due_then_answered_then_due_again(self):
        today = dt.date(2026, 11, 14)
        due = lambda t: next(s for s in blindspots.scan(self.tmp, today=t)["sweeps"] if s["domain"] == "security")["due"]
        self.assertTrue(due(today))
        blindspots.answer(self.tmp, "security", "Reviewed new endpoints since last sweep; evidence in PR 360 and the privacy page.")
        self.assertFalse(due(dt.date.today()))
        self.assertTrue(due(dt.date.today() + dt.timedelta(days=31)))
        with self.assertRaises(SystemExit):
            blindspots.answer(self.tmp, "security", "short")

    def test_learn_grows_register_and_gate_must_be_allowed(self):
        """US-16-R22: the register only grows, and a gate must be one of the allowed identity-bound gates."""
        blindspots.learn(self.tmp, "new-need", "legal", "found after a rejection", "file:nope.md")
        self.assertIn("new-need", {n["id"] for n in blindspots.load(self.tmp)["needs"]})
        blindspots.learn(self.tmp, "bad-gate", "legal", "x", "file:nope.md", gate="owner-review")
        self.assertTrue(any("allowed identity-bound gate" in e for e in blindspots.check(self.tmp)))

    def test_a_stale_clock_is_a_gap(self):
        f = self.tmp / "ops/backup/last-restore.json"; f.parent.mkdir(parents=True, exist_ok=True)
        day = dt.date(2026, 11, 20)
        f.write_text(json.dumps({"at": "2026-11-20", "ok": True}))
        spec = "fresh:ops/backup/last-restore.json::at::10::ok"
        self.assertTrue(blindspots.probe(self.tmp, spec, today=day + dt.timedelta(days=10)))
        self.assertFalse(blindspots.probe(self.tmp, spec, today=day + dt.timedelta(days=11)))
        f.write_text(json.dumps({"at": "2026-11-20", "ok": False}))
        self.assertFalse(blindspots.probe(self.tmp, spec, today=day))
        self.assertFalse(blindspots.probe(self.tmp, "fresh:nope.json::at::10"))

    def test_closed_ledger_follows_the_probe_and_a_relapse_reopens(self):
        res = blindspots.scan(self.tmp)
        self.assertIn("privacy-notice", blindspots.closed_ledger(self.tmp, res))
        led = (self.tmp / "ops/blindspots/closed.jsonl").read_text()
        self.assertIn('"id": "privacy-notice"', led); self.assertNotIn('"id": "terms-of-use"', led)
        self.assertEqual(blindspots.closed_ledger(self.tmp, res), [])                  # idempotent
        f = self.tmp / "site/legalpages.js"; f.write_text(f.read_text().replace("export const PRIVACY", "export const GONE"))
        self.assertIn("-privacy-notice", blindspots.closed_ledger(self.tmp, blindspots.scan(self.tmp)))
        self.assertNotIn('"id": "privacy-notice"', (self.tmp / "ops/blindspots/closed.jsonl").read_text())
        self.assertEqual(blindspots.main(["--closed", "privacy-notice", "--root", str(self.tmp)]), 1)
        self.assertEqual(blindspots.main(["--closed", "security-contact", "--root", str(self.tmp)]), 0)

    def test_item_done_checks_are_commands_the_queue_can_run(self):
        from foundation import queue
        for it in blindspots.items(blindspots.scan(self.tmp, today=dt.date(2030, 1, 1))):
            chk = queue.FIELD(it["body"], "Done check")
            self.assertRegex(chk, r"^cmd:python3 -m foundation blindspots --(closed|swept) [a-z-]+$")
            self.assertTrue(chk[4:].startswith(queue.CMD_ALLOWED))

    def test_domain_clock_two_routes_and_a_money_gate_inside_the_window(self):
        d = blindspots.load(self.tmp)
        def rdap(url, headers):
            if "rdap.org" in url:
                if url.endswith("ultrastable.io"):
                    raise OSError("blocked")
                return {"events": [{"eventAction": "expiration", "eventDate": "2027-11-10T07:52:16Z"}]}
            if url.endswith("/accounts?per_page=50"):
                return {"result": [{"id": "acct"}]}
            return {"result": {"expires_at": "2027-11-10T07:52:49Z", "auto_renew": False}}
        env = {"CLOUDFLARE_API_TOKEN": "t"}
        out = blindspots.domains(self.tmp, apply=True, today=dt.date(2026, 11, 20), env=env, fetch=rdap)
        io = out["domains"][0]
        self.assertEqual((io["name"], io["source"], io["expires"], io["gate"]), ("ultrastable.io", "cloudflare-registrar-api", "2027-11-10", False))
        self.assertTrue(out["ok"]); self.assertEqual(out["filed"], []); self.assertEqual(len(out["auto_renew_off"]), len(d["domains"]))
        late = blindspots.domains(self.tmp, apply=True, today=dt.date(2027, 9, 20), env=env, fetch=rdap)
        self.assertIn("Q-BLIND-RENEW-ultrastable-io", late["filed"])
        item = json.loads((self.tmp / "docs/issues/Q-BLIND-RENEW-ultrastable-io.json").read_text())
        self.assertIn("identity-bound: money", item["body"])                         # the executor leaves a payment to the owner
        self.assertEqual(blindspots.main(["--renewed", "ultrastable.io", "--root", str(self.tmp)]), 1)
        dead = lambda u, h: (_ for _ in ()).throw(OSError("down"))
        kept = blindspots.domains(self.tmp, apply=True, today=dt.date(2027, 9, 25), env={}, fetch=dead)
        self.assertEqual(kept["domains"][0]["expires"], "2027-11-10")                # an unread domain keeps its last measured date
        self.assertEqual(kept["at"], "2027-09-20")                                   # and the record's age says so
        self.assertFalse(blindspots.probe(self.tmp, "fresh:ops/blindspots/domain-expiry.json::at::10::ok", today=dt.date(2027, 10, 5)))

    def test_overdue_sweep_gets_a_computed_answer_that_names_gaps(self):
        today = dt.date(2026, 11, 20)
        (self.tmp / "ops/blindspots/answers.jsonl").write_text("")
        out = blindspots.tick(self.tmp, apply=True, live=False, today=today)
        self.assertIn("continuity", out["answered"])
        rows = [json.loads(l) for l in (self.tmp / "ops/blindspots/answers.jsonl").read_text().splitlines()]
        c = next(r for r in rows if r["domain"] == "continuity")
        self.assertEqual(c["basis"], "computed"); self.assertIn("backup-restore", c["text"]); self.assertTrue(c["evidence"])
        self.assertEqual(blindspots.main(["--swept", "continuity", "--root", str(self.tmp)]), 0)
        again = blindspots.tick(self.tmp, apply=True, live=False, today=today)
        self.assertEqual(again["answered"], [])

    def test_every_dependency_has_an_allowed_licence(self):
        from foundation import licences
        self.assertEqual(licences.check(REPO), [])
        self.assertEqual(licences.check.__module__, "foundation.licences")
        tmp = _repo.scratch(); (tmp / "doctrine").mkdir(parents=True, exist_ok=True); (tmp / "app").mkdir()
        shutil.copy(REPO / "doctrine/dependency-licences.json", tmp / "doctrine/dependency-licences.json")
        (tmp / "app/package.json").write_text(json.dumps({"dependencies": {"left-pad": "1.0.0"}}))
        self.assertTrue(any("npm:left-pad (shipped)" in e and "unknown" in e for e in licences.check(tmp)))
        d = json.loads((tmp / "doctrine/dependency-licences.json").read_text())
        d["licences"]["npm:left-pad"] = {"spdx": "GPL-3.0-only", "source": "test"}
        (tmp / "doctrine/dependency-licences.json").write_text(json.dumps(d))
        self.assertTrue(any("conflict" in e for e in licences.check(tmp)))            # copyleft is allowed for a tool, never for shipped code


if __name__ == "__main__":
    unittest.main()
