import datetime, json, os, pathlib, shutil, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import outreach as o  # noqa: E402

REPO = HERE.parent
D = datetime.date


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        (self.tmp / "outreach").mkdir()
        (self.tmp / "funding").mkdir(parents=True)
        for f in ("gate.json", "profiles.json", "suppression.json"):
            shutil.copy(REPO / "outreach" / f, self.tmp / "outreach" / f)
        reg = {"max_age_days": 30, "deadline_warn_days": 45, "items": [
            {"id": "A-ONE", "track": "A", "name": "Open fund", "url": "https://one.example.org/apply", "amount": "n/a", "deadline": None, "status": "verified", "last_verified": "2026-11-10", "notes": "x"},
            {"id": "B-TWO", "track": "B", "name": "Credits", "url": "https://two.example.com/apply", "amount": "n/a", "deadline": "2026-11-01", "status": "verified", "last_verified": "2026-11-10", "notes": "x"},
            {"id": "R-THREE", "track": "R", "name": "Science fund", "url": "https://three.example.nl/", "amount": "n/a", "deadline": None, "status": "unverified", "last_verified": "2026-11-10", "notes": "x"},
            {"id": "A-MAIL", "track": "A", "name": "Mail fund", "url": "https://mail.example.org/", "amount": "n/a", "deadline": None, "status": "verified", "last_verified": "2026-11-10", "notes": "x", "route": {"kind": "email", "email": "grants@mail.example.org"}},
            {"id": "A-NOFIT", "track": "A", "outreach": False, "name": "Not yet", "url": "https://nofit.example.org/", "amount": "n/a", "deadline": None, "status": "verified", "last_verified": "2026-11-10", "notes": "x"},
        ]}
        (self.tmp / "funding/registry.json").write_text(json.dumps(reg))
        o.ROOT, o.OUT, o.REG = self.tmp, self.tmp / "outreach", self.tmp / "funding/registry.json"
        (o.OUT / "packets").mkdir()
        self.today = D(2026, 11, 10)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def gate(self, **kw):
        g = json.loads((o.OUT / "gate.json").read_text())
        for k, v in kw.items():
            g[k] = v
        (o.OUT / "gate.json").write_text(json.dumps(g))

    def state(self):
        return json.loads((o.OUT / "state.json").read_text())["targets"]


class Pipeline(Base):
    def test_only_registry_programs_with_routes_and_fit(self):
        o.run(self.today)
        keys = set(self.state())
        self.assertIn("ultrastable:A-ONE", keys)
        self.assertNotIn("ultrastable:A-NOFIT", keys)
        self.assertNotIn("ultrastable:R-THREE", keys)  # track R belongs to the qniverse profile only
        self.assertIn("qniverse:R-THREE", keys)

    def test_dry_run_contacts_nobody_and_forms_become_one_card_per_profile(self):
        r = o.run(self.today)
        self.assertEqual(r["send"]["sent"], 0)
        self.assertFalse((o.OUT / "cards").exists())  # the card concept is gone: one page, NEEDS-YOU.md
        self.assertEqual(len([c for c in r["cards"] if c.startswith("OUT-SEND-")]), 1)

    def test_unverified_source_is_never_queued(self):
        o.run(self.today)
        t = self.state()["qniverse:R-THREE"]
        self.assertEqual(t["state"], "packet-ready")
        self.assertEqual(t["blocked_by"], "source-unverified")

    def test_deadline_passed_expires(self):
        o.run(self.today)
        self.assertEqual(self.state()["ultrastable:B-TWO"]["state"], "expired")

    def test_dry_run_email_route_logs_would_send(self):
        o.run(self.today)
        ev = [e["event"] for e in self.state()["ultrastable:A-MAIL"]["events"]]
        self.assertIn("dry-run-send", ev)
        self.assertNotIn("sent", ev)

    def test_run_is_idempotent(self):
        o.run(self.today); a = (o.OUT / "state.json").read_text()
        o.run(self.today); self.assertEqual(a.count('"discovered"'), (o.OUT / "state.json").read_text().count('"discovered"'))


class Guard(Base):
    def test_blocked_terms_stop_a_packet(self):
        p = json.loads((o.OUT / "profiles.json").read_text())
        p["profiles"]["ultrastable"]["summary"] = "Ultrastable has a provisional patent and revenue of 5%."
        (o.OUT / "profiles.json").write_text(json.dumps(p))
        o.run(self.today)
        t = self.state()["ultrastable:A-ONE"]
        self.assertEqual(t["state"], "guard-failed")
        self.assertTrue(t["guard"])

    def test_shipped_profiles_pass_their_own_guard(self):
        shutil.copy(REPO / "outreach/profiles.json", o.OUT / "profiles.json")
        o.run(self.today)
        self.assertFalse([k for k, t in self.state().items() if t["state"] == "guard-failed"])

    def test_ultrastable_profile_never_says_qnfo_or_research(self):
        text = " ".join(json.loads((REPO / "outreach/profiles.json").read_text())["profiles"]["ultrastable"][k] for k in ("summary", "stage", "ask", "tagline")).lower()
        for w in ("qnfo", "research", "patent", "prior"):
            self.assertNotIn(w, text)


