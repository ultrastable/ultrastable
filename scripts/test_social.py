import json, unittest, datetime as dt
from social_lib import *
import social_post

class T(unittest.TestCase):
    def test_calendar_all_clean(self):
        for p in load("calendar.json")["posts"]:
            if p.get("kind") in ("event", "paper"): continue  # THOUGHT-1 paper posts are checked by foundation.thought (python3 -m foundation thought --check)  # REACH-1 event posts are checked by foundation.reach.guard (tests/foundation/test_reach.py)
            self.assertEqual(guard(p["text"], p["source"]), [], p["text"])
    def test_blocks_invented_text(self):
        self.assertTrue(guard("Ultrastable now has 500 customers.", "external/one-pager.md"))
    def test_blocks_qnfo_and_patent(self):
        for t in ["Ultrastable runs the system, tested at QNFO.", "Ultrastable is patent pending."]:
            self.assertTrue(guard(t, "external/one-pager.md"))
    def test_blocks_unlisted_source(self):
        self.assertTrue(guard("Ultrastable is an autonomous business system.", "docs/overview.md"))
    def test_sources_exist_and_safe(self):
        for s in load("guard.json")["sources"]:
            self.assertTrue((ROOT / s).exists(), s)
            self.assertFalse(s.startswith(("ip/", "docs/")))
    def test_dry_run_posts_nothing(self):
        self.assertEqual(social_post.main(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc), release=lambda: None), 0)
        self.assertFalse((S / "state.json").exists())
    def test_kill_switch(self):
        g = load("gate.json"); self.assertIn("kill", g)
        orig = social_post.load
        social_post.load = lambda n: {**orig(n), "kill": True} if n == "gate.json" else orig(n)
        try:
            self.assertEqual(social_post.main(), 0)
        finally:
            social_post.load = orig

    # VIDEO-2: the demo video is attached once per release update, on a guarded text, and only when the release is public
    REL = {"assets": [{"name": "demo.mp4", "updated_at": "2026-11-19T04:00:00Z", "browser_download_url": "https://github.com/ultrastable/ultrastable/releases/download/demo-video/demo.mp4"}]}
    def test_video_release_reads_the_published_asset_and_nothing_else(self):
        r = social_post.video_release(lambda url: self.REL)
        self.assertEqual(r, {"url": "https://github.com/ultrastable/ultrastable/releases/download/demo-video/demo.mp4", "updated": "2026-11-19T04:00:00Z"})
        self.assertIsNone(social_post.video_release(lambda url: {"assets": [{"name": "other.mp4", "updated_at": "x", "browser_download_url": "y"}]}))
        self.assertIsNone(social_post.video_release(lambda url: {"assets": [{"name": "demo.mp4", "updated_at": "x", "browser_download_url": "https://elsewhere.example/demo.mp4"}]}), "an asset served from another address is not attached")
        def gone(url): raise social_post.urllib.error.URLError("404")
        self.assertIsNone(social_post.video_release(gone), "a private or missing release attaches nothing")
    def test_video_post_is_due_once_per_release_and_its_text_passes_the_guard(self):
        rel, today = social_post.video_release(lambda url: self.REL), dt.date(2026, 11, 20)
        p = social_post.video_post({"posted": []}, rel, today)
        self.assertEqual((p["id"], p["kind"], p["media"]), ("video-2026-11-19", "video", rel["url"]))
        self.assertEqual(guard(p["text"], p["source"]), [])
        self.assertIsNone(social_post.video_post({"video": {"updated": rel["updated"]}}, rel, today), "the same release is not posted again")
        self.assertIsNotNone(social_post.video_post({"video": {"updated": "2026-11-01T00:00:00Z"}}, rel, today), "a rebuilt video is due again")
        self.assertIsNone(social_post.video_post({}, None, today))
    def test_adapters_attach_the_video_and_keep_the_text(self):
        sent, orig, env = [], social_post.http, dict(social_post.os.environ)
        social_post.http = lambda url, body, headers: (sent.append((url, body)), {"did": "d", "accessJwt": "j", "uri": "at://x", "url": "https://m/1"})[1]
        social_post.os.environ.update(BLUESKY_HANDLE="h", BLUESKY_APP_PASSWORD="p", MASTODON_INSTANCE="m.example", MASTODON_TOKEN="t")
        try:
            social_post.bluesky("Ultrastable runs on itself.", "id", "https://github.com/o/r/releases/download/demo-video/demo.mp4")
            rec = sent[-1][1]["record"]
            self.assertEqual(rec["text"], "Ultrastable runs on itself."); self.assertEqual(rec["embed"]["external"]["uri"], "https://github.com/o/r/releases/download/demo-video/demo.mp4")
            social_post.bluesky("Ultrastable runs on itself.", "id"); self.assertNotIn("embed", sent[-1][1]["record"])
            social_post.mastodon("Ultrastable runs on itself.", "id", "https://github.com/o/r/releases/download/demo-video/demo.mp4")
            self.assertEqual(sent[-1][1]["status"], "Ultrastable runs on itself.\nhttps://github.com/o/r/releases/download/demo-video/demo.mp4")
        finally:
            social_post.http = orig; social_post.os.environ.clear(); social_post.os.environ.update(env)
    def test_dry_run_prints_the_video_post_first_and_records_nothing(self):
        import io, contextlib
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(social_post.main(dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc), release=lambda: social_post.video_release(lambda url: self.REL)), 0)
        self.assertIn("[video https://github.com/ultrastable/ultrastable/releases/download/demo-video/demo.mp4]", out.getvalue())
        self.assertFalse((S / "state.json").exists())

if __name__ == "__main__":
    unittest.main()
