import unittest
from foundation import schemas


class Schemas(unittest.TestCase):
    def test_every_doctrine_file_validates(self):
        self.assertEqual(schemas.check(), [])

    def test_infer_catches_dropped_key(self):
        s = schemas.infer({"a": 1, "b": "x"})
        self.assertTrue(schemas._validate(s, {"a": 1}))


if __name__ == "__main__":
    unittest.main()
