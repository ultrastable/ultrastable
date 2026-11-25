# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COLDSTART-1 (Rowan, 2026-11-25): everything works together from the first boot, with no step by a person.
Ultrastable is the foundation for any autonomous system.

"All surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the beginning ...
it has to all bootstrap autonomously." One contract, doctrine/coldstart.json, lists what a system has from the moment it is born from the seed
(own repository, back end, public front end, clock, discovery manifest, knowledge graph, progress, live content, self-improvement, platform sync,
a year unattended, goals, agent instructions). This module proves the contract holds, statically on every change and live on every launch:

  python3 -m foundation coldstart --check        the seed carries each capability (files, tick step, cron); each live path is open on a health-only
                                                 seed; every `python3 -m foundation <cmd>` named in instructions, doctrine and workflows resolves; the
                                                 platform and seed agent files carry the same rules and their @imports resolve
  python3 -m foundation coldstart --live URL     probe a deployed system for every live path of the contract (exit 1 on any miss)
  python3 -m foundation coldstart --list         the contract, one line per capability

`seedlaunch --e2e-oidc` calls live() on the fresh seed it launches, so the end-to-end proof is the whole contract, not /health alone.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = "doctrine/coldstart.json"
UA = "ultrastable-coldstart/1 (+https://ultrastable.io)"
CMD_RE = re.compile(r"python3? -m foundation(?:\.| )([a-z][a-z0-9_-]*)")
RULE_RE = re.compile(r"\(([A-Z][A-Z0-9-]+-\d+)[,)]")


def load(root=ROOT) -> dict:
    return json.loads((Path(root) / CONTRACT).read_text(encoding="utf-8"))


def public_reads(root=ROOT) -> set[str]:
    """The paths a health-only seed answers: `/`, `/health` and PUBLIC_READS in seed/worker/src/visibility.js."""
    src = (Path(root) / "seed/worker/src/visibility.js").read_text(encoding="utf-8")
    m = re.search(r"PUBLIC_READS = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    return {"/", "/health"} | (set(re.findall(r"'([^']+)'", m.group(1))) if m else set())


def command_ok(name: str) -> bool:
    from .__main__ import ARGPARSE_COMMANDS, resolve
    return name in ARGPARSE_COMMANDS or resolve(name) is not None


def _files(root: Path, globs: list[str]) -> list[Path]:
    out: list[Path] = []
    for g in globs:
        out += [p for p in root.glob(g) if p.is_file()]
    return sorted(set(out))


def check_capabilities(c: dict, root=ROOT) -> list[str]:
    root = Path(root)
    bad, opened = [], public_reads(root)
    index = (root / "seed/worker/src/index.js").read_text(encoding="utf-8")
    for cap in c["capabilities"]:
        cid = cap["id"]
        for f in cap.get("seed", []):
            if not (root / f).exists():
                bad.append(f"{cid}: the seed does not carry {f}, so a fresh system is born without it ({cap['rule']})")
        if cap.get("step") and f"b('{cap['step']}'" not in index:
            bad.append(f"{cid}: tick step '{cap['step']}' is not wired in seed/worker/src/index.js")
        if cap.get("cron") and '"crons"' not in (root / cap["cron"]).read_text(encoding="utf-8"):
            bad.append(f"{cid}: {cap['cron']} declares no cron, so the clock never starts")
        live = cap.get("live")
        if live and live["path"] not in opened:
            bad.append(f"{cid}: {live['path']} is hidden on a health-only seed; add it to PUBLIC_READS in seed/worker/src/visibility.js")
        fleet = (cap.get("fleet") or "").split()
        if fleet and not command_ok(fleet[0]):
            bad.append(f"{cid}: its fleet check `python3 -m foundation {cap['fleet']}` does not resolve to a command")
    return bad


def check_commands(c: dict, root=ROOT) -> list[str]:
    root, bad = Path(root), []
    skip = set(c["command_refs"].get("exclude", {}))
    for p in _files(root, c["command_refs"]["globs"]):
        if str(p.relative_to(root)) in skip:
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        for name in sorted(set(CMD_RE.findall(text))):
            if not command_ok(name):
                bad.append(f"{p.relative_to(root)}: `python3 -m foundation {name}` names no command (no module with main, no argparse entry)")
    return bad


def _imports(md: Path) -> list[str]:
    return [ln[1:].strip() for ln in md.read_text(encoding="utf-8").splitlines() if ln.startswith("@")]


def check_instructions(c: dict, root=ROOT) -> list[str]:
    root, ins, bad = Path(root), c["instructions"], []
    for f in ins["imports"]:
        md = root / f
        for imp in _imports(md):
            if not (md.parent / imp).exists():
                bad.append(f"{f}: @{imp} does not resolve, so an agent starting there loads nothing")
    plat, seed = (root / ins["platform"]).read_text(encoding="utf-8"), (root / ins["seed"]).read_text(encoding="utf-8")
    missing = sorted(set(RULE_RE.findall(plat)) - set(RULE_RE.findall(seed)) - set(ins.get("platform_only", {})))
    for rid in missing:
        bad.append(f"{ins['seed']}: rule {rid} is in {ins['platform']} but not in the seed, so a new system is born without it")
    for name, text in ((ins["platform"], plat), (ins["seed"], seed)):
        seen: dict[str, int] = {}
        for ln in text.splitlines():
            if ln.startswith("- **"):
                seen[ln] = seen.get(ln, 0) + 1
        for ln, n in seen.items():
            if n > 1:
                bad.append(f"{name}: a rule bullet appears {n} times: {ln[:80]}")
    return bad


