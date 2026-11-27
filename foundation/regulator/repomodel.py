# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P1 Good Regulator: diff-maintained, content-addressed repo model.

update() re-parses only files whose sha changed, drops deleted files, and
recomputes module Merkle roots. The model never overrides the filesystem:
every card carries the source sha so a mismatch forces a re-read.
"""
import ast
import hashlib
import os
import re

JS_EXT = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx")
JS_IMPORT = re.compile(r"""(?:import\s[^'"]*?from\s*|import\s*\(\s*|import\s+|require\(\s*)['"](\.[^'"]+)['"]""")
JS_SYMBOL = re.compile(r"^\s*export\s+(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)", re.M)
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"}


def sha_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def module_of(rel):
    parts = rel.split(os.sep)
    return parts[0] if len(parts) > 1 else "."


def parse_py(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            tree = ast.parse(f.read())
    except (SyntaxError, UnicodeDecodeError, OSError):
        return [], []
    symbols, imports = [], []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbols.append(f"def {node.name}({', '.join(a.arg for a in node.args.args)})")
        elif isinstance(node, ast.ClassDef):
            symbols.append(f"class {node.name}")
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # keep relative form; resolved against the file's package later
                imports.append("." * node.level + (node.module or ""))
                imports += ["." * node.level + (node.module + "." if node.module else "") + a.name
                            for a in node.names]
            elif node.module:
                imports.append(node.module)
                imports += [node.module + "." + a.name for a in node.names]  # `from pkg import mod` reaches pkg/mod.py
    return symbols, sorted(set(imports))


def parse_js(path):
    """Multi-language step (HANDOFF roadmap 2), stdlib only: exported symbols and relative imports, no tree-sitter dependency.
    Relative specifiers are kept with a `js:` prefix and resolved against the importing file's directory in import_edges."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except (UnicodeDecodeError, OSError):
        return [], []
    symbols = [f"{'def' if k.startswith('function') else k} {n}" for k, n in JS_SYMBOL.findall(text)]
    return symbols, sorted({"js:" + m for m in JS_IMPORT.findall(text)})


def resolve_js(rel, spec, known):
    base = os.path.dirname(rel)
    parts = []
    for seg in os.path.join(base, spec).replace(os.sep, "/").split("/"):
        if seg == "..":
            parts and parts.pop()
        elif seg not in ("", "."):
            parts.append(seg)
    p = "/".join(parts)
    for cand in [p] + [p + e for e in JS_EXT] + [p + "/index" + e for e in JS_EXT]:
        if cand in known:
            return cand
    return None


class RepoModel:
    def __init__(self, store, root):
        self.store, self.root = store, os.path.abspath(root)

    def _walk(self):
        for d, dirs, files in os.walk(self.root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            for fn in sorted(files):
                if fn.endswith((".py",) + JS_EXT):
                    full = os.path.join(d, fn)
                    yield os.path.relpath(full, self.root), full

    def update(self):
        """Incremental refresh. Returns dict(parsed, unchanged, removed)."""
        db = self.store.db
        known = {r["path"]: r["sha"] for r in db.execute("SELECT path, sha FROM file_state")}
        seen, parsed, unchanged = set(), 0, 0
        for rel, full in self._walk():
            seen.add(rel)
            sha = sha_file(full)
            if known.get(rel) == sha:
                unchanged += 1
                continue
            symbols, imports = parse_js(full) if rel.endswith(JS_EXT) else parse_py(full)
            db.execute(
                "INSERT OR REPLACE INTO file_state VALUES(?,?,?,?,?)",
                (rel, sha, module_of(rel), "\n".join(symbols), "\n".join(imports)))
            parsed += 1
        removed = [p for p in known if p not in seen]
        for p in removed:
            db.execute("DELETE FROM file_state WHERE path=?", (p,))
        db.commit()
        return {"parsed": parsed, "unchanged": unchanged, "removed": len(removed)}

    def files(self):
        return list(self.store.db.execute("SELECT * FROM file_state ORDER BY path"))

    def module_root(self, module):
        h = hashlib.sha256()
        for r in self.store.db.execute(
                "SELECT path, sha FROM file_state WHERE module=? ORDER BY path", (module,)):
            h.update(f"{r['path']}:{r['sha']}\n".encode())
        return h.hexdigest()

    def import_edges(self):
        """file -> files it imports (resolved against repo paths)."""
        rows = self.files()
        by_mod = {}
        known = {r["path"] for r in rows}
        for r in rows:
            if not r["path"].endswith(".py"):
                continue
            p = r["path"][:-3].replace(os.sep, ".")
            by_mod[p] = r["path"]
            if p.endswith(".__init__"):
                by_mod[p[:-9]] = r["path"]
        edges = {r["path"]: set() for r in rows}
        for r in rows:
            if r["path"].endswith(JS_EXT):
                for imp in filter(None, r["imports"].split("\n")):
                    tgt = resolve_js(r["path"], imp[3:], known)
                    if tgt and tgt != r["path"]:
                        edges[r["path"]].add(tgt)
                continue
            pkg = r["path"][:-3].replace(os.sep, ".").split(".")
            pkg = pkg[:-1]  # drop module name (or "__init__") -> containing package
            for imp in filter(None, r["imports"].split("\n")):
                if imp.startswith("."):
                    lvl = len(imp) - len(imp.lstrip("."))
                    base = pkg[:len(pkg) - (lvl - 1)] if lvl > 1 else pkg
                    imp = ".".join(base + [x for x in imp.lstrip(".").split(".") if x])
                parts = imp.split(".")
                for i in range(len(parts), 0, -1):
                    tgt = by_mod.get(".".join(parts[:i]))
                    if tgt and tgt != r["path"]:
                        edges[r["path"]].add(tgt)
                        break
        return edges

    def rank(self, focus=(), iters=30, d=0.85):
        """Personalized PageRank over the import graph (Aider-style)."""
        edges = self.import_edges()
        nodes = sorted(edges)
        if not nodes:
            return {}
        pers = {n: (1.0 if n in focus else 0.0) for n in nodes}
        z = sum(pers.values()) or 1.0
        pers = {n: (v / z if sum(pers.values()) else 1 / len(nodes)) for n, v in pers.items()}
        r = dict(pers)
        for _ in range(iters):
            nxt = {n: (1 - d) * pers[n] for n in nodes}
            for n in nodes:
                outs = sorted(edges[n])
                if not outs:
                    for m in nodes:
                        nxt[m] += d * r[n] / len(nodes)
                else:
                    for m in outs:
                        nxt[m] += d * r[n] / len(outs)
            r = nxt
        return r

    def render_map(self, focus=(), budget_tokens=1024):
        """Deterministic, byte-stable map (P11): same inputs -> same bytes."""
        ranks = self.rank(focus)
        rows = {r["path"]: r for r in self.files()}
        order = sorted(ranks, key=lambda p: (-round(ranks[p], 9), p))
        out, used = [], 0
        for p in order:
            block = [p + f"  [{rows[p]['sha'][:8]}]"]
            block += ["  " + s for s in rows[p]["symbols"].split("\n") if s]
            text = "\n".join(block)
            cost = max(1, len(text) // 4)
            if used + cost > budget_tokens:
                continue
            out.append(text)
            used += cost
        return "\n".join(out)

    def card(self, module):
        files = [r for r in self.files() if r["module"] == module]
        return {
            "module": module,
            "root": self.module_root(module),
            "files": [r["path"] for r in files],
            "public": [s for r in files for s in r["symbols"].split("\n") if s and not s.split()[1].startswith("_")],
        }
