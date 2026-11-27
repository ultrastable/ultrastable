# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, unittest

from foundation import tokenlog as t


def A(rid, tid, name, **u):
    return json.dumps({"type": "assistant", "requestId": rid, "message": {"usage": {"input_tokens": 1, "output_tokens": 5, **u}, "content": [{"type": "tool_use", "id": tid, "name": name}]}})


def R(tid, text):
    return json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": text}]}})


class TokenLogTest(unittest.TestCase):
    def test_kinds_usage_and_share(self):
        s = t.summarise([A("r1", "a", "Read", cache_read_input_tokens=100), R("a", "x" * 400), A("r2", "b", "Bash"), R("b", "y" * 400),
                         A("r2", "c", "Edit")])
        self.assertEqual(s["by_kind"]["read"], {"calls": 1, "result_tokens_est": 100})
        self.assertEqual(s["by_kind"]["execute"]["calls"], 1)
        self.assertEqual(s["by_kind"]["edit"]["calls"], 1)
        self.assertEqual(s["usage"]["input"], 2)  # r2 counted once
        self.assertEqual(s["read_share"], 0.5)

    def test_compare(self):
        a = {"usage": {"input": 100, "cache_write": 0, "output": 0, "cache_read": 0}}
        b = {"usage": {"input": 60, "cache_write": 0, "output": 0, "cache_read": 0}}
        self.assertEqual(t.compare(a, b)["change"], -0.4)


if __name__ == "__main__":
    unittest.main()
