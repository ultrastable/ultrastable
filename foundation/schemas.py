"""SCHEMA-1 / STANDARDS-FIRST-1: every data file under ROOTS (doctrine, seed/autonomy, the instance manifest) is checked; a new homegrown file there with no schema fails. Every doctrine file is validated against a JSON Schema (draft 2020-12), listed in a SchemaStore-format
catalog (schemas/catalog.json), so editors, CI and any other tool check the same contract instead of reading
homegrown shapes by convention. `--infer` writes a starting schema for a doctrine file that has none (types, required
top-level keys, nested shapes); the schema is then the contract and a change that breaks it fails `--check` until the
schema is changed on purpose. Uses the `jsonschema` package when installed, else the subset validator in standards.py.
"""
from __future__ import annotations
import json
from pathlib import Path
from .standards import _validate as _subset

REPO = Path(__file__).resolve().parent.parent
DIR, CATALOG = "schemas/doctrine", "schemas/catalog.json"
DRAFT = "https://json-schema.org/draft/2020-12/schema"
BASE = "https://ultrastable.io/schemas/doctrine/"
_T = {dict: "object", list: "array", str: "string", bool: "boolean", type(None): "null"}


def _kind(v):
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return _T[type(v)]


def infer(v, depth=0):
    k = _kind(v)
    s = {"type": k}
    if k == "object" and depth < 3:
        s["properties"] = {key: infer(val, depth + 1) for key, val in v.items()}
        if depth == 0:
            s["required"] = sorted(v)
    if k == "array" and v and depth < 3:
        kinds = {_kind(x) for x in v}
        if len(kinds) == 1:
            s["items"] = {"type": kinds.pop()}
    return s


ROOTS = ("doctrine", "seed/autonomy", "instances/ultrastable")


def _rel(root, p):
    return p.relative_to(Path(root)).as_posix()


def _files(root):
    return sorted(p for r in ROOTS for p in (Path(root) / r).glob("*.json"))


def _schema_path(root, p):
    parent = _rel(root, p.parent)
    d = DIR if parent == "doctrine" else "schemas/" + parent.replace("/", "-")
    return Path(root) / d / (p.stem + ".schema.json")


def _validate(schema, value):
    try:
        import jsonschema
    except ImportError:
        return _subset(_numbers(schema), value)
    v = jsonschema.Draft202012Validator(schema)
    return [f"$/{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in v.iter_errors(value)]


def _numbers(s):
    """The subset validator has no 'number'/'boolean'; drop those type checks rather than misreport them."""
    if isinstance(s, dict):
        s = {k: _numbers(v) for k, v in s.items()}
        if s.get("type") in ("number", "boolean"):
            s.pop("type")
    return s


def apply_infer(root=REPO):
    made = []
    for p in _files(root):
        sp = _schema_path(root, p)
        if sp.exists():
            continue
        s = {"$schema": DRAFT, "$id": BASE + sp.name, "title": _rel(root, p)}
        s.update(infer(json.loads(p.read_text(encoding="utf-8"))))
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(json.dumps(s, indent=1) + "\n", encoding="utf-8")
        made.append(sp.name)
    catalog = {"$schema": "https://json.schemastore.org/schema-catalog.json", "version": 1,
               "schemas": [{"name": _rel(root, p), "description": "Ultrastable data file",
                            "fileMatch": [_rel(root, p)], "url": "https://ultrastable.io/" + _rel(root, _schema_path(root, p)),
                            "path": _rel(root, _schema_path(root, p))} for p in _files(root)]}
    (Path(root) / CATALOG).write_text(json.dumps(catalog, indent=1) + "\n", encoding="utf-8")
    return made


def check(root=REPO):
    bad = []
    cat = Path(root) / CATALOG
    listed = {s["fileMatch"][0] for s in json.loads(cat.read_text())["schemas"]} if cat.exists() else set()
    for p in _files(root):
        rel = _rel(root, p)
        sp = _schema_path(root, p)
        if not sp.exists():
            bad.append(f"{rel}: no schema (run `python3 -m foundation schemas --infer`)")
            continue
        if rel not in listed:
            bad.append(f"{rel}: missing from {CATALOG}")
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            bad.append(f"{rel}: not JSON ({e})")
            continue
        bad += [f"{rel} {m}" for m in _validate(json.loads(sp.read_text()), doc)]
    return bad
