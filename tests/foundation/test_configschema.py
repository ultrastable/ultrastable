"""CONFIG-SCHEMA-1 (STANDARDS-1): every JSON config has a JSON Schema 2020-12 contract in a Schema Store catalog, and the check catches drift."""
import json, shutil, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import configschema as cs  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402


def tree():
    td = Path(scratch())
    for pattern, sdir, _ in cs.COVERED:
        for d in (Path(pattern).parent.as_posix(), sdir):
            if (ROOT / d).is_dir():
                shutil.copytree(ROOT / d, td / d, dirs_exist_ok=True)
    return td


class ConfigSchema(unittest.TestCase):
    def test_every_config_has_a_schema_and_validates(self):
        self.assertEqual(cs.check(ROOT), [])

    def test_catalog_is_schema_store_format(self):
        for _, _, cat in cs.COVERED:
            c = json.loads((ROOT / cat).read_text())
            self.assertEqual(c["$schema"], cs.CATALOG_SCHEMA)
            self.assertEqual(c["version"], 1)
            for s in c["schemas"]:
                self.assertTrue((ROOT / cat).parent.joinpath(s["url"]).is_file(), s["url"])
                self.assertTrue(s["fileMatch"])

    def test_a_dropped_key_or_wrong_type_fails(self):
        td = tree()
        p = td / "doctrine/clocks.json"
        d = json.loads(p.read_text())
        key = sorted(k for k in d if not k.startswith("$"))[0]
        d.pop(key)
        p.write_text(json.dumps(d))
        self.assertTrue(any("clocks.json" in b and key in b for b in cs.check(td)))

    def test_new_config_without_schema_fails_until_gen(self):
        td = tree()
        (td / "doctrine/new-thing.json").write_text(json.dumps({"rule": "X-1", "items": [{"id": "a"}]}))
        self.assertTrue(any("new-thing.json: no schema" in b for b in cs.check(td)))
        cs.gen(td)
        self.assertEqual(cs.check(td), [])

    def test_hand_written_schema_is_never_overwritten(self):
        td = tree()
        p = td / "doctrine/schemas/clocks.schema.json"
        p.write_text(json.dumps({"$schema": cs.DRAFT, "type": "object", "description": "hand"}))
        cs.gen(td)
        self.assertEqual(json.loads(p.read_text())["description"], "hand")

    def test_builtin_validator_matches_jsonschema(self):
        s = {"type": "object", "required": ["a"], "properties": {"a": {"type": "integer"}, "b": {"type": "array", "items": {"type": "string"}}}, "additionalProperties": False}
        self.assertEqual(cs.validate_subset(s, {"a": 1, "b": ["x"]}), [])
        self.assertTrue(cs.validate_subset(s, {"a": True}))
        self.assertTrue(cs.validate_subset(s, {"a": 1, "c": 2}))
        self.assertTrue(cs.validate_subset(s, {"a": 1, "b": [3]}))


if __name__ == "__main__":
    unittest.main()
