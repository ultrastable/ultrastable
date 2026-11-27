# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""REPO-MAP-1 (Good Regulator, Conant and Ashby 1970): an agent should not re-read the repository to learn its shape.

  python3 -m foundation repomap --map [--budget TOKENS] [--focus PATH ...]   print a ranked map of modules that fits the token budget
  python3 -m foundation repomap --card PATH                                  print one module's card (purpose, defs, imports, hash)
  python3 -m foundation repomap --check                                      the cache rebuilds, every card's hash matches its file

Each module gets a card keyed by the sha256 of its content: first docstring line, public defs, and the in-repo modules it imports.
Cards live in a content-addressed cache (.cache/repomap.json, never committed). A rebuild re-parses only files whose hash changed,
so the map is maintained by diff, not re-derived. Ranking is in-degree over import edges, so the modules most others lean on come
first. The live filesystem stays authoritative: a card whose hash no longer matches is re-parsed before it is shown.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import ast, hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CACHE = ".cache/repomap.json"
ROOTS = (("foundation", "*.py"), ("seed/scripts", "*.py"), ("seed/worker/src", "**/*.js"), ("workers/core", "**/*.js"))
JS_IMPORT = re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*)['"](\.[^'"]+)['"]""")
JS_EXPORT = re.compile(r"export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)")
JS_DOC = re.compile(r"^\s*(?://|/\*+|\*)\s*(.+?)\s*(?:\*/)?$")


def files(root=REPO) -> list[str]:
    out = []
    for base, pat in ROOTS:
        d = root / base
        if d.is_dir():
            out += [p.relative_to(root).as_posix() for p in d.glob(pat) if p.is_file() and "/test" not in p.as_posix()]
    return sorted(out)


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def _py_card(path: str, text: str) -> dict:
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return {"purpose": "(does not parse)", "defs": [], "imports": []}
    doc = (ast.get_docstring(tree) or "").strip().splitlines()
    defs = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not n.name.startswith("_")]
    pkg = path.rsplit("/", 1)[0]
    imps = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.level:
            for a in n.names if not n.module else [n]:
                name = n.module or a.name
                imps.add(f"{pkg}/{name.replace('.', '/')}.py")
        elif isinstance(n, ast.ImportFrom) and n.module and n.module.startswith("foundation"):
            imps.add(n.module.replace(".", "/") + ".py")
    return {"purpose": doc[0] if doc else "", "defs": defs, "imports": sorted(imps)}


def _js_card(path: str, text: str) -> dict:
    purpose = ""
    for line in text.splitlines()[:12]:
        m = JS_DOC.match(line)
        if m and "SPDX" not in m.group(1) and "Copyright" not in m.group(1) and m.group(1).strip("*/ "):
            purpose = m.group(1).strip(); break
    base = Path(path).parent
    imps = set()
    for rel in JS_IMPORT.findall(text):
        p = (base / rel).as_posix()
        parts = []
        for seg in p.split("/"):
            if seg == "..":
                parts and parts.pop()
            elif seg != ".":
                parts.append(seg)
        p = "/".join(parts)
        imps.add(p if p.endswith((".js", ".mjs")) else p + ".js")
    return {"purpose": purpose, "defs": JS_EXPORT.findall(text), "imports": sorted(imps)}


def card(path: str, text: str) -> dict:
    c = _py_card(path, text) if path.endswith(".py") else _js_card(path, text)
    return {"hash": sha(text), **c}


def build(root=REPO, cache_path=None) -> tuple[dict, int]:
    """(cards by path, number of files re-parsed). Unchanged hashes reuse the cached card."""
    cp = root / (cache_path or CACHE)
    old = {}
    if cp.exists():
        try:
            old = json.loads(cp.read_text()).get("cards", {})
        except (ValueError, OSError):
            old = {}
    cards, parsed = {}, 0
    for f in files(root):
        text = (root / f).read_text(errors="replace")
        h = sha(text)
        if f in old and old[f].get("hash") == h:
            cards[f] = old[f]
        else:
            cards[f] = card(f, text); parsed += 1
    cp.parent.mkdir(parents=True, exist_ok=True)
    cp.write_text(json.dumps({"cards": cards}, sort_keys=True))
    return cards, parsed


def rank(cards: dict, focus=()) -> list[tuple[str, float]]:
    score = {p: 0.0 for p in cards}
    for p, c in cards.items():
        for i in c["imports"]:
            if i in score and i != p:
                score[i] += 1.0
    for f in focus:  # personalise: the focus files and their direct neighbours lead
        for p, c in cards.items():
            if p == f:
                score[p] += 1000
            elif f in c["imports"] or p in cards.get(f, {}).get("imports", []):
                score[p] += 100
    return sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))


def render(cards: dict, budget=4000, focus=()) -> str:
    """Ranked lines until the budget (about four characters a token) is spent. Byte-stable for a given tree."""
    lines, used = [], 0
    for p, _ in rank(cards, focus):
        c = cards[p]
        line = f"{p} [{c['hash'][:8]}] {c['purpose'][:110]}"
        if c["defs"]:
            line += " :: " + ", ".join(c["defs"][:8])
        cost = len(line) // 4 + 1
        if used + cost > budget:
            break
        lines.append(line); used += cost
    return "\n".join(lines)


def check(root=REPO) -> list[str]:
    cards, _ = build(root)
    errs = []
    for p, c in cards.items():
        if c["hash"] != sha((root / p).read_text(errors="replace")):
            errs.append(f"{p}: card hash does not match the file")
    if not cards:
        errs.append("no modules found under the map roots")
    return errs


def _arg(argv, flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else default


def main(argv) -> int:
    if "--check" in argv:
        errs = check()
        for e in errs:
            print(f"repomap: {e}")
        print(f"repomap {'ok' if not errs else 'FAILED'}")
        return 1 if errs else 0
    if "--card" in argv:
        cards, _ = build()
        p = _arg(argv, "--card")
        if p not in cards:
            print(f"repomap: no card for {p}"); return 1
        print(json.dumps({p: cards[p]}, indent=1)); return 0
    if "--map" in argv:
        cards, _ = build()
        focus = [a for a in argv[argv.index("--focus") + 1:] if not a.startswith("--")] if "--focus" in argv else []
        print(render(cards, int(_arg(argv, "--budget", 4000)), focus)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
