"""RND-1: competitor profiles refresh on cadence and diff, the market diffs against what this repo proves, gaps and experiments file once, scout items triage into tasks, outcomes feed back."""
import datetime as dt, json, shutil, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import rnd as R, scout as S, executor as X  # noqa: E402
import _repo  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
NOW = dt.datetime(2026, 11, 12, 12, 0, tzinfo=dt.timezone.utc)
PAGE_A = "<html><body><p>Run agents on a schedule with routines.</p><p>Review pull requests with a code review agent and connect over MCP.</p></body></html>"
PAGE_B = PAGE_A + "<p>New: sandbox execution with spend limits.</p>"


def make(extra_comps=None):
    d = Path(_repo.scratch())
    for p in ("doctrine", "docs/issues", "ops/scout", "ops/rnd", "foundation", "agents/roles"):
        (d / p).mkdir(parents=True, exist_ok=True)
    for f in ("doctrine/market.json", "doctrine/scout.json", "doctrine/growth.json"):
        shutil.copy(REPO / f, d / f)
    cfg = R.load(REPO)
    cfg["competitors"] = [{"id": "rival-one", "name": "Rival One", "sources": [{"url": "https://x.test/1", "kind": "page"}]},
                          {"id": "rival-two", "name": "Rival Two", "sources": [{"url": "https://x.test/2", "kind": "page"}]}]
    (d / R.PATH).write_text(json.dumps(cfg))
    return d


