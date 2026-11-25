"""SCOUT-1: feeds parse, entries score against the gap register, findings file as growth items, outcomes re-weight sources, a dead source is recorded."""
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import scout as S  # noqa: E402
import _repo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
ATOM = """<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:x,1</id><title>Background agents with scheduled runs and a shared back end</title><link href="https://example.test/r/1"/><updated>2026-11-10T00:00:00Z</updated><content>&lt;p&gt;Scheduled background agent runs, durable workflow, MCP and observability tracing.&lt;/p&gt;</content></entry>
<entry><id>tag:x,2</id><title>Fix typo in docs</title><link href="https://example.test/r/2"/><updated>2026-11-10T00:00:00Z</updated><content>typo</content></entry></feed>"""
RSS = """<rss><channel><item><guid>g1</guid><title>Scheduled autonomous agents on a durable workflow</title><link>https://example.test/b/1</link><description>autonomous scheduled background agent with durable workflow and evals</description></item></channel></rss>"""


def make(sources):
    d = Path(_repo.scratch()); (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True)
    cfg = S.load(REPO); cfg["sources"] = sources; (d / S.PATH).write_text(json.dumps(cfg))
    (d / "doctrine/market.json").write_text((REPO / "doctrine/market.json").read_text())
    return d


SRC = [{"id": "feed-one", "kind": "atom", "url": "https://x.test/a", "topic": "t"}, {"id": "blog", "kind": "rss", "url": "https://x.test/b", "topic": "t"}]


def fetch(url, timeout=30):
    return ATOM if url.endswith("/a") else RSS


class Scout(unittest.TestCase):
    def test_repo_declaration_is_valid(self):
        self.assertEqual(S.check(REPO), [])

    def test_parse_atom_and_rss(self):
        a = S.parse("atom", ATOM); self.assertEqual(len(a), 2); self.assertEqual(a[0]["link"], "https://example.test/r/1")
        self.assertIn("Scheduled background agent", a[0]["summary"]); self.assertEqual(S.parse("rss", RSS)[0]["id"], "g1")

    def test_run_files_only_over_threshold_and_is_idempotent(self):
        d = make(SRC); row = S.run(d, fetch, apply=True)
        self.assertEqual(row["scanned"], 3); self.assertTrue(row["filed"]); self.assertFalse(any("typo" in i.lower() for i in row["filed"]))
        it = json.loads((d / "docs/issues" / (row["filed"][0] + ".json")).read_text()); self.assertIn("growth", it["labels"]); self.assertIn("Done check:** grep:ops/scout/adopted.jsonl", it["body"])
        again = S.run(d, fetch, apply=True); self.assertEqual((again["scanned"], again["filed"]), (0, []))
        self.assertEqual(len((d / "ops/scout/log.jsonl").read_text().splitlines()), 2)

    def test_a_new_version_of_an_adopted_standard_is_filed_whatever_it_scores(self):
        """STANDARDS-FIRST-1: the first reading of a standard's release feed records what exists; every entry after that becomes an item."""
        src = [{"id": "ce-spec", "kind": "atom", "url": "https://x.test/std", "topic": "adopted standards", "standard": "cloudevents"}]
        feed = lambda n: '<feed xmlns="http://www.w3.org/2005/Atom">' + "".join(f"<entry><id>tag:ce,{i}</id><title>v1.0.{i}</title><link href=\"https://example.test/ce/{i}\"/><updated>2026-11-1{i}T00:00:00Z</updated><content>patch release</content></entry>" for i in range(1, n + 1)) + "</feed>"
        d = make(src)
        first = S.run(d, lambda url, timeout=30: feed(2), apply=True)
        self.assertEqual((first["scanned"], first["filed"]), (2, []))
        nxt = S.run(d, lambda url, timeout=30: feed(3), apply=True)
        self.assertEqual(len(nxt["filed"]), 1)
        it = json.loads((d / "docs/issues" / (nxt["filed"][0] + ".json")).read_text())
        self.assertIn("v1.0.3", it["title"]); self.assertIn("standard:cloudevents", it["body"]); self.assertIn("`cloudevents` in seed/standards/standards.json", it["body"])
        self.assertEqual(S.run(d, lambda url, timeout=30: feed(3), apply=True)["filed"], [])

    def test_a_watched_standard_must_be_in_the_register(self):
        d = make([{"id": "x-spec", "kind": "atom", "url": "https://x.test/std", "topic": "t", "standard": "no-such-standard"}])
        self.assertTrue(any("no-such-standard" in b for b in S.check(d)))
        self.assertTrue(all(any(e["id"] == s["standard"] for e in json.loads((REPO / "seed/standards/standards.json").read_text())["entries"]) for s in S.load(REPO)["sources"] if "standard" in s))

    def test_outcomes_reweight_sources(self):
        d = make(SRC); row = S.run(d, fetch, apply=True); iid = next(i for i in row["filed"] if "-feed-one-" in i)
        S.adopt(d, iid, "adopted", "shipped"); S.run(d, fetch, apply=True)
        w = json.loads((d / "ops/scout/weights.json").read_text()); self.assertGreater(w["feed-one"]["weight"], 1.0)
        iid2 = next(i for i in row["filed"] if "-blog-" in i); S.adopt(d, iid2, "declined", "not a fit"); S.run(d, fetch, apply=True)
        self.assertLess(json.loads((d / "ops/scout/weights.json").read_text())["blog"]["weight"], 1.0)

    def test_dead_source_is_recorded_not_swallowed(self):
        d = make(SRC)
        def bad(url, timeout=30):
            if url.endswith("/a"): raise OSError("down")
            return RSS
        row = S.run(d, bad, apply=True); self.assertIn("feed-one", row["errors"]); self.assertTrue(row["filed"])

    def test_adopt_requires_reason(self):
        with self.assertRaises(ValueError): S.adopt(make(SRC), "Q-SCOUT-x", "adopted", " ")

    def test_src_of_matches_hyphenated_ids(self):
        self.assertEqual(S.src_of("Q-SCOUT-claude-code-abc12345", S.load(REPO)), "claude-code")


class Rule(unittest.TestCase):
    def test_rule_is_in_both_agent_files_and_the_workflow_runs_the_scout(self):
        for p in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
            t = (REPO / p).read_text(encoding="utf-8"); self.assertIn("SCOUT-1", t, p); self.assertIn("foundation/scout.py", t, p)
        w = (REPO / ".github/workflows/scout.yml").read_text(encoding="utf-8")
        self.assertIn("python3 -m foundation scout --run --apply", w); self.assertIn("actions_guard.py scout", w)
