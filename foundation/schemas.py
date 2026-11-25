# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-FIRST-1 (Rowan, 2026-11-25): "Standards, don't reinvent the wheel. Apply standards." JSON Schema (draft 2020-12) for every
config and manifest. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation standards --schemas                 every JSON config in scope validates against its schema, or is on the shrink-only baseline
  python3 -m foundation standards --schemas --repo PATH     another repository's ultrastable.json against the same schema the seed carries

The map of file to schema, the scope and the baseline are data: doctrine/schemas/index.json. The validator below is the standard's own
keyword vocabulary on the standard library (no dependency): type, required, properties, patternProperties, additionalProperties, items,
minItems, maxItems, uniqueItems, enum, const, pattern, minLength, maxLength, minimum, maximum, oneOf, anyOf, allOf, not, $ref inside the file.
A keyword outside that list in a schema is an error, never ignored, so a schema cannot claim a check nothing runs.
Tests: tests/foundation/test_schemas.py."""
from __future__ import annotations
import fnmatch, json, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
INDEX = "doctrine/schemas/index.json"
DIALECT = "https://json-schema.org/draft/2020-12/schema"
ANNOTATIONS = {"$schema", "$id", "$defs", "$comment", "title", "description", "default", "examples", "deprecated"}
KEYWORDS = {"type", "required", "properties", "patternProperties", "additionalProperties", "items", "minItems", "maxItems", "uniqueItems", "enum", "const",
            "pattern", "minLength", "maxLength", "minimum", "maximum", "oneOf", "anyOf", "allOf", "not", "$ref"}
TYPES = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list), "string": lambda v: isinstance(v, str),
         "boolean": lambda v: isinstance(v, bool), "null": lambda v: v is None,
         "integer": lambda v: (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer()),
         "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)}


def lint(schema, path="#") -> list[str]:
    """A schema may use only the keywords the validator runs."""
    if isinstance(schema, bool):
        return []
    if not isinstance(schema, dict):
        return [f"{path}: a schema is an object or a boolean"]
    bad = [f"{path}: keyword {k!r} is not supported by the validator" for k in schema if k not in KEYWORDS and k not in ANNOTATIONS]
    if "type" in schema:
        bad += [f"{path}: unknown type {t!r}" for t in ([schema["type"]] if isinstance(schema["type"], str) else schema["type"]) if t not in TYPES]
    for k in ("properties", "patternProperties", "$defs"):
        for name, sub in (schema.get(k) or {}).items():
            bad += lint(sub, f"{path}/{k}/{name}")
    for k in ("additionalProperties", "items", "not"):
        if k in schema:
            bad += lint(schema[k], f"{path}/{k}")
    for k in ("oneOf", "anyOf", "allOf"):
        for i, sub in enumerate(schema.get(k) or []):
            bad += lint(sub, f"{path}/{k}/{i}")
    return bad


def _resolve(root_schema, ref: str):
    if not ref.startswith("#"):
        raise ValueError(f"$ref {ref!r}: only references inside the file are supported")
    node = root_schema
    for part in [p for p in ref[1:].split("/") if p]:
        node = node[part.replace("~1", "/").replace("~0", "~")]
    return node


def validate(schema, value, path="$", root_schema=None) -> list[str]:
    """Every way `value` breaks `schema`, one line each with its JSON path. An empty list is a valid document."""
    root_schema = schema if root_schema is None else root_schema
    if schema is True:
        return []
    if schema is False:
        return [f"{path}: not allowed"]
    bad = []
    if "$ref" in schema:
        bad += validate(_resolve(root_schema, schema["$ref"]), value, path, root_schema)
    t = schema.get("type")
    if t is not None:
        names = [t] if isinstance(t, str) else t
        if not any(TYPES[n](value) for n in names):
            return bad + [f"{path}: expected {' or '.join(names)}, found {type(value).__name__}"]
    if "const" in schema and value != schema["const"]:
        bad.append(f"{path}: must be {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        bad.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            bad.append(f"{path}: {value[:60]!r} does not match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0):
            bad.append(f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            bad.append(f"{path}: longer than {schema['maxLength']}")
    if TYPES["number"](value):
        if "minimum" in schema and value < schema["minimum"]:
            bad.append(f"{path}: {value} is below {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            bad.append(f"{path}: {value} is above {schema['maximum']}")
    if isinstance(value, dict):
        bad += [f"{path}: missing {k}" for k in schema.get("required", []) if k not in value]
        props, pats = schema.get("properties", {}), schema.get("patternProperties", {})
        for k, v in value.items():
            known = False
            if k in props:
                known = True
                bad += validate(props[k], v, f"{path}.{k}", root_schema)
            for rx, sub in pats.items():
                if re.search(rx, k):
                    known = True
                    bad += validate(sub, v, f"{path}.{k}", root_schema)
            if not known and "additionalProperties" in schema:
                ap = schema["additionalProperties"]
                bad += [f"{path}: unknown key {k!r}"] if ap is False else validate(ap, v, f"{path}.{k}", root_schema)
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            bad.append(f"{path}: needs at least {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            bad.append(f"{path}: more than {schema['maxItems']} items")
        if schema.get("uniqueItems") and len({json.dumps(v, sort_keys=True) for v in value}) != len(value):
            bad.append(f"{path}: items repeat")
        if "items" in schema:
            for i, v in enumerate(value):
                bad += validate(schema["items"], v, f"{path}[{i}]", root_schema)
    for i, sub in enumerate(schema.get("allOf", [])):
        bad += validate(sub, value, path, root_schema)
    if "anyOf" in schema and not any(not validate(s, value, path, root_schema) for s in schema["anyOf"]):
        bad.append(f"{path}: matches none of anyOf")
    if "oneOf" in schema:
        n = sum(1 for s in schema["oneOf"] if not validate(s, value, path, root_schema))
        if n != 1:
            bad.append(f"{path}: matches {n} of oneOf, needs exactly 1")
    if "not" in schema and not validate(schema["not"], value, path, root_schema):
        bad.append(f"{path}: matches a schema it must not")
    return bad


def _json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def in_scope(root: Path, idx: dict) -> list[str]:
    out = set()
    for g in idx["scope"]:
        out |= {p.relative_to(root).as_posix() for p in root.glob(g) if p.is_file()}
    return sorted(f for f in out if not any(fnmatch.fnmatch(f, x) for x in idx.get("not_config", {})))


def mapping(root: Path, idx: dict) -> dict[str, list[str]]:
    """file -> its schemas, from the index's map (a `files` entry may be a glob; a file may be held by more than one schema)."""
    out = {}
    for row in idx["map"]:
        for g in row["files"]:
            for p in ([root / g] if not any(c in g for c in "*?[") else sorted(root.glob(g))):
                out.setdefault(p.relative_to(root).as_posix(), []).append(row["schema"])
    return out


