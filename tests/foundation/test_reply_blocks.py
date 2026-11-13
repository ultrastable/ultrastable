"""REPLY-BLOCKS-1: a reply that is not JSON is still usable when it carries FILE blocks; a reply with neither still fails."""
import unittest
from foundation import agents, executor

BLOCKS = (
    "SUMMARY: add two files\n"
    "<<<FILE a/b.py>>>\n"
    'print("q\\n")\n'
    'x = {"k": 1}\n'
    "<<<END>>>\n"
    "<<<FILE c.md>>>\n"
    "line\n"
    "<<<END>>>\n"
)


class ReplyBlocks(unittest.TestCase):
    def test_json_still_wins(self):
        out = agents.parse_json('note {"summary":"s","files":[{"path":"a.txt","content":"x"}]} end')
        self.assertEqual(out["files"][0]["path"], "a.txt")

    def test_blocks_parse_without_escaping(self):
        out = agents.parse_json(BLOCKS)
        self.assertEqual(out["summary"], "add two files")
        self.assertEqual([f["path"] for f in out["files"]], ["a/b.py", "c.md"])
        self.assertEqual(out["files"][0]["content"], 'print("q\\n")\nx = {"k": 1}\n')

    def test_broken_json_with_no_blocks_fails(self):
        with self.assertRaises(ValueError):
            agents.parse_json('{"summary": "s", "files": [{"path": "a", "content": "unterminated}')

    def test_block_paths_pass_the_same_guard(self):
        out = agents.parse_json("<<<FILE .github/workflows/x.yml>>>\na\n<<<END>>>")
        self.assertIsNotNone(executor.safe_path(out["files"][0]["path"]))

    def test_repair_prompt_switches_format(self):
        self.assertIn("<<<FILE", executor.agents_block_format())


if __name__ == "__main__":
    unittest.main()
