"""DOC-CONSUMED-1: every document has a consumer. Ultrastable is the foundation for any autonomous system."""
import json, subprocess, tempfile, unittest
from pathlib import Path

from foundation import docs_audit, kb
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)

REPO = Path(__file__).resolve().parents[2]
REG = {"consumers": [], "removed": [], "ignore_references_from": [], "human_action_patterns": [r"\bRowan (should|must)\b"], "human_action_exempt": [], "human_action_baseline": {}}


def mk(files: dict, reg=None):
    d = Path(scratch())
    (d / "doctrine").mkdir()
    (d / "brand/templates").mkdir(parents=True)
    (d / "brand/templates/doc-template.md").write_text("---\nconsumer: tpl_user.py\n---\n# t\n")
    (d / "tpl_user.py").write_text("brand/templates/doc-template.md\n")
    (d / docs_audit.REGISTRY).write_text(json.dumps(reg or REG))
    for p, t in files.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_bytes(t.encode())
    subprocess.run(["git", "init", "-q"], cwd=d, check=True)
    subprocess.run(["git", "add", "-A"], cwd=d, check=True)
    return d


class DocsAudit(unittest.TestCase):
    def test_orphan_fails(self):
        """US-12-R16, US-12-T08: a document nothing names is listed as an orphan and the audit fails."""
        d = mk({"notes/plan.md": "# plan\nread by nobody\n"})
        bad = docs_audit.check(d)
        self.assertTrue(any("orphan document" in b and "notes/plan.md" in b for b in bad))

    def test_path_reference_from_code_consumes(self):
        d = mk({"notes/plan.md": "# plan\n", "tool.py": "open('notes/plan.md')\n"})
        self.assertEqual(docs_audit.evaluate(d)["consumed"]["notes/plan.md"][0], "path")
        self.assertEqual(docs_audit.check(d), [])

    def test_mention_by_another_document_is_not_consumption(self):
        d = mk({"a.md": "# a\nsee b.md\n", "b.md": "# b\nsee a.md\n"})
        self.assertEqual(sorted(docs_audit.evaluate(d)["orphans"]), ["a.md", "b.md"])

    def test_agent_instruction_import_consumes_transitively(self):
        d = mk({"CLAUDE.md": "@agents/AGENTS.md\n", "agents/AGENTS.md": "# a\n@../docs/x.md\n", "docs/x.md": "# x\n"})
        self.assertEqual(docs_audit.evaluate(d)["consumed"]["docs/x.md"][0], "import")

    def test_front_matter_consumer_must_exist_and_name_the_doc(self):
        d = mk({"n/a.md": "---\nconsumer: tool.py\n---\n# a\n", "tool.py": "read('n/a.md')\n"})
        self.assertEqual(docs_audit.evaluate(d)["consumed"]["n/a.md"][0], "declared")
        d2 = mk({"n/a.md": "---\nconsumer: tool.py\n---\n# a\n", "tool.py": "pass\n"})
        self.assertTrue(docs_audit.evaluate(d2)["problems"])

    def test_registry_row_needs_real_needle(self):
        reg = dict(REG, consumers=[{"id": "r", "paths": ["n/*.md"], "consumer": "tool.py", "needle": "walk", "how": "x"}])
        ok = mk({"n/a.md": "# a\n", "tool.py": "walk()\n"}, reg)
        self.assertEqual(docs_audit.evaluate(ok)["consumed"]["n/a.md"][0], "registry")
        bad = mk({"n/a.md": "# a\n", "tool.py": "pass\n"}, reg)
        self.assertTrue(any("needle" in p for p in docs_audit.evaluate(bad)["problems"]))

    def test_a_document_cannot_be_its_own_consumer(self):
        reg = dict(REG, consumers=[{"id": "r", "paths": ["n/*.md"], "consumer": "n/b.md", "needle": "x", "how": "x"}])
        d = mk({"n/a.md": "# a\n", "n/b.md": "x\n"}, reg)
        self.assertTrue(any("non-document" in p for p in docs_audit.evaluate(d)["problems"]))

    def test_removal_ledger_checks_bytes_and_dangling_references(self):
        """US-12-R16: a removed document is kept in the ledger with its digest, and a reference to it fails."""
        import hashlib
        keep = "# same\n"
        sha = hashlib.sha256(keep.encode()).hexdigest()
        row = {"path": "old.md", "sha256": sha, "duplicate_of": "new.md", "reason": "dup", "date": "2026-11-12", "recover": "abc"}
        d = mk({"new.md": keep, "t.py": "open('new.md')\n"}, dict(REG, removed=[row]))
        self.assertEqual(docs_audit.check(d), [])
        (d / "new.md").write_text("# changed\n")
        self.assertTrue(any("no longer holds the same bytes" in b for b in docs_audit.removed_check(d, json.loads((d / docs_audit.REGISTRY).read_text()))))
        d2 = mk({"new.md": keep, "t.py": "open('old.md'); open('new.md')\n"}, dict(REG, removed=[row]))
        self.assertTrue(any("still names removed document old.md" in b for b in docs_audit.check(d2)))

    def test_human_action_ratchet(self):
        d = mk({"t.py": "open('p.md')\n", "p.md": "# p\nRowan should file this.\n"})
        self.assertTrue(any("tells a person to act" in b for b in docs_audit.check(d)))
        reg = dict(REG, human_action_baseline={"p.md": 1})
        self.assertEqual(docs_audit.check(mk({"t.py": "open('p.md')\n", "p.md": "# p\nRowan should file this.\n"}, reg)), [])

    def test_template_carries_consumer_front_matter(self):
        self.assertIn("consumer:", (REPO / "brand/templates/doc-template.md").read_text())


class Knowledge(unittest.TestCase):
    def test_retrieve_ranks_matching_reference_for_an_issue(self):
        reg = dict(REG, knowledge={"globs": ["ref/**"]})
        d = mk({"ref/funding.md": "# Funding credits\ncloud credits programme for startups\n", "ref/other.md": "# Gardening\nroses\n"}, reg)
        out = kb.retrieve("apply for startup cloud credits funding", d)
        self.assertIn("ref/funding.md", out)
        self.assertNotIn("ref/other.md", out)

    def test_executor_prompt_reads_the_knowledge_tier(self):
        self.assertIn("kb.retrieve", (REPO / "foundation/executor.py").read_text())


class ThisRepo(unittest.TestCase):
    def test_every_document_in_this_repo_is_consumed(self):
        self.assertEqual(docs_audit.check(REPO), [])


if __name__ == "__main__":
    unittest.main()
