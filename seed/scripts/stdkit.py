# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Standards kit (OPEN-STANDARDS-1, Rowan 2026-11-25): "Standards, don't reinvent the wheel. Apply standards."

One copy, carried by every system started from the seed; the platform imports it. It holds the standard building blocks
the loops share, so no module writes its own envelope or validator:
- JSON Schema 2020-12 validation (`validate`): the `jsonschema` library when installed, otherwise a stdlib subset of the
  keywords the schemas use, with the same results; `load_data` reads JSON, JSON Lines, TOML or YAML alike.
- CloudEvents 1.0 (`cloudevent`, `cloudevent_errors`): the envelope for events between loops. JS twin: seed/worker/src/cloudevents.js.
- W3C PROV (`prov_document`): PROV-JSON export of a provenance ledger.
- Conventional Commits 1.0 (`conventional`, `conventional_share`).

Ultrastable is the foundation for any autonomous system."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import sys
from pathlib import Path

DRAFT = "https://json-schema.org/draft/2020-12/schema"
CE_VERSION = "1.0"
CE_REQUIRED = ("specversion", "id", "source", "type")
CC_RE = re.compile(r"^(?P<type>[a-z][a-z0-9-]*)(?:\((?P<scope>[^()\s][^()]*)\))?(?P<bang>!)?: \S")

# ---------------------------------------------------------------------------------------------------------- loading


def load_data(path: Path):
    """JSON, JSON Lines (list of rows), TOML or YAML: the container differs, the schema is the same."""
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    suf = p.suffix.lower()
    if suf == ".json":
        return json.loads(text)
    if suf == ".jsonl":
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    if suf == ".toml":
        import tomllib
        return tomllib.loads(text)
    if suf in (".yaml", ".yml"):
        import yaml  # PyYAML; a YAML file is only matched where a schema names it
        return yaml.safe_load(text)
    raise ValueError(f"{p}: unsupported data format {suf}")


# ---------------------------------------------------------------------------------------------------------- JSON Schema

_KINDS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def _lite(schema, value, path="$", root=None) -> list[str]:
    """Stdlib subset of JSON Schema 2020-12: type, enum, const, pattern, minLength, minimum, required, properties,
    additionalProperties (bool or schema), items, minItems, anyOf, oneOf, $ref to #/$defs."""
    root = root if root is not None else schema
    if schema is True or schema == {}:
        return []
    if schema is False:
        return [f"{path}: not allowed"]
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/"):
            return []
        node = root
        for part in ref[2:].split("/"):
            node = node[part]
        return _lite(node, value, path, root)
    t = schema.get("type")
    if t is not None:
        types = [t] if isinstance(t, str) else t
        if not any(_KINDS[k](value) for k in types):
            return [f"{path}: expected {'/'.join(types)}, got {type(value).__name__}"]
    bad = []
    if "enum" in schema and value not in schema["enum"]:
        bad.append(f"{path}: {value!r} not in {schema['enum']}")
    if "const" in schema and value != schema["const"]:
        bad.append(f"{path}: must be {schema['const']!r}")
    if isinstance(value, str):
        if "pattern" in schema and not re.search(schema["pattern"], value):
            bad.append(f"{path}: {value!r} does not match {schema['pattern']}")
        if len(value) < schema.get("minLength", 0):
            bad.append(f"{path}: shorter than {schema['minLength']}")
    if _KINDS["number"](value) and "minimum" in schema and value < schema["minimum"]:
        bad.append(f"{path}: below {schema['minimum']}")
    if isinstance(value, dict):
        bad += [f"{path}: missing {k}" for k in schema.get("required", []) if k not in value]
        props = schema.get("properties", {})
        for k, v in value.items():
            if k in props:
                bad += _lite(props[k], v, f"{path}.{k}", root)
            elif "additionalProperties" in schema:
                bad += _lite(schema["additionalProperties"], v, f"{path}.{k}", root)
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            bad.append(f"{path}: needs at least {schema['minItems']} items")
        if "items" in schema:
            for i, v in enumerate(value):
                bad += _lite(schema["items"], v, f"{path}[{i}]", root)
    for key in ("anyOf", "oneOf"):
        if key in schema:
            hits = sum(1 for s in schema[key] if not _lite(s, value, path, root))
            if hits == 0 or (key == "oneOf" and hits > 1):
                bad.append(f"{path}: matches {hits} of {key} alternatives")
    return bad


def validate(schema: dict, value, *, prefer_library=True) -> list[str]:
    """Errors as `path: message`; empty when valid. Uses `jsonschema` (Draft 2020-12) when installed."""
    if prefer_library:
        try:
            import jsonschema  # type: ignore
        except ImportError:
            jsonschema = None
        if jsonschema is not None:
            v = jsonschema.Draft202012Validator(schema)
            out = []
            for e in sorted(v.iter_errors(value), key=lambda e: list(e.absolute_path)):
                where = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in e.absolute_path)
                out.append(f"{where}: {e.message[:300]}")
            return out
    return _lite(schema, value)


