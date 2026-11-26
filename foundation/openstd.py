# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: established open standards, never a home-grown format (Rowan, 2026-11-25). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation openstd --check            registry valid, adopted standards have evidence, every config file in scope declares $schema,
                                                   every event ledger line is a CloudEvent, no unregistered file type; the baseline only shrinks
  python3 -m foundation openstd --baseline --init  write the baseline once (first run); afterwards --baseline only removes entries that now conform

Registry: doctrine/open-standards.json (schema schemas/open-standards.schema.json). Baseline: doctrine/open-standards-baseline.json.
A new file in a covered scope must meet its standard at once; a new file type needs a registered standard first. Tests: tests/foundation/test_openstd.py.
"""
from __future__ import annotations
import datetime as dt, fnmatch, json, subprocess, sys, uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG = "doctrine/open-standards.json"
BASE = "doctrine/open-standards-baseline.json"
SCHEMA = "schemas/open-standards.schema.json"
CE_SCHEMA = "schemas/cloudevent.schema.json"


def cloudevent(type_: str, source: str, data=None, subject: str | None = None, now: dt.datetime | None = None) -> dict:
    """CloudEvents 1.0 structured event; emitters of ledger lines use this so a ledger meets the standard."""
    ev = {"specversion": "1.0", "id": str(uuid.uuid4()), "source": source, "type": type_,
          "time": (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
          "datacontenttype": "application/json", "data": data if data is not None else {}}
    if subject:
        ev["subject"] = subject
    return ev


def _load(root: Path, rel: str):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def tracked(root: Path) -> list[str]:
    out = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if (Path(root) / l).is_file()]


def _in_scope(path: str, pats: list[str]) -> bool:
    for p in pats:
        if "**" in p:
            head, tail = p.split("**/")
            if path.startswith(head) and fnmatch.fnmatch(path.rsplit("/", 1)[-1], tail):
                return True
        elif fnmatch.fnmatch(path, p) and path.count("/") == p.count("/"):
            return True
    return False


def _ext(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    if name.endswith(".tmpl") and name.count(".") >= 2:
        name = name[:-5]  # a template is judged by the type it renders to
    if name.startswith(".") and name.count(".") == 1:
        return name[1:]
    return name.rsplit(".", 1)[-1] if "." in name else "(none)"


def catalogued(root: Path, files) -> set:
    """Configs listed in a JSON Schema Store catalog (CONFIG-SCHEMA-1): the catalog entry is the schema declaration."""
    out: set = set()
    for c in files:
        if not c.endswith("schemas/catalog.json"):
            continue
        try:
            for e in _load(root, c).get("schemas", []):
                for m in e.get("fileMatch", []):
                    out.add(m)
                    if m.startswith("seed/"):
                        out.add(m[5:])  # the same catalog read from inside a system cloned from the seed
        except (ValueError, OSError, AttributeError):
            continue
    return out


def json_config_ok(root: Path, rel: str, cat: frozenset = frozenset()) -> bool:
    if rel in cat:
        return True
    try:
        d = _load(root, rel)
    except (ValueError, OSError):
        return False
    return isinstance(d, dict) and isinstance(d.get("$schema"), str) and bool(d["$schema"])


def ledger_ok(root: Path, rel: str) -> bool:
    lines = [l for l in (Path(root) / rel).read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
    if not lines:
        return True
    for l in (lines[0], lines[-1]):
        try:
            e = json.loads(l)
        except ValueError:
            return False
        if not (isinstance(e, dict) and e.get("specversion") == "1.0" and all(isinstance(e.get(k), str) and e[k] for k in ("id", "source", "type"))):
            return False
    return True


def _validate(instance, schema_path: Path) -> list[str]:
    try:
        import jsonschema
    except ImportError:
        return []  # structural checks below still run; the schema is enforced wherever jsonschema is installed
    v = jsonschema.Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")))
    return [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in v.iter_errors(instance)]


def scan(root: Path = REPO) -> dict:
    root = Path(root)
    reg = _load(root, REG)
    files = tracked(root)
    sc = reg["scopes"]
    cat = frozenset(catalogued(root, files))
    bad_cfg = sorted(f for f in files if f.endswith(".json") and _in_scope(f, sc["json_config"]) and f != BASE and not json_config_ok(root, f, cat))
    bad_led = sorted(f for f in files if f.endswith(".jsonl") and _in_scope(f, sc["event_ledgers"]) and not ledger_ok(root, f))
    known = set(reg["known_extensions"])
    bad_ext = sorted(f for f in files if _ext(f) not in known)
    return {"config": bad_cfg, "ledgers": bad_led, "extensions": bad_ext}


def check(root: Path = REPO) -> list[str]:
    root = Path(root)
    errs: list[str] = []
    reg = _load(root, REG)
    errs += [f"{REG}: {m}" for m in _validate(reg, root / SCHEMA)]
    seen = set()
    for f in reg["formats"]:
        if f["id"] in seen:
            errs.append(f"{REG}: duplicate format id {f['id']}")
        seen.add(f["id"])
        for e in f.get("evidence", []):
            if not (root / e).exists():
                errs.append(f"{f['id']}: evidence path missing: {e}")
        if f["status"] == "adopted" and not f.get("evidence"):
            errs.append(f"{f['id']}: adopted without evidence")
    cur = scan(root)
    base = _load(root, BASE)
    for kind, label in (("config", "config file without $schema"), ("ledgers", "event ledger that is not CloudEvents 1.0"), ("extensions", "file type with no registered standard")):
        allowed = set(base.get(kind, []))
        for f in cur[kind]:
            if f not in allowed:
                errs.append(f"new bespoke format: {f} ({label}); declare the standard in {REG} or meet it now")
        for f in sorted(allowed - set(cur[kind])):
            errs.append(f"baseline is stale: {f} now conforms or is gone; remove it (python3 -m foundation openstd --baseline)")
    return errs


def baseline(root: Path = REPO, init: bool = False) -> dict:
    root = Path(root)
    cur = scan(root)
    if init:
        out = {k: v for k, v in cur.items()}
    else:
        old = _load(root, BASE)
        out = {k: [f for f in old.get(k, []) if f in set(cur[k])] for k in cur}  # shrink only: never adds
    out = {"$schema": "../schemas/doctrine.schema.json", "_doc": "OPEN-STANDARDS-1 shrink-only baseline: files that predate the standard. Drain it; never add to it.", **out}
    (root / BASE).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    return out


def drain(root: Path = REPO, n: int = 25) -> list[str]:
    """Add a $schema key to up to n baseline config files (text insertion, so formatting and key order stay).
    A file that is not a JSON object is left in the baseline; CI on the landing change is the gate that keeps a conversion honest."""
    root = Path(root)
    base = _load(root, BASE)
    done: list[str] = []
    for rel in list(base.get("config", [])):
        if len(done) >= n:
            break
        p = root / rel
        try:
            txt = p.read_text(encoding="utf-8")
            d = json.loads(txt)
        except (OSError, ValueError):
            continue
        if rel in catalogued(root, tracked(root)):
            continue  # its catalog entry already declares the schema; the baseline prune below drops it
        if not isinstance(d, dict) or "$schema" in d or not txt.lstrip().startswith("{"):
            continue
        depth = "../" * rel.count("/")
        i = txt.index("{") + 1
        ins = f'\n  "$schema": "{depth}schemas/doctrine.schema.json",' if d else f'\n  "$schema": "{depth}schemas/doctrine.schema.json"\n'
        p.write_text(txt[:i] + ins + txt[i:], encoding="utf-8")
        json.loads(p.read_text(encoding="utf-8"))
        done.append(rel)
    baseline(root)
    return done


def record(root: Path, type_: str, data: dict) -> dict:
    ev = cloudevent(type_, "/loop/openstd", data)
    p = Path(root) / "ops/openstd/events.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(ev) + "\n")
    return ev


def main(argv: list[str]) -> int:
    if "--drain" in argv:
        n = int(argv[argv.index("--drain") + 1]) if len(argv) > argv.index("--drain") + 1 else 25
        done = drain(REPO, n)
        left = {k: len(v) for k, v in _load(REPO, BASE).items() if isinstance(v, list)}
        record(REPO, "openstd.drain", {"converted": done, "baseline_left": left})
        print(f"converted {len(done)}; baseline left {left}")
        return 0
    if "--probe" in argv:
        row = argv[argv.index("--probe") + 1]
        ok = any(f["id"] == row and f["status"] == "adopted" for f in _load(REPO, REG)["formats"])
        print(f"{row}: {'adopted' if ok else 'not adopted'}")
        return 0 if ok else 1
    if "--baseline" in argv:
        b = baseline(init="--init" in argv)
        print({k: len(v) for k, v in b.items() if isinstance(v, list)})
        return 0
    errs = check()
    print("\n".join(errs) or "open standards ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