class Rnd(unittest.TestCase):
    def test_repo_declaration_valid(self):
        self.assertEqual(R.check(REPO), [])

    def test_profile_detects_capabilities_and_skips_until_due(self):
        d = make(); cfg = R.load(d)
        r = R.refresh(d, cfg, lambda u: PAGE_A, NOW, True)
        caps = R.profiles(d)["rival-one"]["capabilities"]
        self.assertTrue({"scheduled-agents", "cross-model-review", "mcp-server"} <= set(caps))
        self.assertEqual(r["rival-one"]["appeared"], [])
        again = R.refresh(d, cfg, lambda u: PAGE_B, NOW + dt.timedelta(days=1), True)
        self.assertTrue(again["rival-one"]["skipped"])
        later = R.refresh(d, cfg, lambda u: PAGE_B, NOW + dt.timedelta(days=7), True)
        self.assertTrue({"sandboxed-execution", "spend-budgets"} <= set(later["rival-one"]["appeared"]))
        self.assertTrue(later["rival-one"]["changed"])

    def test_a_capability_new_to_the_taxonomy_is_not_news(self):
        d = make(); cfg = R.load(d)
        R.refresh(d, cfg, lambda u: PAGE_A, NOW, True)
        cfg["capabilities"].append({"id": "routines-word", "what": "says routines", "component": "loops-autonomy", "rx": "routines", "ours": "file:nope"})
        (d / R.PATH).write_text(json.dumps(cfg))
        later = R.refresh(d, R.load(d), lambda u: PAGE_A, NOW + dt.timedelta(days=7), True)
        self.assertEqual(later["rival-one"]["appeared"], [])  # the page said it all along; only the regex is new
        self.assertIn("routines-word", R.profiles(d)["rival-one"]["capabilities"])
        third = R.refresh(d, R.load(d), lambda u: PAGE_B, NOW + dt.timedelta(days=14), True)
        self.assertTrue({"sandboxed-execution", "spend-budgets"} <= set(third["rival-one"]["appeared"]))

    def test_an_unreachable_source_loses_no_capability(self):
        d = make(); cfg = R.load(d)
        cfg["competitors"] = [{"id": "rival-one", "name": "Rival One", "sources": [{"url": "https://x.test/1", "kind": "page"}, {"url": "https://x.test/2", "kind": "page"}]}]
        (d / R.PATH).write_text(json.dumps(cfg))
        R.refresh(d, cfg, lambda u: PAGE_A if u.endswith("/1") else "<p>sandbox execution</p>", NOW, True)
        def f(u):
            if u.endswith("/2"): raise OSError("403")
            return PAGE_A
        later = R.refresh(d, cfg, f, NOW + dt.timedelta(days=7), True)
        prof = R.profiles(d)["rival-one"]
        self.assertEqual(later["rival-one"]["lost"], []); self.assertIn("sandboxed-execution", prof["capabilities"])
        self.assertEqual(prof["sources_read"], ["https://x.test/1"]); self.assertIn("https://x.test/2", prof["errors"])

    def test_dead_source_is_recorded(self):
        d = make()
        def f(u):
            if u.endswith("/1"): raise OSError("403")
            return PAGE_A
        r = R.refresh(d, R.load(d), f, NOW, True)
        self.assertIn("OSError", r["rival-one"]["errors"]["https://x.test/1"])
        self.assertNotIn("rival-one", R.profiles(d))

    def test_gap_and_experiment_file_once(self):
        d = make(); (d / "docs/issues/Q-GAP-cross-model-rescoring.json").write_text("{}")
        row = R.run(d, lambda u: PAGE_A, NOW, True)
        self.assertIn("Q-GAP-cross-model-rescoring", row["gaps"])  # carried by the existing item, not duplicated
        self.assertFalse((d / "docs/issues/Q-RND-GAP-cross-model-review.json").exists())
        self.assertTrue(row["experiments"])
        first = [r["id"] for r in R._rows(d, "experiments.jsonl")]
        R.run(d, lambda u: PAGE_A, NOW + dt.timedelta(days=8), True)
        ids = [r["id"] for r in R._rows(d, "experiments.jsonl")]
        self.assertEqual(ids[:len(first)], first)  # earlier experiments are not re-proposed
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreater(R.report(d)["priorities"]["Q-GAP-cross-model-rescoring"], 1)

    def test_new_gap_without_existing_item_is_filed(self):
        d = make()
        R.run(d, lambda u: PAGE_A, NOW, True)
        p = d / "docs/issues/Q-RND-GAP-cross-model-review.json"
        self.assertTrue(p.is_file())
        body = json.loads(p.read_text())["body"]
        self.assertIn("**Done check:** cmd:python3 -m foundation rnd --proved cross-model-review", body)
        self.assertIn("file:foundation/rescore.py", body)
        from foundation import specgate
        self.assertEqual(specgate.missing(body), [])  # SPEC-GATE-1: the loop's own filing passes the gate
        for f in (d / "docs/issues").glob("Q-EXP-*.json"):
            self.assertEqual(specgate.missing(json.loads(f.read_text())["body"]), [], f.name)
        gaps = R.metrics(d)["competitor_coverage_gaps"]
        self.assertGreaterEqual(gaps, 1); self.assertIn(f"competitor_coverage_gaps <= {gaps - 1} within 336 h", body)
        self.assertFalse(R.probe_ok(d, R.PROVED + "cross-model-review"))
        (d / "foundation").mkdir(exist_ok=True); (d / "foundation/rescore.py").write_text("# proof\n")
        self.assertTrue(R.probe_ok(d, R.PROVED + "cross-model-review")); self.assertEqual(R.metrics(d)["competitor_coverage_gaps"], gaps - 1)
        self.assertTrue(R.probe_ok(d, R.HOLDS + "'file:foundation/rescore.py'")); self.assertFalse(R.probe_ok(d, R.PROVED + "no-such-capability"))

    def test_triage_decisions_and_auto_rule(self):
        d = make()
        for iid, body in (("Q-SCOUT-claude-code-aaaaaaaa", "matched gap:other-cloud-proof\nrelease about gateway budgets"),
                          ("Q-SCOUT-claude-code-bbbbbbbb", "matched gap:cross-model-rescoring\nre-score predictions with a second model across models")):
            (d / "docs/issues" / (iid + ".json")).write_text(json.dumps({"id": iid, "title": iid, "body": body}))
        out = {t["id"]: t["outcome"] for t in R.triage(d, R.load(d), NOW, True)}
        self.assertEqual(out["Q-SCOUT-claude-code-aaaaaaaa"], "declined")
        self.assertEqual(out["Q-SCOUT-claude-code-bbbbbbbb"], "adopted")
        self.assertEqual({r["id"] for r in S._rows(d, "adopted.jsonl")}, set(out))
        self.assertEqual(R.triage(d, R.load(d), NOW, True), [])  # decided once

    def test_triage_reads_the_finding_not_the_item_boilerplate(self):
        from foundation import scout as S
        src = {"id": "cloudflare-blog", "topic": "agent platform"}
        e = {"id": "x", "title": "How a WAF helps protect against a Java flaw", "link": "https://example.test/waf", "summary": "A vendor has released rules for matching requests; record the outcome."}
        it = S.item(src, e, 2.0, ["gap:executor-merged-pr"])
        text = R.finding_text(it["body"])
        self.assertIn("WAF", text); self.assertNotIn("Decide:", text); self.assertNotIn("Done check", text)
        e2 = dict(e, summary="A vendor published rules for matching traffic.")
        body2 = S.item(src, e2, 2.0, ["gap:executor-merged-pr"])["body"]
        for word in ("outcome", "adopt", "gap", "decline"):  # words of the item template, present in every finding the scout files
            self.assertIn(word, S.tokens(body2)); self.assertNotIn(word, S.tokens(R.finding_text(body2)))
        self.assertEqual(R.finding_text("no header at all"), "no header at all")

    def test_recorded_decisions_adopt_into_tasks_and_ship_feeds_back(self):
        d = make()
        shutil.copy(REPO / "ops/rnd/triage.json", d / "ops/rnd/triage.json")
        iid = "Q-SCOUT-claude-code-865f57db"
        (d / "docs/issues" / (iid + ".json")).write_text(json.dumps({"id": iid, "title": iid, "body": "matched gap:executor-merged-pr"}))
        R.triage(d, R.load(d), NOW, True)
        task = d / "docs/issues/Q-ADOPT-write-containment.json"
        self.assertTrue(task.is_file())
        self.assertEqual(R.source_of(d, "Q-ADOPT-write-containment"), "claude-code")
        self.assertEqual(R.outcomes(d, R.load(d), NOW, True), [])  # probe fails here: no executor.py in the scratch tree, not yet stalled
        (d / "foundation/executor.py").write_text("raise ValueError('resolves outside the working tree')")
        res = R.outcomes(d, R.load(d), NOW, True)
        self.assertEqual(res[0]["outcome"], "shipped")
        before = S._rows(d, "adopted.jsonl")
        R.feedback(d, res, NOW, True)
        self.assertEqual(len(S._rows(d, "adopted.jsonl")), len(before) + 1)
        self.assertEqual(R.outcomes(d, R.load(d), NOW, True), [])  # scored once

    def test_stalled_task_after_stall_days(self):
        d = make()
        R._issue(d, "Q-EXP-deadbeef", "t", "**Done check:** file:nope.txt\n", ["growth"])
        late = NOW + dt.timedelta(days=60)
        self.assertEqual(R.outcomes(d, R.load(d), late, True)[0]["outcome"], "stalled")

    def test_boost_orders_by_priority(self):
        d = make(); (d / "ops/rnd/priorities.json").write_text(json.dumps({"Q-B": 2.0}))
        self.assertEqual([i["title"] for i in R.boost([{"title": "Q-A: a"}, {"title": "Q-B: b"}], d)], ["Q-B: b", "Q-A: a"])

    def test_executor_refuses_symlink_escape(self):
        d = Path(_repo.scratch()); out = Path(_repo.scratch())
        (d / "link").symlink_to(out)
        with self.assertRaises(ValueError):
            X.apply_edits([{"path": "link/x.txt", "content": "no"}], d)
        self.assertFalse((out / "x.txt").exists())
        self.assertEqual(X.apply_edits([{"path": "ok/x.txt", "content": "yes"}], d), ["ok/x.txt"])

    def test_rule_and_wiring_present(self):
        for f in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
            self.assertIn("RND-1", (REPO / f).read_text(encoding="utf-8"), f)
        self.assertIn("foundation rnd --run --apply", (REPO / ".github/workflows/scout.yml").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()


class PlugIn(unittest.TestCase):
    """BORROW-1: plugged-in competitor workers are data the check validates."""

    def test_rows_valid(self):
        from foundation import rnd
        cfg = rnd.load()
        self.assertTrue(any(c.get("plug_in") for c in cfg["competitors"]))
        for c in cfg["competitors"]:
            self.assertEqual(rnd.plug_in_problems(c), [], c["id"])

    def test_live_without_wiring_fails(self):
        from foundation import rnd
        row = {"id": "x", "plug_in": {"role": "reviewer", "status": "live", "default": "ours",
               "source": "https://example.com", "probe": "file:does/not/exist"}}
        self.assertTrue(any("says live" in b for b in rnd.plug_in_problems(row)))
