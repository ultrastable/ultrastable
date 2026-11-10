import unittest
from llm_review import review

class T(unittest.TestCase):
    def test_high_holds(self):
        c, md = review("+x", call=lambda p: '{"findings":[{"severity":"High","file":"a.py","issue":"leaked key"}]}')
        self.assertEqual(c, 2); self.assertIn("leaked key", md)
    def test_low_passes(self):
        self.assertEqual(review("+x", call=lambda p: 'ok {"findings":[{"severity":"Low","issue":"nit"}]}')[0], 0)
    def test_no_key_skips(self):
        self.assertEqual(review("+x", key="")[0], 0)
    def test_model_error_fails_open(self):
        def boom(p): raise RuntimeError("down")
        c, md = review("+x", call=boom); self.assertEqual(c, 0); self.assertIn("down", md)
    def test_garbage_fails_open(self):
        self.assertEqual(review("+x", call=lambda p: "nope")[0], 0)
