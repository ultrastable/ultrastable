# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CONFIG-SCHEMA-1 (STANDARDS-1, Rowan 2026-11-25: "Standards, don't reinvent the wheel. Apply standards."). Ultrastable is the foundation for any
autonomous system.

Every JSON config the system runs on has a JSON Schema (draft 2020-12) contract, listed in a JSON Schema Store catalog (the format editors, language
servers and agents already read), so any tool, provider or agent can validate a config without reading the Python that consumes it.

  python3 -m foundation configschema --check   every config in COVERED has a schema in its catalog, and validates against it
  python3 -m foundation configschema --gen     write a starting schema for each config that has none, and rebuild the catalogs

A generated schema is a floor, not a ceiling: it fixes the root type, the top-level keys that must stay, their types, and the shape of arrays of
records. A schema written or tightened by hand is never overwritten (only a missing one is generated). `--gen` runs in scripts/regen_generated.py,
so a new config gets its contract in the same change that adds it; `--check` runs in checks.

Validation uses the `jsonschema` package when it is installed and otherwise the built-in subset below (type, enum, const, pattern, required,
properties, additionalProperties, items, minItems, anyOf), which covers every keyword the generated and hand-written schemas here use.
"""
from __future__ import annotations
import argparse, glob, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DRAFT = "https://json-schema.org/draft/2020-12/schema"
CATALOG_SCHEMA = "https://json.schemastore.org/schema-catalog.json"
# (config glob, schema directory, catalog path). The seed carries its own schemas so every system cloned from it inherits the contracts.
COVERED = [
    ("doctrine/*.json", "doctrine/schemas", "doctrine/schemas/catalog.json"),
    ("seed/doctrine/*.json", "seed/doctrine/schemas", "seed/doctrine/schemas/catalog.json"),
    ("seed/autonomy/*.json", "seed/autonomy/schemas", "seed/autonomy/schemas/catalog.json"),
]
MIN_ITEMS_FOR_SHAPE = 3  # an array of records gets a per-field type contract only when at least this many records agree on it


def _type(v):
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    return {str: "string", list: "array", dict: "object", type(None): "null"}[type(v)]


def _loose(t):
    return "number" if t == "integer" else t  # a count may become a share; only the kind of value is the contract


def infer(value, depth=0) -> dict:
    """A floor schema for one config value: root type, top-level keys and their types, and the agreed shape of arrays of records."""
    t = _type(value)
    if t == "null":
        return {}
    s = {"type": _loose(t)}
    if t == "object" and depth < 2:
        props = {}
        for k, v in value.items():
            sub = infer(v, depth + 1) if depth == 0 else ({"type": _loose(_type(v))} if v is not None else {})
            props[k] = sub
        s["properties"] = props
        if depth == 0:
            s["required"] = sorted(value)
    if t == "array" and value:
        kinds = {_type(x) for x in value}
        if len(kinds) == 1:
            k = kinds.pop()
            if k == "object" and len(value) >= MIN_ITEMS_FOR_SHAPE:
                fields = {}
                for key in set().union(*(x.keys() for x in value)):
                    ts = {_loose(_type(x[key])) for x in value if key in x}
                    if len(ts) == 1 and "null" not in ts and sum(key in x for x in value) >= MIN_ITEMS_FOR_SHAPE:
                        fields[key] = {"type": ts.pop()}
                s["items"] = {"type": "object", "properties": dict(sorted(fields.items()))}
            elif k != "null":
                s["items"] = {"type": _loose(k)}
    return s


def schema_for(rel: str, value) -> dict:
    name = Path(rel).stem
    out = {"$schema": DRAFT, "$id": f"https://ultrastable.io/schemas/{rel.replace('.json', '.schema.json')}",
           "title": f"{name} ({rel})",
           "description": f"Contract for {rel}. Generated as a floor by `python3 -m foundation configschema --gen`; tighten it by hand, it is never overwritten."}
    out.update(infer(value))
    if isinstance(out.get("properties"), dict):
        out["properties"].setdefault("$schema", {"type": "string"})
    return out


# ---------- validation ----------
_KINDS = {"object": dict, "array": list, "string": str, "integer": int, "number": (int, float), "boolean": bool, "null": type(None)}


def _is(value, t):
    if t in ("integer", "number") and isinstance(value, bool):
        return False
    return isinstance(value, _KINDS[t])


def _kit():
    """OPEN-STANDARDS-1: one JSON Schema validator for every system, seed/scripts/stdkit.py (library first, stdlib subset otherwise)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("seed_stdkit", REPO / "seed/scripts/stdkit.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def validate_subset(schema, value, path="$") -> list[str]:
    """The stdlib subset alone (no jsonschema library), as every seeded system runs it without dependencies."""
    return _kit().validate(schema, value, prefer_library=False)


def validate(schema, value) -> list[str]:
    return _kit().validate(schema, value)


# ---------- files ----------
def configs(root=REPO):
    root = Path(root)
    for pattern, sdir, cat in COVERED:
        for f in sorted(glob.glob(str(root / pattern))):
            rel = Path(f).relative_to(root).as_posix()
            yield rel, f"{sdir}/{Path(rel).stem}.schema.json", cat


def catalog(entries) -> dict:
    return {"$schema": CATALOG_SCHEMA, "version": 1,
            "schemas": [{"name": Path(rel).name, "description": f"Contract for {rel}", "fileMatch": [rel], "url": Path(sch).name} for rel, sch in entries]}


def gen(root=REPO) -> list[str]:
    root, wrote, cats = Path(root), [], {}
    for rel, sch, cat in configs(root):
        cats.setdefault(cat, []).append((rel, sch))
        p = root / sch
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(schema_for(rel, json.loads((root / rel).read_text(encoding="utf-8"))), indent=2) + "\n", encoding="utf-8")
            wrote.append(sch)
    for cat, entries in cats.items():
        # hand-written schemas already in the directory for configs outside the glob stay listed, matched by their own file name
        text = json.dumps(catalog(entries), indent=2) + "\n"
        p = root / cat
        if not p.exists() or p.read_text(encoding="utf-8") != text:
            p.write_text(text, encoding="utf-8")
            wrote.append(cat)
    return wrote


def check(root=REPO) -> list[str]:
    root, bad, cats = Path(root), [], {}
    for rel, sch, cat in configs(root):
        cats.setdefault(cat, []).append((rel, sch))
        p = root / sch
        if not p.exists():
            bad.append(f"{rel}: no schema at {sch}; run `python3 -m foundation configschema --gen`")
            continue
        try:
            schema = json.loads(p.read_text(encoding="utf-8"))
            value = json.loads((root / rel).read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            bad.append(f"{rel}: not valid JSON ({e})")
            continue
        if schema.get("$schema") != DRAFT:
            bad.append(f"{sch}: $schema must be {DRAFT}")
        bad += [f"{rel}: {m}" for m in validate(schema, value)]
    for cat, entries in cats.items():
        p = root / cat
        if not p.exists() or json.loads(p.read_text(encoding="utf-8")) != catalog(entries):
            bad.append(f"{cat}: catalog out of date; run `python3 -m foundation configschema --gen`")
    return bad


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation configschema")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--gen", action="store_true")
    a = ap.parse_args(argv)
    if a.gen:
        w = gen()
        print("\n".join(w) or "configschema: every config already has a schema; catalogs current")
        return 0
    bad = check()
    n = sum(1 for _ in configs())
    print("\n".join(bad) or f"configschema ok: {n} configs validate against their JSON Schema contracts")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
