# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""USER-BACKEND-1 as code (Rowan, 2026-11-17). Ultrastable is the foundation for any autonomous system.

The user does their idea and their front end. The system does the backend: errors, credentials, deploys, identity, retries.
Backend work is auditable by the owner and never leaks to, or burdens, the user. And one improvement improves every system:
a fix learned anywhere lives in one shared module that every Worker and tenant imports.

  python3 -m foundation userbackend --check     no raw backend error text in a user-facing response; every Worker reaches the shared
                                                 errors module; no fork of a shared module; tenants inherit the rule through the seed
  python3 -m foundation userbackend --scan      list every leak finding (check fails on any)

Data: doctrine/user-backend.json. Shared module: seed/worker/src/errors.js. Tests: tests/foundation/test_userbackend.py.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/user-backend.json"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _surface_files(root: Path, d: dict) -> list[Path]:
    out = set()
    for g in d["surface_globs"]:
        out.update(p for p in root.glob(g) if p.is_file())
    keep = []
    for p in sorted(out):
        rel = p.relative_to(root).as_posix()
        if any(Path(rel).match(x) for x in d["surface_exclude_globs"]):
            continue
        keep.append(p)
    return keep


def leaks(root=REPO, d: dict | None = None) -> list[str]:
    """Lines of user-facing code that put raw backend error text into something a person can see."""
    root, d = Path(root), d or load(root)
    ign = re.compile(d["leak_ignore_line"])
    pats = [(x["id"], re.compile(x["re"])) for x in d["leak_patterns"]]
    exempt = d.get("service_binding_exempt", {})
    found = []
    for p in _surface_files(root, d):
        rel = p.relative_to(root).as_posix()
        if rel in exempt:
            continue
        for n, ln in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if ign.search(ln):
                continue
            for pid, rx in pats:
                if rx.search(ln):
                    found.append(f"{rel}:{n}: {pid}: raw backend error text can reach a user (use userError/userJson from {d['shared_errors_module']}; log the detail, answer in plain words): {ln.strip()[:90]}")
    return found


def _imports(p: Path) -> list[Path]:
    out = []
    for m in re.finditer(r"""(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']""", p.read_text(encoding="utf-8", errors="replace")):
        spec = m.group(1) or m.group(2)
        if spec.startswith("."):
            t = (p.parent / spec).resolve()
            if t.is_file():
                out.append(t)
    return out


def reaches(start: Path, target: Path) -> bool:
    seen, todo = set(), [start.resolve()]
    target = target.resolve()
    while todo:
        cur = todo.pop()
        if cur == target:
            return True
        if cur in seen or not cur.is_file():
            continue
        seen.add(cur)
        todo.extend(_imports(cur))
    return False


def shared_failures(root=REPO, d: dict | None = None) -> list[str]:
    root, d = Path(root), d or load(root)
    bad = []
    for s in d["shared_consumers"]:
        mod = root / s["module"]
        if not mod.is_file():
            bad.append(f"{s['id']}: shared module {s['module']} is missing"); continue
        for entry in s["must_reach_from"]:
            e = root / entry
            if not e.is_file():
                bad.append(f"{s['id']}: entry {entry} is missing")
            elif not reaches(e, mod):
                bad.append(f"{entry}: does not consume the shared {s['id']} module {s['module']} (a fork or a gap; import it)")
        pats = [re.compile(x) for x in s.get("fork_patterns", [])]
        exempt = set(s.get("fork_exempt", [])) | {s["module"]}
        for p in sorted(root.rglob("*")):
            if not p.is_file() or p.suffix not in (".js", ".mjs", ".py") or "node_modules" in p.parts or ".git" in p.parts:
                continue
            rel = p.relative_to(root).as_posix()
            if rel in exempt or ".test." in rel or rel.startswith("tests/"):
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            for rx in pats:
                if rx.search(text):
                    bad.append(f"{rel}: forks the shared {s['id']} module ({rx.pattern[:50]}); use {s['module']}")
    return bad


def inheritance_failures(root=REPO, d: dict | None = None) -> list[str]:
    root, d = Path(root), d or load(root)
    bad = [f"{rel}: tenants would not inherit USER-BACKEND-1 (missing)" for rel in d["inherited_by_tenants"] if not (root / rel).is_file()]
    for rel in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
        p = root / rel
        if p.is_file() and d["marker"] not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: lacks the {d['marker']} rule")
    return bad


def check(root=REPO) -> list[str]:
    root = Path(root); d = load(root)
    return leaks(root, d) + shared_failures(root, d) + inheritance_failures(root, d)


def main(argv: list[str]) -> int:
    if argv[:1] == ["--scan"]:
        found = leaks(); print("\n".join(found) or "no leaks"); return 0
    bad = check()
    print("\n".join(bad) or "userbackend ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
