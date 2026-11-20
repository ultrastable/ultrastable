"""OWNER-PROBE-1: an owner act closes by a machine read, never by the owner reporting back."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import needsyou

REPO = Path(__file__).resolve().parents[2]


class NeedsYou(unittest.TestCase):
    def test_repo_is_clean_and_every_item_has_a_probe_or_a_reason(self):
        self.assertEqual(needsyou.check(REPO), [])
        for i in json.loads(needsyou.DATA.read_text(encoding="utf-8"))["items"]:
            self.assertTrue(bool(i.get("probe")) != bool(i.get("no_probe")), i["id"])

    def test_no_item_sends_the_owner_to_register_an_app_or_to_a_cloud_console(self):
        t = needsyou.DATA.read_text(encoding="utf-8") + (REPO / "NEEDS-YOU.md").read_text(encoding="utf-8")
        for banned in ("console.cloud.google.com", "console.aws.amazon.com", "portal.azure.com", "oauth-apps"):
            self.assertNotIn(banned, t)

    def test_probe_readings(self):
        health = json.dumps({"ok": True, "github_connected": True, "connected": ["github-app", "oauth:bluesky"]})
        self.assertIs(needsyou.probe_done({"url": "https://x.example/h", "json": "connected", "contains": "oauth:bluesky"}, lambda u: health), True)
        self.assertIs(needsyou.probe_done({"url": "https://x.example/h", "json": "connected", "contains": "oauth:mastodon"}, lambda u: health), False)
        self.assertIs(needsyou.probe_done({"url": "https://x.example/h", "json": "github_connected", "equals": True}, lambda u: health), True)
        self.assertIs(needsyou.probe_done({"url": "https://x.example/p", "contains": "PINNED"}, lambda u: "<html>PINNED_REPO</html>"), True)
        self.assertIs(needsyou.probe_done({"url": "https://x.example/h", "json": "missing.key", "equals": 1}, lambda u: health), None)  # unreadable: left alone

        def down(u):
            raise OSError("network down")
        self.assertIs(needsyou.probe_done({"url": "https://x.example/h", "contains": "x"}, down), None)

    def test_reconcile_removes_done_items_and_keeps_the_rest(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        item = lambda id, **k: {"id": id, "title": id, "why": "w", "default": "d", "url": "https://x.example/" + id, "button": "b", **k}
        data, out = d / "needs-you.json", d / "NEEDS-YOU.md"
        data.write_text(json.dumps({"items": [item("done", probe={"url": "https://x.example/a", "contains": "yes"}), item("open", probe={"url": "https://x.example/b", "contains": "yes"}),
                                              item("unreadable", probe={"url": "https://x.example/c", "json": "k", "equals": 1}), item("manual", no_probe="no read exists")], "done_for_you": []}), encoding="utf-8")
        get = lambda u: {"https://x.example/a": "yes", "https://x.example/b": "no"}.get(u, "not json")
        self.assertEqual(needsyou.reconcile(data, out, get), ["done"])
        self.assertEqual([i["id"] for i in json.loads(data.read_text(encoding="utf-8"))["items"]], ["open", "unreadable", "manual"])
        self.assertNotIn("## done", out.read_text(encoding="utf-8")); self.assertIn("## open", out.read_text(encoding="utf-8"))
        self.assertEqual(needsyou.reconcile(data, out, get), [])  # idempotent

    def test_check_refuses_an_item_with_neither_probe_nor_reason(self):
        d = json.loads(needsyou.DATA.read_text(encoding="utf-8"))
        orig = needsyou.DATA
        t = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, t, True)
        d["items"].append({"id": "bare", "title": "t", "why": "w", "default": "d", "url": "https://x.example/", "button": "b"})
        (t / "n.json").write_text(json.dumps(d), encoding="utf-8")
        needsyou.DATA = t / "n.json"
        try:
            self.assertTrue(any("bare" in b and "OWNER-PROBE-1" in b for b in needsyou.check(REPO)))
        finally:
            needsyou.DATA = orig


if __name__ == "__main__":
    unittest.main()