def check(root=REPO, limit=6) -> list[str]:
    root, bad = Path(root), []
    idx = _json(root / INDEX)
    files, m = in_scope(root, idx), mapping(root, idx)
    baseline = idx.get("baseline", [])
    if len(baseline) > idx["baseline_ceiling"]:
        bad.append(f"{INDEX}: baseline holds {len(baseline)} files, above its ceiling {idx['baseline_ceiling']} (the baseline only shrinks: write the schema)")
    if len(set(baseline)) != len(baseline) or baseline != sorted(baseline):
        bad.append(f"{INDEX}: baseline must be sorted with no repeats")
    schemas = {}
    for s in sorted({x for v in m.values() for x in v}):
        p = root / s
        if not p.is_file():
            bad.append(f"{s}: schema file missing")
            continue
        sc = _json(p)
        if sc.get("$schema") != DIALECT:
            bad.append(f"{s}: $schema must be {DIALECT}")
        bad += [f"{s} {x}" for x in lint(sc)]
        schemas[s] = sc
    for f in sorted(m):
        if not (root / f).is_file():
            bad.append(f"{INDEX}: maps {f}, which does not exist")
        else:
            doc = _json(root / f)
            for sname in m[f]:
                errs = validate(schemas[sname], doc) if sname in schemas else []
                bad += [f"{f} {x}" for x in errs[:limit]] + ([f"{f}: and {len(errs) - limit} more"] if len(errs) > limit else [])
    for f in files:
        if f not in m and f not in baseline:
            bad.append(f"{f}: no JSON Schema and not on the baseline; add doctrine/schemas/<name>.schema.json and a map row in {INDEX}")
    for f in baseline:
        if f in m:
            bad.append(f"{INDEX}: {f} has a schema now; remove it from the baseline")
        elif f not in files:
            bad.append(f"{INDEX}: baseline names {f}, which is not a config in scope; remove it")
    return bad


def check_repo(repo, root=REPO) -> list[str]:
    """Another repository's manifest against the schema every repository shares."""
    idx = _json(Path(root) / INDEX)
    p = Path(repo) / "ultrastable.json"
    if not p.is_file():
        return [f"{repo}: no ultrastable.json"]
    return [f"{repo}/ultrastable.json {x}" for x in validate(_json(Path(root) / idx["repo_manifest_schema"]), _json(p))]


def coverage(root=REPO) -> dict:
    root = Path(root)
    idx = _json(root / INDEX)
    files, m = in_scope(root, idx), mapping(root, idx)
    return {"in_scope": len(files), "with_schema": sum(1 for f in files if f in m), "baseline": len(idx.get("baseline", [])), "schemas": len({x for v in m.values() for x in v})}