class Controls(Base):
    def test_kill_switch_stops_queue_and_send(self):
        self.gate(kill=True)
        r = o.run(self.today)
        self.assertEqual(r["queued"], 0)
        self.assertFalse([t for t in self.state().values() if t["state"] in ("queued", "awaiting-owner", "sent")])

    def test_live_send_needs_sender_identity_else_owner_card(self):
        self.gate(mode="live")
        os.environ.pop("OUTREACH_SEND_URL", None)
        o.run(self.today)
        t = self.state()["ultrastable:A-MAIL"]
        self.assertEqual(t["state"], "awaiting-owner"); self.assertEqual(t["needs"], "sender-identity")

    def _live(self):
        self.gate(mode="live", sender={"registered": True, "identity": "x"})
        os.environ["OUTREACH_SEND_URL"], os.environ["OUTREACH_SEND_TOKEN"] = "http://x", "t"
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ("OUTREACH_SEND_URL", "OUTREACH_SEND_TOKEN")])
        e = o.Engine(self.today); sent = []
        e.deliver = lambda to, s, b: sent.append((to, s, b)); return e, sent

    def test_live_send_delivers_once_and_respects_caps(self):
        e, sent = self._live()
        g = json.loads((o.OUT / "gate.json").read_text()); g["limits"]["max_sends_per_day"] = 0
        (o.OUT / "gate.json").write_text(json.dumps(g)); e.gate = g
        e.discover(); e.refresh_status(); e.packets_and_guard(); e.queue(); e.send()
        self.assertEqual(sent, [])  # cap 0: nothing leaves
        self.assertEqual(e.state["targets"]["ultrastable:A-MAIL"]["state"], "queued")
        g["limits"]["max_sends_per_day"] = 3; e.gate = g; e.send()
        self.assertEqual(len(sent), 1); self.assertEqual(sent[0][0], "grants@mail.example.org")
        e.send(); self.assertEqual(len(sent), 1)

    def test_send_failure_is_recorded_not_swallowed(self):
        e, _ = self._live()
        def boom(*a): raise OSError("down")
        e.deliver = boom
        e.discover(); e.refresh_status(); e.packets_and_guard(); e.queue(); e.send()
        t = e.state["targets"]["ultrastable:A-MAIL"]
        self.assertIn("send-failed", [x["event"] for x in t["events"]]); self.assertEqual(t["state"], "queued")


class RepliesAndFollowups(Base):
    def _sent(self):
        e = o.Engine(self.today)
        e.discover(); e.refresh_status(); e.packets_and_guard()
        k = "ultrastable:A-MAIL"
        e.state["targets"][k].update(state="sent", last_contact="2026-11-10"); e.save()
        return k

    def test_followup_due_after_cadence_then_closes(self):
        k = self._sent()
        e = o.Engine(D(2026, 11, 20)); self.assertEqual(e.followups(), 0)
        e = o.Engine(D(2026, 11, 25)); self.assertEqual(e.followups(), 1)

    def test_opt_out_suppresses_forever(self):
        k = self._sent()
        e = o.Engine(self.today); e.record_reply(k, "opt-out", "asked to stop"); e.save()
        o.run(D(2027, 2, 1))
        self.assertEqual(self.state()[k]["state"], "suppressed")
        self.assertIn(k, [x["id"] for x in json.loads((o.OUT / "suppression.json").read_text())["entries"]])

    def test_reply_updates_state_and_status(self):
        k = self._sent()
        e = o.Engine(self.today); e.record_reply(k, "accepted"); e.write_status(e.cards()); e.save()
        self.assertEqual(self.state()[k]["state"], "accepted")
        self.assertEqual(json.loads((o.OUT / "status.json").read_text())["metrics"]["outreach_replies_total"], 1)


class Shipped(unittest.TestCase):
    def test_status_is_in_repo_and_seed_copy_matches(self):
        self.assertTrue((REPO / "outreach/STATUS.md").exists())
        seed = REPO / "seed/scripts/outreach.py"
        if seed.exists():
            self.assertEqual(seed.read_text(), (REPO / "scripts/outreach.py").read_text())


if __name__ == "__main__":
    unittest.main()
