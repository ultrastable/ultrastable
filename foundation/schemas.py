# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-FIRST-1 (Rowan, 2026-11-25): "Standards, don't reinvent the wheel. Apply standards." JSON Schema (draft 2020-12) for every
config and manifest. Ultrastable is the foundation for any autonomous system.

This module is the validator only. Which config has which schema, and the check that every config has one, is foundation/configschema.py
(CONFIG-SCHEMA-1, `python3 -m foundation configschema --check`), which validates through `validate` below when the `jsonschema` package is not
installed, so a hand-tightened schema is held to all of its keywords either way. The validator is the standard's own
keyword vocabulary on the standard library (no dependency): type, required, properties, patternProperties, additionalProperties, items,
minItems, maxItems, uniqueItems, enum, const, pattern, minLength, maxLength, minimum, maximum, oneOf, anyOf, allOf, not, $ref inside the file.
A keyword outside that list in a schema is an error, never ignored, so a schema cannot claim a check nothing runs.
Tests: tests/foundation/test_schemas.py."""
from __future__ import annotations
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
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
