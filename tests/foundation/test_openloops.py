import unittest

from foundation import openloops


class OpenLoops(unittest.TestCase):
    def test_repo_clean(self):
        self.assertEqual(openloops.check(), [])


if __name__ == "__main__":
    unittest.main()