def schema_errors(schema: dict) -> list[str]:
    """The schema itself must be a valid Draft 2020-12 schema (checked by the library when installed)."""
    bad = []
    if schema.get("$schema") != DRAFT:
        bad.append(f"$schema must be {DRAFT}")
    try:
        import jsonschema  # type: ignore
        try:
            jsonschema.Draft202012Validator.check_schema(schema)
        except jsonschema.SchemaError as e:  # pragma: no cover - library path
            bad.append(f"invalid schema: {e.message[:300]}")
    except ImportError:
        pass
    return bad


# ---------------------------------------------------------------------------------------------------------- CloudEvents


def cloudevent(type_: str, source: str, data=None, *, subject: str = "", id_: str = "", time: str = "",
               datacontenttype="application/json", dataschema: str = "", **extensions) -> dict:
    """A CloudEvents 1.0 event in the JSON event format. `type_` is reverse-DNS (io.ultrastable.<loop>.<what>)."""
    time = time or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = json.dumps(data, sort_keys=True, default=str)
    ev = {"specversion": CE_VERSION, "id": id_ or hashlib.sha256(f"{type_}|{source}|{subject}|{time}|{body}".encode()).hexdigest()[:24],
          "source": source, "type": type_, "time": time}
    if subject:
        ev["subject"] = subject
    if data is not None:
        ev["datacontenttype"] = datacontenttype
        ev["data"] = data
    if dataschema:
        ev["dataschema"] = dataschema
    for k, v in extensions.items():
        if not re.fullmatch(r"[a-z0-9]{1,20}", k):
            raise ValueError(f"CloudEvents extension names are lower-case alphanumerics: {k}")
        ev[k] = v
    return ev


def cloudevent_errors(ev: dict) -> list[str]:
    bad = [f"missing {k}" for k in CE_REQUIRED if not ev.get(k)]
    if ev.get("specversion") not in (None, CE_VERSION):
        bad.append(f"specversion must be {CE_VERSION}")
    if ev.get("time") and not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", str(ev["time"])):
        bad.append("time must be RFC 3339")
    for k in ev:
        if not re.fullmatch(r"[a-z0-9]{1,20}", k):
            bad.append(f"attribute name {k!r} is not a valid CloudEvents name")
    return bad


# ---------------------------------------------------------------------------------------------------------- W3C PROV


def prov_document(rows: list[dict], ns="https://ultrastable.io/prov/") -> dict:
    """PROV-JSON (W3C Member Submission) for provenance rows shaped {id, at, kind, summary, origin{class, actor,
    channel}, affected[], parent, effect{status}}: each row is an activity, each actor an agent, each affected path
    an entity the activity generated, and `parent` an informing activity."""
    doc: dict = {"prefix": {"us": ns, "prov": "http://www.w3.org/ns/prov#"},
                 "activity": {}, "agent": {}, "entity": {}, "wasAssociatedWith": {}, "wasGeneratedBy": {}, "wasInformedBy": {}}
    for r in rows:
        a = f"us:{r['id']}"
        o = r.get("origin") or {}
        doc["activity"][a] = {"prov:type": f"us:{r.get('kind', 'change')}", "prov:label": r.get("summary", "")[:300],
                              "prov:startTime": r.get("at", ""), "us:effect": (r.get("effect") or {}).get("status", "")}
        if o.get("actor"):
            ag = f"us:agent/{o.get('class', 'unknown')}/{o['actor']}"
            doc["agent"].setdefault(ag, {"prov:type": f"us:{o.get('class', 'unknown')}", "us:channel": o.get("channel", "")})
            doc["wasAssociatedWith"][f"_:assoc-{r['id']}"] = {"prov:activity": a, "prov:agent": ag}
        for i, path in enumerate(r.get("affected") or []):
            ent = f"us:file/{path}"
            doc["entity"].setdefault(ent, {"prov:type": "us:file"})
            doc["wasGeneratedBy"][f"_:gen-{r['id']}-{i}"] = {"prov:entity": ent, "prov:activity": a, "prov:time": r.get("at", "")}
        if r.get("parent"):
            doc["wasInformedBy"][f"_:inf-{r['id']}"] = {"prov:informed": a, "prov:informant": f"us:{r['parent']}"}
    return {k: v for k, v in doc.items() if v}


# ---------------------------------------------------------------------------------------------------------- Conventional Commits


def conventional(subject: str) -> bool:
    return bool(CC_RE.match(subject)) or subject.startswith(("Merge ", "Revert "))


def conventional_share(subjects: list[str]) -> float:
    s = [x for x in subjects if x.strip()]
    return round(sum(conventional(x) for x in s) / len(s), 3) if s else 1.0
