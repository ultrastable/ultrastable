import json, tempfile, unittest, shutil
from pathlib import Path
from plugins.api import Runtime, Action, SCOPE
from plugins import scopecheck, loops
from plugins.email import plugin as email
from plugins.mailing_list import plugin as ml
from plugins.social import plugin as social
from plugins.youtube import plugin as yt
from plugins.gcp import plugin as gcp
from plugins.selfdescribe import plugin as selfd
from plugins.communicate import plugin as comm

ROOT = Path(__file__).resolve().parents[2]
ENV = {"MAIL_SEND_URL": "https://mail.example.workers.dev/send", "MAIL_SEND_TOKEN": "t0k", "LIST_TOKEN_SECRET": "s",
       "MASTODON_URL": "https://masto.example", "MASTODON_TOKEN": "m", "BUFFER_TOKEN": "b", "BLUESKY_HANDLE": "h", "BLUESKY_APP_PASSWORD": "p",
       "YT_CLIENT_ID": "i", "YT_CLIENT_SECRET": "s", "YT_REFRESH_TOKEN": "r", "GCP_ACCESS_TOKEN": "g"}


def cfg(mode="dry-run", rung="observed", **over):
    c = json.loads((ROOT / "plugins/plugins.config.template.json").read_text())
    c["rung"] = rung
    for n, p in c["plugins"].items(): p["enabled"] = True; p["mode"] = mode
    for n, v in over.items(): c["plugins"][n].update(v)
    return c


class Base(unittest.TestCase):
    def rt(self, mode="dry-run", rung="observed", env=ENV, **over):
        self.calls = []
        def transport(req):
            self.calls.append(req)
            if "createSession" in req["url"]: return 200, {"accessJwt": "J", "did": "did:x"}, {}
            if "oauth2" in req["url"]: return 200, {"access_token": "A"}, {}
            if "uploadType=resumable" in req["url"]: return 200, {}, {"Location": "https://www.googleapis.com/upload/session/1"}
            if "profiles.json" in req["url"]: return 200, [{"id": "p1"}], {}
            return 200, {"ok": True}, {}
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d)
        return Runtime(cfg(mode, rung, **over), state_dir=d, env=env, transport=transport, now=lambda: 1_700_000_000)


class Boundary(unittest.TestCase):
    def test_scopecheck_clean(self): self.assertEqual(scopecheck.check(), [])

    def test_core_import_fails(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d)
        shutil.copytree(ROOT, d / "s", ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        (d / "s/bootstrap/bad.py").write_text("from plugins.api import Runtime\n")
        (d / "s/worker/src/bad.js").write_text("import x from '../../plugins/social/plugin.js'\n")
        errs = scopecheck.check(d / "s")
        self.assertEqual(len([e for e in errs if "core imports" in e]), 2, errs)

    def test_env_read_outside_api_fails(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d)
        shutil.copytree(ROOT, d / "s", ignore=shutil.ignore_patterns("__pycache__", "node_modules"))
        (d / "s/plugins/social/leak.py").write_text("import os\nx = os.environ['A']\n")
        self.assertTrue(any("Runtime.secret" in e for e in scopecheck.check(d / "s")))

    def test_core_boots_without_plugins(self):
        import subprocess, sys
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d)
        shutil.copytree(ROOT, d / "s", ignore=shutil.ignore_patterns("__pycache__", "node_modules", "plugins"))
        r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=d / "s", capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])


