"""BOOT-ACCEPT-1: every layer of a launched system is read live, together, and a missing one fails."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from foundation import bootaccept as ba

BASE = "https://ultrastable-seed-x.ultrastable.workers.dev"
FOOT = '<footer>Built on <a href="https://ultrastable.io/">Ultrastable</a> <a href="/.well-known/ultrastable.json">About</a></footer>'


def fake(overrides=None):
    pages = {
        "https://api.github.com/repos/o/x": (200, {}, json.dumps({"private": False})),
        BASE + "/health": (200, {}, json.dumps({"ok": True, "org": "x", "ignition": {"stage": "looping"}})),
        BASE + "/": (200, {"content-type": "text/html; charset=utf-8"}, "<html>" + FOOT),
        BASE + "/api/graph": (200, {}, json.dumps({"built": True, "last": {"nodes": 42}})),
        BASE + "/.well-known/ultrastable.json": (200, {}, json.dumps({"ultrastable": 1, "url": BASE, "repo": "https://github.com/o/x", "discoverable": True})),
        ba.DIRECTORY + "/directory.json": (200, {}, json.dumps({"external": [{"url": BASE + "/"}]})),
    }
    pages.update(overrides or {})
    return lambda url: pages.get(url, (404, {}, "Not found"))


class Probe(unittest.TestCase):
    def test_all_layers_pass_together(self):
        v = ba.verdict(ba.probe(BASE, "o/x", fake()))
        self.assertTrue(v["passed"], v)

    def test_health_only_gate_hiding_manifest_and_graph_fails_both(self):
        # the exact regression: LIVE-1's gate answered 404 for the routes DISCOVER-1 and DATAGRAPH-1 need
        g = fake({BASE + "/.well-known/ultrastable.json": (404, {}, "Not found"), BASE + "/api/graph": (404, {}, "Not found")})
        self.assertEqual(ba.verdict(ba.probe(BASE, "o/x", g))["failed_layers"], ["graph", "discovery"])

    def test_manifest_without_url_or_repo_fails_discovery(self):
        g = fake({BASE + "/.well-known/ultrastable.json": (200, {}, json.dumps({"ultrastable": 1, "url": None, "repo": None, "discoverable": True}))})
        layers = ba.probe(BASE, "o/x", g)
        self.assertFalse(layers["discovery"]["ok"])
        self.assertIn("manifest url", layers["discovery"]["detail"])

    def test_page_without_footer_fails_ui(self):
        g = fake({BASE + "/": (200, {"content-type": "text/html"}, "<html>no footer</html>")})
        self.assertEqual(ba.verdict(ba.probe(BASE, "o/x", g))["failed_layers"], ["ui"])

    def test_no_repository_is_a_failure_never_skipped(self):
        self.assertIn("repo", ba.verdict(ba.probe(BASE, None, fake()))["failed_layers"])

    def test_unlisted_in_directory_fails(self):
        g = fake({ba.DIRECTORY + "/directory.json": (200, {}, json.dumps({"external": []}))})
        self.assertEqual(ba.verdict(ba.probe(BASE, "o/x", g))["failed_layers"], ["discovery"])

    def test_unreachable_is_failure(self):
        self.assertEqual(len(ba.verdict(ba.probe(BASE, "o/x", lambda u: (0, {}, "URLError")))["failed_layers"]), len(ba.LAYERS))

    def test_failed_launch_fails_acceptance(self):
        recs = ba.accept([{"system": "x", "base": BASE, "repo": "o/x"}], get=fake(), launch={"passed": False, "failed_stages": {"provision": "boom"}}, sleep=lambda s: None)
        self.assertFalse(recs[0]["passed"])
        self.assertEqual(recs[0]["failed_layers"][0], "launch")


class Check(unittest.TestCase):
    def _root(self, rows):
        d = Path(tempfile.mkdtemp())
        (d / "doctrine").mkdir()
        (d / "ops").mkdir()
        (d / "doctrine" / "seed-deploys.json").write_text(json.dumps({"seeds": ["x"]}))
        (d / "doctrine" / "full-stack.json").write_text(json.dumps({"systems": {"x": {"repo": "o/x"}}}))
        (d / "ops" / "boot-accept.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        return d

    def test_check_fails_with_no_record(self):
        self.assertTrue(ba.check(self._root([])))

    def test_check_fails_on_failed_layer(self):
        row = {"at": ba._now(), "system": "x", "passed": False, "failed_layers": ["graph"], "layers": {"graph": {"ok": False, "detail": "/api/graph HTTP 404"}}}
        errs = ba.check(self._root([row]))
        self.assertTrue(errs and "HTTP 404" in errs[0])

    def test_check_fails_when_stale(self):
        old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.assertTrue(ba.check(self._root([{"at": old, "system": "x", "passed": True}])))

    def test_check_passes_on_fresh_pass(self):
        self.assertEqual(ba.check(self._root([{"at": ba._now(), "system": "x", "passed": True}])), [])

    def test_standing_systems_read_from_doctrine(self):
        s = ba.standing_systems()
        self.assertTrue(s and all(x["base"].startswith("https://ultrastable-seed-") for x in s))


if __name__ == "__main__":
    unittest.main()