def check_schema(c: dict, root=ROOT) -> list[str]:
    """The contract validates against its JSON Schema (draft 2020-12). Without the jsonschema package the required keys are still checked."""
    ref = c.get("$schema", "")
    sp = (Path(root) / CONTRACT).parent / ref
    if not ref.startswith("./") or not sp.exists():
        return [f"{CONTRACT}: $schema must point at ./schemas/coldstart.schema.json"]
    schema = json.loads(sp.read_text(encoding="utf-8"))
    try:
        import jsonschema
    except ImportError:
        return [f"{CONTRACT}: missing required key {k}" for k in schema["required"] if k not in c]
    v = jsonschema.Draft202012Validator(schema)
    return [f"{CONTRACT}: {'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message}" for e in v.iter_errors(c)]


def ignition_stages(root=ROOT) -> list[str]:
    src = (Path(root) / load(root)["definition"]["stages_from"]).read_text(encoding="utf-8")
    m = re.search(r"export const STAGES = \[(.*?)\]", src)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []


def check_definition(c: dict, root=ROOT) -> list[str]:
    """The canonical definition: one text, the same in platform and seed, imported by both CLAUDE.md files, naming every part of the contract."""
    root, d, bad = Path(root), c["definition"], []
    plat, seed = root / d["platform"], root / d["seed"]
    if not plat.exists() or not seed.exists():
        return [f"the canonical definition is missing: {d['platform'] if not plat.exists() else d['seed']}"]
    text = plat.read_text(encoding="utf-8")
    if seed.read_text(encoding="utf-8") != text:
        bad.append(f"{d['seed']} differs from {d['platform']}: a new system would be born with a different definition")
    for f, want in (("CLAUDE.md", d["platform"]), ("seed/CLAUDE.md", str(Path(d["seed"]).relative_to("seed")))):
        if want not in _imports(root / f):
            bad.append(f"{f}: does not import {want}, so an agent starting there never loads the definition")
    stages = ignition_stages(root)
    if not stages:
        bad.append(f"{d['stages_from']}: no STAGES list found")
    from .seedlaunch import REQUIRED
    if list(REQUIRED) != d["bootstrap_stages"]:
        bad.append(f"bootstrap_stages {d['bootstrap_stages']} differ from foundation/seedlaunch.py REQUIRED {list(REQUIRED)}")
    for kind, names in (("capability", [x["id"] for x in c["capabilities"]]), ("ignition stage", stages), ("criticality regime", d["regimes"]),
                        ("bootstrap stage", d["bootstrap_stages"])):
        for n in names:
            if f"`{n}`" not in text:
                bad.append(f"{d['platform']}: does not name the {kind} `{n}`")
    return bad


def check(root=ROOT) -> list[str]:
    c = load(root)
    bad = check_schema(c, root)
    if bad:
        return bad
    return check_capabilities(c, root) + check_definition(c, root) + check_commands(c, root) + check_instructions(c, root)


def _get(url: str, timeout=20):
    req = urllib.request.Request(url, headers={"user-agent": UA, "accept": "application/json, text/html"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("content-type", ""), r.read(200_000)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", "") if e.headers else "", e.read(200_000)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return 0, "", str(e).encode()


def live(base: str, root=ROOT, get=_get) -> list[dict]:
    """Probe every live path of the contract on a deployed system. Each row: capability, path, status, ok, why."""
    rows = []
    for cap in load(root)["capabilities"]:
        lv = cap.get("live")
        if not lv:
            continue
        status, ctype, body = get(base.rstrip("/") + lv["path"])
        why = ""
        if status not in lv["status"]:
            why = f"status {status}, expected {lv['status']}"
        elif lv.get("json"):
            try:
                json.loads(body)
            except ValueError:
                why = "answer is not JSON"
        elif lv.get("html") and "text/html" not in ctype:
            why = f"content-type {ctype or 'none'}, expected text/html"
        rows.append({"capability": cap["id"], "rule": cap["rule"], "path": lv["path"], "status": status, "ok": not why, "why": why})
    return rows


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--list" in a:
        for cap in load()["capabilities"]:
            print(f"{cap['id']:16} {cap['rule']:22} live={((cap.get('live') or {}).get('path') or '-'):30} fleet={cap.get('fleet') or '-'}")
        return 0
    if "--live" in a:
        i = a.index("--live")
        rows = live(a[i + 1])
        for r in rows:
            print(f"{'OK  ' if r['ok'] else 'FAIL'} {r['capability']:16} {r['path']:30} {r['status']} {r['why']}")
        return 0 if all(r["ok"] for r in rows) else 1
    bad = check()
    print("\n".join(bad) if bad else f"coldstart ok: {len(load()['capabilities'])} capabilities carried by the seed, every named command resolves, agent files agree")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