class Gate(Base):
    def test_dry_run_default_sends_nothing(self):
        rt = self.rt(); rt.grant_consent("a@x.org")
        r = email.send(rt, "a@x.org", "hi", "hello", from_addr="me@x.org")
        self.assertEqual(r.status, "dry-run"); self.assertEqual(self.calls, [])
        self.assertNotIn("t0k", json.dumps(r.detail)); self.assertIn("<secret:MAIL_SEND_TOKEN>", json.dumps(r.detail))

    def test_disabled_and_kill(self):
        rt = self.rt(email={"enabled": False}); self.assertIn("not enabled", email.send(rt, "a@x.org", "s", "b").reason)
        rt = self.rt(email={"kill": True}); self.assertIn("kill", email.send(rt, "a@x.org", "s", "b").reason)

    def test_consent_and_suppression(self):
        rt = self.rt("live", "delegated")
        self.assertIn("consent", email.send(rt, "a@x.org", "s", "b").reason)
        rt.grant_consent("a@x.org"); self.assertEqual(email.send(rt, "a@x.org", "s", "b", from_addr="m@x.org").status, "sent")
        rt.suppress("a@x.org"); self.assertIn("suppressed", email.send(rt, "a@x.org", "s", "b").reason)

    def test_live_needs_rung_and_credentials_and_egress(self):
        rt = self.rt("live", "observed"); rt.grant_consent("a@x.org")
        self.assertIn("rung", email.send(rt, "a@x.org", "s", "b").reason)
        rt = self.rt("live", "delegated", env={}); rt.grant_consent("a@x.org")
        self.assertIn("credential bindings missing", email.send(rt, "a@x.org", "s", "b").reason)
        rt = self.rt("live", "delegated", env=dict(ENV, MAIL_SEND_URL="https://evil.example/send")); rt.grant_consent("a@x.org")
        rt.config["plugins"]["email"]["adapter_config"]["endpoint_env"] = "MAIL_SEND_URL"
        self.assertEqual(email.send(rt, "a@x.org", "s", "b").status, "sent")   # the configured endpoint host is the allowed host
        a = email.build_send(rt, "a@x.org", "s", "b"); a.request["url"] = "https://other.example/x"
        self.assertIn("egress", rt.perform(a).reason)

    def test_rate_cap(self):
        rt = self.rt("live", "delegated", email={"limits": {"max_sends_per_day": 2}})
        for i in range(3): rt.grant_consent(f"a{i}@x.org")
        res = [email.send(rt, f"a{i}@x.org", "s", "b", from_addr="m@x.org").status for i in range(3)]
        self.assertEqual(res, ["sent", "sent", "refused"])

    def test_scope_refuses_out_of_reach(self):
        rt = self.rt("live", "autonomous")
        self.assertIn("may not do", rt.perform(Action("mailing_list", "send_to_person", "file-store")).reason)
        self.assertIn("may not do", rt.perform(Action("selfdescribe", "publish_public", "repo")).reason)
        self.assertIn("not allowed", rt.perform(Action("social", "publish_public", "myspace")).reason)


class Mail(Base):
    def test_double_opt_in(self):
        rt = self.rt("live", "delegated")
        r = ml.subscribe(rt, "news", "n@x.org"); self.assertEqual(r.status, "sent")           # confirmation only
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(ml.campaign(rt, "news", "s", "b"), [])                              # not confirmed: nobody is mailed
        self.assertEqual(ml.confirm(rt, "news", "n@x.org", "bad").reason, "confirm refused: bad token")
        ml.confirm(rt, "news", "n@x.org", ml.token(rt, "news", "n@x.org"))
        out = ml.campaign(rt, "news", "s", "b"); self.assertEqual([r.status for _, r in out], ["sent"])
        self.assertIn("Unsubscribe:", self.calls[-1]["body"]["text"])
        ml.unsubscribe(rt, "news", "n@x.org")
        self.assertEqual(ml.campaign(rt, "news", "s", "b"), [])
        r = ml.subscribe(rt, "news", "n@x.org"); self.assertEqual((r.status, r.reason), ("refused", "subscribe refused: suppressed"))


