# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import openslo, schemas


class Schemas(unittest.TestCase):
    def test_every_doctrine_file_validates(self):
        self.assertEqual(schemas.check(), [])

    def test_infer_catches_dropped_key(self):
        s = schemas.infer({"a": 1, "b": "x"})
        self.assertTrue(schemas._validate(s, {"a": 1}))

    def test_openslo_current(self):
        self.assertEqual(openslo.check(), [])

    def test_backstage_catalog(self):
        import yaml
        docs = list(yaml.safe_load_all(open("catalog/catalog-info.yaml")))
        self.assertTrue(docs and all(d["apiVersion"].startswith("backstage.io/") for d in docs))


if __name__ == "__main__":
    unittest.main()
