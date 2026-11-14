import datetime, json, pathlib, shutil, sys, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import outreach as base  # noqa: E402
import outreach_intro as oi  # noqa: E402

REPO = HERE.parent
D = datetime.date

PAGES = {
    "https://good.example.org": (200, "<a href='mailto:Partnerships@good.example.org'>x</a> jane.doe@good.example.org press@good.example.org info@elsewhere.com"),
    "https://form.example.org/contact": (200, "<form>contact us</form>"),
    "https://form.example.org": (200, "hello"),
}


def fake_fetch(url):
    if url.endswith("/robots.txt"):
        return (404, "")
    if url in PAGES:
        return PAGES[url]
    return (404, "")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        (self.tmp / "outreach").mkdir()
        for f in ("gate.json", "intro-profile.json", "suppression.json"):
            shutil.copy(REPO / "outreach" / f, self.tmp / "outreach" / f)
        reg = {"items": [{"id": "P-GOOD", "segment": "funder", "name": "Good Org", "url": "https://good.example.org", "status": "unresolved"},
                         {"id": "P-FORM", "segment": "ai-lab", "name": "Form Org", "url": "https://form.example.org", "status": "unresolved"},
                         {"id": "P-NONE", "segment": "venture", "name": "None Org", "url": "https://none.example.org", "status": "unresolved"}]}
        (self.tmp / "outreach/prospects.json").write_text(json.dumps(reg))
        oi.ROOT, oi.OUT = self.tmp, self.tmp / "outreach"
        base.ROOT, base.OUT = self.tmp, self.tmp / "outreach"
        self.today = D(2026, 11, 14)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def gate(self, **kw):
        g = json.loads((oi.OUT / "gate.json").read_text())
        for k, v in kw.items():
            if isinstance(v, dict):
                g[k].update(v)
            else:
                g[k] = v
        (oi.OUT / "gate.json").write_text(json.dumps(g))

    def targets(self):
        return json.loads((oi.OUT / "intro-state.json").read_text())["targets"]

    def run_intro(self, fetch=fake_fetch, **kw):
        return oi.run(self.today, fetch, **kw)


class Resolve(Base):
    def test_only_role_mailboxes_on_own_domain(self):
        self.run_intro()
        reg = {i["id"]: i for i in json.loads((oi.OUT / "prospects.json").read_text())["items"]}
        self.assertEqual(reg["P-GOOD"]["email"], "partnerships@good.example.org")  # not jane.doe, press or the other domain
        self.assertEqual(reg["P-GOOD"]["email_source"], "https://good.example.org")

    def test_form_only_and_no_route_get_dispositions_and_are_never_queued(self):
        self.run_intro()
        t = self.targets()
        self.assertEqual(t["intro:P-FORM"]["state"], "form-only")
        self.assertEqual(t["intro:P-NONE"]["state"], "no-public-route")
        self.assertTrue(t["intro:P-FORM"]["events"][-1]["detail"])

    def test_robots_disallow_is_respected(self):
        def f(url):
            return (200, "User-agent: *\nDisallow: /") if url.endswith("/robots.txt") else fake_fetch(url)
        self.run_intro(f)
        self.assertEqual(self.targets()["intro:P-GOOD"]["state"], "no-public-route")

    def test_address_that_disappears_goes_stale(self):
        self.run_intro()
        self.today = D(2026, 12, 20)
        self.run_intro(lambda u: (404, ""))
        self.assertEqual(self.targets()["intro:P-GOOD"]["state"], "stale")


class Contact(Base):
    def test_dry_run_writes_packet_and_contacts_nobody(self):
        r = self.run_intro()
        self.assertEqual(r["send"]["sent"], 0)
        self.assertEqual(r["send"]["dry"], 1)
        packet = (oi.OUT / "packets/intro/P-GOOD.md").read_text()
        self.assertIn("automated outreach system", packet)
        self.assertIn("reply \"stop\"", packet)
        self.assertIn("To: partnerships@good.example.org", packet)

    def test_live_needs_sender_postal_address_and_secrets(self):
        self.gate(mode="live", sender={"registered": True, "identity": "x"})
        sent = []
        e = oi.Intro(self.today, fake_fetch); e.deliver = lambda *a: sent.append(a)
        e.discover(); e.resolve(); e.packets(); e.queue()
        res = e.send()
        self.assertEqual((sent, res["awaiting"]), ([], 1))  # no postal address, no secrets: stays queued

    def test_live_sends_within_caps_and_counts_the_other_lane(self):
        import os
        os.environ["OUTREACH_SEND_URL"] = os.environ["OUTREACH_SEND_TOKEN"] = "x"
        try:
            self.gate(mode="live", sender={"registered": True, "identity": "x", "postal_address": "1 Example Street, Town", "booking_url": "https://cal.example.com/r"})
            sent = []
            e = oi.Intro(self.today, fake_fetch); e.deliver = lambda to, s, b: sent.append((to, s, b))
            e.discover(); e.resolve(); e.packets(); e.queue()
            self.assertEqual(e.send()["sent"], 1)
            self.assertEqual(sent[0][0], "partnerships@good.example.org")
            self.assertIn("1 Example Street", sent[0][2])
            self.assertIn("https://cal.example.com/r", sent[0][2])
            self.assertEqual(e.state["targets"]["intro:P-GOOD"]["state"], "sent")
        finally:
            del os.environ["OUTREACH_SEND_URL"], os.environ["OUTREACH_SEND_TOKEN"]

    def test_kill_switch_stops_everything(self):
        self.gate(kill=True)
        r = self.run_intro()
        self.assertEqual((r["queued"], r["send"]["sent"], r["send"]["dry"]), (0, 0, 0))

    def test_guard_blocks_a_claim_and_nothing_is_queued(self):
        p = json.loads((oi.OUT / "intro-profile.json").read_text())
        p["what"] += " We have raised funding."
        (oi.OUT / "intro-profile.json").write_text(json.dumps(p))
        r = self.run_intro()
        self.assertEqual(r["queued"], 0)
        self.assertEqual(self.targets()["intro:P-GOOD"]["state"], "guard-failed")

    def test_shipped_profile_passes_its_own_guard(self):
        shutil.copy(REPO / "outreach/gate.json", oi.OUT / "gate.json")
        self.assertEqual(oi.Intro(self.today, fake_fetch).guard(), [])


class Replies(Base):
    def test_opt_out_suppresses_the_whole_domain_for_good(self):
        self.run_intro()
        e = oi.Intro(self.today, fake_fetch)
        e.record_reply("intro:P-GOOD", "opt-out"); e.save()
        self.assertEqual(self.targets()["intro:P-GOOD"]["state"], "suppressed")
        self.today = D(2026, 12, 30)
        r = self.run_intro()
        self.assertEqual(r["send"]["dry"], 0)
        self.assertIn("good.example.org", {x.get("domain") for x in json.loads((oi.OUT / "suppression.json").read_text())["entries"]})

    def test_meeting_reply_is_counted_and_waits_for_a_person(self):
        self.run_intro()
        e = oi.Intro(self.today, fake_fetch)
        e.record_reply("intro:P-GOOD", "meeting", "asked for a call"); m = e.write_status()
        self.assertEqual((m["intro_meetings_total"], m["intro_awaiting_person_reply"]), (1, 1))


if __name__ == "__main__":
    unittest.main()