class Social(Base):
    def test_text_must_be_approved(self):
        rt = self.rt("live", "delegated", social={"adapter_config": {"adapter": "mastodon", "instance_env": "MASTODON_URL", "token_env": "MASTODON_TOKEN"}})
        rt.guard_sources = ["Approved sentence."]
        self.assertIn("verbatim", social.publish(rt, "mastodon", "Invented claim.").reason)
        self.assertEqual(social.publish(rt, "mastodon", "Approved sentence.").status, "sent")
        self.assertEqual(self.calls[0]["headers"]["authorization"], "Bearer m")

    def test_bluesky_chain_and_buffer_discovery(self):
        rt = self.rt("live", "delegated"); rt.guard_sources = ["Hello."]
        self.assertEqual(social.publish(rt, "bluesky", "Hello.").status, "sent")
        self.assertEqual(self.calls[1]["headers"]["authorization"], "Bearer J"); self.assertEqual(self.calls[1]["body"]["repo"], "did:x")
        rt2 = self.rt("live", "delegated"); rt2.guard_sources = ["Hello."]
        self.assertEqual(social.publish(rt2, "buffer", "Hello.").status, "sent"); self.assertIn("profiles.json", self.calls[0]["url"])

    def test_blocked_pattern(self):
        rt = self.rt("live", "delegated"); t = "We guarantee results."; rt.guard_sources = [t]
        self.assertIn("blocked pattern", social.publish(rt, "mastodon", t).reason)


class Others(Base):
    def test_youtube_private_only_and_chain(self):
        rt = self.rt("live", "delegated")
        with self.assertRaises(ValueError): yt.build_upload(rt, "v.mp4", "t", "d", privacy="public")
        f = Path(tempfile.mkdtemp()) / "v.mp4"; f.write_bytes(b"x")
        self.assertEqual(yt.upload(rt, str(f), "t", "d").status, "sent")
        self.assertEqual(self.calls[2]["url"], "https://www.googleapis.com/upload/session/1")

    def test_gcp_reach(self):
        rt = self.rt("live", "autonomous")
        self.assertEqual(gcp.read(rt, "https://cloudresourcemanager.googleapis.com/v1/projects").status, "sent")
        self.assertIn("egress", gcp.read(rt, "https://example.com/x").reason)
        self.assertIn("managed-by", gcp.write(rt, "POST", "https://storage.googleapis.com/b", {"name": "x"}).reason)
        self.assertEqual(gcp.write(rt, "POST", "https://storage.googleapis.com/b", {"labels": {"managed-by": "ultrastable"}}).status, "sent")
        self.assertIn("out of bounds", gcp.write(rt, "DELETE", "https://storage.googleapis.com/b", {}).reason)
        rt2 = self.rt("live", "assisted"); self.assertIn("rung", gcp.write(rt2, "POST", "https://x.googleapis.com/a", {"labels": {"managed-by": "ultrastable"}}).reason)


class SelfAndFlow(Base):
    def test_self_description_current_and_drift(self):
        self.assertEqual(selfd.check(ROOT), [])
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d)
        shutil.copytree(ROOT, d / "s", ignore=shutil.ignore_patterns("__pycache__"))
        (d / "s/ultrastable.json").write_text((d / "s/ultrastable.json").read_text().replace("portfolio-manager", "portfolio-boss", 1))
        self.assertTrue(selfd.check(d / "s"))

    def test_flow(self):
        ok = {"goal": "join a list", "audience": "people with the problem", "tone": "plain and calm", "channels": ["a mailing list", "Mastodon"], "cadence": "weekly", "off_limits": "", "statement": "We help you start."}
        r = comm.build_brief(ok); self.assertEqual(r["gaps"], []); self.assertEqual(r["brief"]["plugins_to_enable"], ["email", "mailing_list", "social"])
        self.assertTrue(r["brief"]["statements"][0]["approved"])
        self.assertIn("goal", comm.build_brief({})["gaps"])
        self.assertTrue(any("not a choice" in g for g in comm.build_brief(dict(ok, tone="loud"))["gaps"]))
        said = iter(["1", "1", "1", "2,3", "2", "", "Hello there."]); out = comm.ask(input_fn=lambda _="": next(said), print_fn=lambda *_: None)
        self.assertEqual(out["channels"], ["a mailing list", "Mastodon"])

    def test_tick_dry_run(self):
        rt = self.rt(); rep = loops.run_tick(rt, ROOT)
        self.assertIn("what happened", rep["report"]); self.assertEqual(self.calls, [])
        self.assertTrue((rt.dir / "predictions.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
