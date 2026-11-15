import shutil, sys, tempfile, unittest
from pathlib import Path
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import metasignal as m


class MetaSignal(unittest.TestCase):
    def test_config_and_samples(self):
        self.assertEqual(m.check(), [])

    def test_frustration_and_idea_detected(self):
        kinds = {s["kind"] for s in m.detect("I'm not going to keep telling you. What if we record it?")}
        self.assertTrue({"frustration", "idea"} <= kinds)

    def test_ingest_files_issue_once_and_dedupes(self):
        d = _repo.scratch()
        self.addCleanup(shutil.rmtree, d, True)
        cfg = m.load()
        rows = m.scan("how many times do I have to say it\nthat is perfect", "dictation", cfg, "2026-11-14T00:00:00+00:00")
        r1 = m.ingest(d, rows, cfg, True)
        self.assertEqual(r1["issues"], ["META-1"])
        self.assertTrue((d / "docs/issues/META-1.json").exists())
        r2 = m.ingest(d, rows, cfg, True)
        self.assertEqual((r2["signals"], r2["issues"]), (0, []))
        self.assertEqual(len((d / cfg["sink"]).read_text().splitlines()), 2)

    def test_mic_events_file_after_threshold(self):
        d = _repo.scratch()
        self.addCleanup(shutil.rmtree, d, True)
        cfg = m.load()
        rows = [r for i in range(3) for r in m.mic_event("not-allowed", cfg, f"2026-11-14T00:00:0{i}+00:00")]
        self.assertEqual(m.ingest(d, rows, cfg, True)["issues"], ["META-1"])
        self.assertEqual(m.mic_event("bogus", cfg), [])


if __name__ == "__main__":
    unittest.main()
