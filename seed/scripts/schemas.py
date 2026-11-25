#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: every JSON config and manifest a system ships has a JSON Schema (draft 2020-12), listed in a catalog in
the SchemaStore catalog format, and drift fails the build. Ultrastable is the foundation for any autonomous system.

One engine for every system (the platform's `foundation/schemas.py` imports it, so one fix reaches every seed):
  python3 scripts/schemas.py --check [--root R]   fail when a covered file has no schema or does not validate against it
  python3 scripts/schemas.py --gen   [--root R]   infer a schema for every covered file that has none (never overwrites)
  python3 scripts/schemas.py --refresh FILE ...   re-infer the schema of a file whose shape changed on purpose

Coverage is `schemas/config.json` (`cover` globs, `exclude` globs). The catalog is `schemas/catalog.json`
(https://json.schemastore.org/schema-catalog.json): editors, CI and agents of any vendor read it the same way.
An inferred schema pins the shape (keys that must stay, value types) and allows additions; a hand-written schema
(no `$comment` naming this engine) is never touched by --gen or --refresh unless --force is given.
Validation uses the `jsonschema` package when installed and an equivalent built-in subset otherwise, so the check
needs no install on a bare runner."""
from __future__ import annotations
import argparse, fnmatch, glob, json, sys
from pathlib import Path

CATALOG, CONFIG = "schemas/catalog.json", "schemas/config.json"
DRAFT = "https://json-schema.org/draft/2020-12/schema"
CATALOG_SCHEMA = "https://json.schemastore.org/schema-catalog.json"
MARK = "inferred by scripts/schemas.py (OPEN-STANDARDS-1); edit freely, --gen never overwrites"
MAP_MIN_KEYS, MAX_DEPTH = 25, 6


def _jtype(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    return {str: "string", list: "array", dict: "object"}[type(v)]


def _merge(a: dict, b: dict) -> dict:
    """Least schema both a and b satisfy (used for array items and map values)."""
    if a == b:
        return a
    if not a or not b:
        return {}
    ta, tb = a.get("type"), b.get("type")
    if ta == tb == "object" and "properties" in a and "properties" in b:
        props = dict(a["properties"])
        for k, v in b["properties"].items():
            props[k] = _merge(props[k], v) if k in props else v
        req = sorted(set(a.get("required", [])) & set(b.get("required", [])))
        out = {"type": "object", "properties": props}
        if req:
            out["required"] = req
        return out
    if ta == tb == "array":
        return {"type": "array", "items": _merge(a.get("items", {}), b.get("items", {}))}
    types = set()
    for t in (ta, tb):
        types |= set(t if isinstance(t, list) else [t] if t else [])
    if ta is None or tb is None or ("object" in types and len(types) > 1) or ("array" in types and len(types) > 1):
        return {"type": sorted(types)} if types and None not in (ta, tb) else {}
    return {"type": sorted(types)}


def infer(v, depth=0) -> dict:
    """Shape schema: object keys present now are required, value types are pinned (null allowed alongside a scalar),
    additional keys are allowed. Large objects whose values share one shape are maps (id -> record): no key is required."""
    t = _jtype(v)
    if t is None or depth >= MAX_DEPTH:
        return {}
    if t == "object":
        subs = {k: infer(x, depth + 1) for k, x in v.items()}
        if len(v) >= MAP_MIN_KEYS:
            vals = list(subs.values())
            merged = vals[0]
            for s in vals[1:]:
                merged = _merge(merged, s)
            if merged:
                return {"type": "object", "additionalProperties": merged}
        out = {"type": "object", "properties": subs}
        if v:
            out["required"] = sorted(v)
        return out
    if t == "array":
        if not v:
            return {"type": "array"}
        items = infer(v[0], depth + 1)
        for x in v[1:]:
            items = _merge(items, infer(x, depth + 1))
        return {"type": "array", "items": items} if items else {"type": "array"}
    return {"type": [t, "null"]}


def _types_ok(t, v):
    kinds = {"object": dict, "array": list, "string": str, "boolean": bool, "null": type(None),
             "number": (int, float), "integer": int}
    for k in ([t] if isinstance(t, str) else t):
        if k in ("number", "integer") and isinstance(v, bool):
            continue
        if isinstance(v, kinds[k]):
            return True
    return False


def _subset(schema, v, path="$"):
    """Built-in validator for the keywords inferred schemas use (type, properties, required, additionalProperties, items,
    enum, const, pattern, minItems); used only when the jsonschema package is absent."""
    import re
    if not isinstance(schema, dict):
        return []
    bad = []
    if "type" in schema and not _types_ok(schema["type"], v):
        return [f"{path}: expected {schema['type']}, got {_jtype(v) or 'null'}"]
    if "enum" in schema and v not in schema["enum"]:
        bad.append(f"{path}: {v!r} not in enum")
    if "const" in schema and v != schema["const"]:
        bad.append(f"{path}: must equal {schema['const']!r}")
    if isinstance(v, str) and "pattern" in schema and not re.search(schema["pattern"], v):
        bad.append(f"{path}: does not match {schema['pattern']}")
    if isinstance(v, dict):
        bad += [f"{path}: missing required key {k!r}" for k in schema.get("required", []) if k not in v]
        props = schema.get("properties", {})
        for k, x in v.items():
            if k in props:
                bad += _subset(props[k], x, f"{path}.{k}")
            elif isinstance(schema.get("additionalProperties"), dict):
                bad += _subset(schema["additionalProperties"], x, f"{path}.{k}")
            elif schema.get("additionalProperties") is False:
                bad.append(f"{path}: unexpected key {k!r}")
    if isinstance(v, list):
        if len(v) < schema.get("minItems", 0):
            bad.append(f"{path}: needs at least {schema['minItems']} items")
        if isinstance(schema.get("items"), dict):
            for i, x in enumerate(v):
                bad += _subset(schema["items"], x, f"{path}[{i}]")
    return bad


def validate(schema: dict, value) -> list[str]:
    try:
        import jsonschema  # full draft 2020-12 when available
    except ImportError:
        return _subset(schema, value)
    v = jsonschema.Draft202012Validator(schema)
    return [f"$.{'.'.join(str(p) for p in e.absolute_path)}: {e.message}".replace("$.:", "$:") for e in v.iter_errors(value)][:20]


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _write(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def config(root: Path) -> dict:
    return _load(root / CONFIG)


def covered(root: Path) -> list[str]:
    cfg = config(root)
    out = set()
    for g in cfg["cover"]:
        out |= {str(Path(p).relative_to(root)) for p in glob.glob(str(root / g)) if Path(p).is_file()}
    return sorted(f for f in out if not any(fnmatch.fnmatch(f, x) for x in cfg.get("exclude", [])))


def catalog(root: Path) -> dict:
    p = root / CATALOG
    return _load(p) if p.exists() else {"$schema": CATALOG_SCHEMA, "version": 1, "schemas": []}


def schema_for(cat: dict, rel: str) -> str | None:
    for s in cat["schemas"]:
        if any(fnmatch.fnmatch(rel, m) for m in s.get("fileMatch", [])):
            return s["url"]
    return None


def _default_url(rel: str) -> str:
    return "./" + rel[:-len(".json")] + ".schema.json"


def _path_of(root: Path, url: str) -> Path:
    """Catalog urls are relative to the catalog file, as in SchemaStore."""
    return (root / "schemas" / url).resolve()


def generate(root: Path, files=None, force=False) -> list[str]:
    """Infer schemas for covered files without one (or the named files with --refresh). Returns what changed."""
    cat, changed = catalog(root), []
    targets = files if files is not None else covered(root)
    for rel in targets:
        url = schema_for(cat, rel)
        if url is None:
            url = _default_url(rel)
            cat["schemas"].append({"name": rel, "description": f"Shape of {rel}", "fileMatch": [rel], "url": url})
            changed.append(f"catalog: + {rel}")
        sp = _path_of(root, url)
        if sp.exists() and files is None:
            continue
        if sp.exists() and not force and MARK not in json.dumps(_load(sp)):
            changed.append(f"{rel}: hand-written schema kept (use --force to re-infer)")
            continue
        body = infer(_load(root / rel))
        _write(sp, {"$schema": DRAFT, "$id": url, "$comment": MARK, "title": rel, **body})
        changed.append(f"schema: {sp.relative_to(root)}")
    cat["schemas"].sort(key=lambda s: s["name"])
    _write(root / CATALOG, cat)
    return changed


def check(root: Path) -> list[str]:
    root, bad = Path(root), []
    if not (root / CONFIG).exists():
        return [f"{CONFIG} missing: no coverage declared"]
    cat = catalog(root)
    if cat.get("$schema") != CATALOG_SCHEMA or cat.get("version") != 1:
        bad.append(f"{CATALOG}: not in the SchemaStore catalog format ($schema {CATALOG_SCHEMA}, version 1)")
    for s in cat["schemas"]:
        missing = [k for k in ("name", "description", "fileMatch", "url") if k not in s]
        if missing:
            bad.append(f"{CATALOG}: entry {s.get('name')} lacks {missing}")
        elif not _path_of(root, s["url"]).exists():
            bad.append(f"{CATALOG}: {s['name']} points at missing {s['url']}")
    for rel in covered(root):
        url = schema_for(cat, rel)
        if url is None:
            bad.append(f"{rel}: no JSON Schema (run `python3 scripts/schemas.py --gen` and commit the result)")
            continue
        sp = _path_of(root, url)
        if not sp.exists():
            continue
        try:
            doc, sch = _load(root / rel), _load(sp)
        except json.JSONDecodeError as e:
            bad.append(f"{rel}: invalid JSON ({e})")
            continue
        if sch.get("$schema") != DRAFT:
            bad.append(f"{sp.relative_to(root)}: $schema must be {DRAFT}")
        errs = validate(sch, doc)
        if errs:
            bad.append(f"{rel}: does not match {sp.relative_to(root)}: " + "; ".join(errs[:5])
                       + (f" (+{len(errs) - 5} more)" if len(errs) > 5 else "")
                       + f". Fix the file, or if the shape changed on purpose: `schemas.py --refresh {rel}`")
    return bad


def main(argv=None, default_root=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=default_root or str(Path(__file__).resolve().parent.parent))
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--gen", action="store_true")
    g.add_argument("--refresh", nargs="+", metavar="FILE")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    if a.check:
        bad = check(root)
        print("\n".join(bad) if bad else f"schemas ok: {len(covered(root))} files validate against their JSON Schema")
        return 1 if bad else 0
    out = generate(root, files=a.refresh if a.refresh else None, force=a.force)
    print("\n".join(out) or "schemas: nothing to generate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
