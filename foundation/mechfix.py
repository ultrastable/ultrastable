"""MECH-FIX-1: mechanical findings are fixed by code, not by a model.

  python3 -m foundation mechfix [--check] [--fix PATH]

A finding whose fix is fully determined by the syntax tree (an unused module-level import) needs no model call. Measured 2026-11-20 in
ops/executor-log.jsonl: 12 of 12 model attempts on `Q-SELF-unused-import-*` items failed, because the model re-emits the whole file and breaks it,
while none of the 14 findings was a false positive. The executor (foundation/executor.py, `mech_call`) asks this module first; the change then goes
through the same scope check, targeted checks, write-back, pull request and merge lane as any other. Tests: tests/foundation/test_mechfix.py.
"""
from __future__ import annotations
import ast, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ITEM = re.compile(r"^Q-SELF-unused-import-")
KEY = re.compile(r"signal `unused_import` on `([^`]+)`")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}


def unused_names(src: str) -> list[str]:
    from . import selfcode
    return [f.rsplit(" ", 1)[-1] for f in selfcode._unused_imports(src)]


def externally_used(root, rel: str, name: str) -> bool:
    """True when another Python file reaches `name` through this module (module.name, a patch target string, or from module import name)."""
    root, stem = Path(root), Path(rel).stem
    pat = re.compile(rf"(?:\b{re.escape(stem)}\.{re.escape(name)}\b|from\s+[\w.]*\b{re.escape(stem)}\s+import[^\n]*\b{re.escape(name)}\b)")
    for p in root.rglob("*.py"):
        if SKIP_DIRS & set(p.parts) or p.relative_to(root).as_posix() == rel:
            continue
        try:
            if pat.search(p.read_text(encoding="utf-8", errors="replace")):
                return True
        except OSError:
            continue
    return False


def strip_imports(src: str, names) -> str:
    """`src` without the module-level import bindings in `names`. A statement that still binds something else is rewritten with the rest;
    a trailing comment on a rewritten one-line statement is kept. Raises ValueError when the result would not parse or a name is still bound unused."""
    names, lines = set(names), src.splitlines(keepends=True)
    edits = []
    for n in ast.parse(src).body:
        if not isinstance(n, (ast.Import, ast.ImportFrom)) or (isinstance(n, ast.ImportFrom) and n.module == "__future__"):
            continue
        bind = (lambda a: (a.asname or a.name).split(".")[0]) if isinstance(n, ast.Import) else (lambda a: a.asname or a.name)
        keep = [a for a in n.names if bind(a) not in names]
        if len(keep) == len(n.names):
            continue
        new = ""
        if keep:
            m = ast.Import(names=keep) if isinstance(n, ast.Import) else ast.ImportFrom(module=n.module, names=keep, level=n.level)
            tail = lines[n.end_lineno - 1][n.end_col_offset:].rstrip("\r\n")
            new = ast.unparse(ast.fix_missing_locations(m)) + (tail if tail.strip().startswith("#") else "") + "\n"
        edits.append((n.lineno, n.end_lineno, new))
    for a, b, new in sorted(edits, reverse=True):
        lines[a - 1:b] = [new] if new else []
    out = "".join(lines)
    ast.parse(out)
    left = names & set(unused_names(out))
    if left:
        raise ValueError("still unused after the rewrite: " + ", ".join(sorted(left)))
    return out


def fix_file(root, rel: str) -> dict | None:
    """The edit for one file, or None when nothing is safely removable. Names another file reaches through the module are left alone."""
    p = Path(root) / rel
    src = p.read_text(encoding="utf-8")
    names = [n for n in unused_names(src) if not externally_used(root, rel, n)]
    if not names:
        return None
    return {"path": rel, "content": strip_imports(src, names), "names": names}


def key_of(issue: dict) -> str | None:
    m = KEY.search(str(issue.get("body") or ""))
    return m.group(1) if m and ITEM.match(str(issue.get("number") or issue.get("id") or "")) else None


def call_for(issue: dict, root=REPO):
    """Stands in for the model on a mechanical item: returns a model_call that yields the computed edit, or None when this module has no fix
    (the item then goes to the model ladder as before)."""
    rel = key_of(issue)
    if not rel or not (Path(root) / rel).is_file():
        return None
    try:
        e = fix_file(root, rel)
    except (SyntaxError, ValueError, OSError):
        return None
    if not e:
        return None
    return lambda _prompt: {"summary": f"{issue.get('number') or issue.get('id')}: remove unused import {', '.join(e['names'])} from {rel} (MECH-FIX-1, computed from the syntax tree, no model call)",
                            "files": [{"path": rel, "content": e["content"]}]}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--fix" in argv:
        rel = argv[argv.index("--fix") + 1]
        e = fix_file(REPO, rel)
        if e:
            (REPO / rel).write_text(e["content"], encoding="utf-8")
        print(f"mechfix: {rel}: " + ("removed " + ", ".join(e["names"]) if e else "nothing to remove"))
        return 0
    probe = "import os, sys\nfrom pathlib import Path\nimport json as j, re  # kept\nprint(os.sep, j)\n"
    out = strip_imports(probe, ["sys", "Path", "re"])
    ok = out == "import os\nimport json as j  # kept\nprint(os.sep, j)\n"
    print("mechfix ok" if ok else "mechfix: self-test failed: " + repr(out))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
