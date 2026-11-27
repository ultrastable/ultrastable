#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-ENTRY-1: a short entry file every agent can read, and the standing rules fetched by path. Ultrastable is the foundation for any autonomous system.

An agent starts from one short file (AGENTS.md; CLAUDE.md is `@AGENTS.md`). The standing rules stay word for word in agents/AGENTS.md and are
enforced by the checks they name; an agent reads the ones that govern the files it is about to change instead of all of them:

  python3 scripts/agentrules.py --for PATH [PATH ...] [--full] [--limit N]   rules that name these paths (or a directory above or below them)
  python3 scripts/agentrules.py --show ID [ID ...]                            one rule in full, by id, a word of its title, or an id its text cites
  python3 scripts/agentrules.py --list                                        every rule: id and title
  python3 scripts/agentrules.py --budget                                      size of what an agent loads before it starts (JSON)
  python3 scripts/agentrules.py --check                                       the entry stays inside its budget and still names every document

Why a budget: Codex stops reading project instructions at 32 KiB, Claude Code's guidance is under 200 lines per file ("longer files consume
more context and reduce adherence"), and an `@import` loads the whole imported file, so it saves nothing. The numbers are in the config
(autonomy/agent-entry.json in a kit, doctrine/agent-entry.json in the platform). No model calls, no network.
Tests: tests/test_agentrules.py."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
CONFIG = "autonomy/agent-entry.json"
ID = re.compile(r"\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+\b")
BULLET = re.compile(r"^- \*\*(.+?)\*\*(.*)$")
AXIOM = re.compile(r"^> ([A-Z][A-Z-]+[A-Z])(?: \([^)]*\))?: ")
TICK = re.compile(r"`([^`\n]+)`")
PATHISH = re.compile(r"^[\w.@-]+(?:/[\w.@*-]+)+/?$|^[\w.-]+\.(?:py|js|mjs|json|md|yml|yaml|sh|sql|toml|jsonc)$")
CMD = re.compile(r"^(?:python3 |node |\./scripts/|bash |cd )")
IMPORT = re.compile(r"^@(\S+)\s*$", re.M)


def load(root=KIT, config=CONFIG) -> dict:
    return json.loads((Path(root) / config).read_text(encoding="utf-8"))


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:48]


def parse(text: str) -> list[dict]:
    """Every standing rule in the rule file: a bold-titled bullet or an axiom block quote. One rule per line of the file."""
    out, seen = [], {}
    for n, line in enumerate(text.splitlines(), 1):
        m, ax = BULLET.match(line), AXIOM.match(line)
        if not (m or ax):
            continue
        if ax:
            title, ids = ax.group(1), [ax.group(1)]
        else:
            title = m.group(1).strip().rstrip(".")
            paren = re.search(r"\(([^()]*)\)\s*$", title)
            ids = ID.findall(paren.group(1)) if paren else []
            if paren and ids:
                title = title[:paren.start()].strip()
            ids = ids or [slug(title)]
        if ids[0] in seen:  # the same bullet restated lower in the file: the first one is the rule of record
            continue
        ticks = [t.strip() for t in TICK.findall(line)]
        rule = {"id": ids[0], "ids": ids, "title": title, "line": n, "text": line,
                "paths": sorted({t.rstrip("/") for t in ticks if PATHISH.match(t) and not CMD.match(t)}),
                "checks": [t for t in dict.fromkeys(ticks) if CMD.match(t)]}
        for i in ids:
            seen.setdefault(i, rule)
        out.append(rule)
    return out


def rules(root=KIT, cfg=None) -> list[dict]:
    cfg = cfg or load(root)
    return parse((Path(root) / cfg["rules"]).read_text(encoding="utf-8"))


def _forms(path: str, prefix: str) -> set[str]:
    """A path as the rule file may spell it: the rule text is written in the platform, where the kit sits under seed/."""
    p = path.strip().lstrip("./").rstrip("/")
    return {p, prefix + p} if prefix and not p.startswith(prefix) else {p, p[len(prefix):]} if prefix else {p}


def for_paths(rs: list[dict], paths: list[str], prefix: str = "") -> list[tuple[int, dict]]:
    """Rules that name one of these paths, a directory above it or a file below it; the most specific match first."""
    hits = []
    for r in rs:
        best = 0
        for want in paths:
            for w in _forms(want, prefix):
                for rp in r["paths"]:
                    rp = rp.replace("*", "")
                    if w == rp or w.startswith(rp.rstrip("/") + "/") or rp.startswith(w + "/"):
                        best = max(best, len(rp) if w == rp or w.startswith(rp) else len(w))
                    elif "/" not in rp and w.rsplit("/", 1)[-1] == rp:  # the rule names the file without its directory
                        best = max(best, 1)
        if best:
            hits.append((best, r))
    return sorted(hits, key=lambda x: (-x[0], x[1]["line"]))


def find(rs: list[dict], key: str) -> list[dict]:
    k = key.strip()
    exact = [r for r in rs if k.upper() in (i.upper() for i in r["ids"])]
    return exact or [r for r in rs if k.lower() in r["title"].lower() or k.lower() in r["id"].lower()] or [r for r in rs if k in r["text"]]


def closure(root, entry: str, _seen=None) -> list[tuple[str, str]]:
    """The entry file and everything it @imports, in load order: what an agent holds before its first step."""
    root, _seen = Path(root), _seen if _seen is not None else set()
    p = root / entry
    if entry in _seen or not p.is_file():
        return []
    _seen.add(entry)
    text = p.read_text(encoding="utf-8")
    out = [(entry, text)]
    for imp in IMPORT.findall(text):
        rel = (p.parent / imp).resolve()
        try:
            out += closure(root, rel.relative_to(root.resolve()).as_posix(), _seen)
        except ValueError:
            pass
    return out


def named(root, entry: str) -> set[str]:
    """Repository paths an agent can reach from the entry: imported, linked or written in backticks in the loaded text."""
    root, got = Path(root), set()
    for rel, text in closure(root, entry):
        base = (root / rel).parent
        got.add(rel)
        for t in set(TICK.findall(text)) | set(re.findall(r"\]\(([^)#\s]+)\)", text)) | set(IMPORT.findall(text)):
            for cand in (root / t, base / t):
                if cand.is_file():
                    got.add(cand.resolve().relative_to(root.resolve()).as_posix())
    return got


def budget(root=KIT, cfg=None) -> dict:
    cfg = cfg or load(root)
    out = {"max_closure_bytes": cfg["max_closure_bytes"], "max_lines": cfg["max_lines"], "entries": {}}
    for e in cfg["entries"]:
        files = closure(root, e)
        out["entries"][e] = {"files": [f for f, _ in files], "bytes": sum(len(t.encode()) for _, t in files),
                             "lines": max((t.count("\n") + 1 for _, t in files), default=0)}
    return out


def check(root=KIT, cfg=None) -> list[str]:
    root = Path(root)
    cfg, bad = cfg or load(root), []
    b = budget(root, cfg)
    for e, v in b["entries"].items():
        if not v["files"]:
            bad.append(f"{e}: the entry file is missing")
            continue
        if v["bytes"] > cfg["max_closure_bytes"]:
            bad.append(f"{e}: loads {v['bytes']} bytes ({', '.join(v['files'])}), over the {cfg['max_closure_bytes']}-byte budget. "
                       "Move the text to a file the entry names and let agents fetch it; an @import loads the whole file.")
        if v["lines"] > cfg["max_lines"]:
            bad.append(f"{e}: a loaded file has {v['lines']} lines, over the {cfg['max_lines']}-line budget")
        reach = named(root, e)
        for need in cfg["must_name"]:
            if need not in reach:
                bad.append(f"{e}: does not name {need}, so an agent starting there cannot find it")
        loaded = "\n".join(t for _, t in closure(root, e))
        for word in cfg.get("must_say", []):
            if word not in loaded:
                bad.append(f"{e}: does not say `{word}`; an agent would not know how to fetch the rules for its files")
    rs = rules(root, cfg)
    if len(rs) < cfg.get("min_rules", 1):
        bad.append(f"{cfg['rules']}: {len(rs)} rules parsed, fewer than {cfg.get('min_rules', 1)}: the rule file changed shape")
    return bad


def _line(r: dict) -> str:
    return f"{r['id']}: {r['title']} ({r['line']})"


def main(argv=None, root=KIT, config=CONFIG) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    cfg = load(root, config)
    if "--check" in a:
        bad = check(root, cfg)
        print("\n".join(bad) or f"agent entry ok: {json.dumps({e: v['bytes'] for e, v in budget(root, cfg)['entries'].items()})} bytes loaded, {len(rules(root, cfg))} rules by path")
        return 1 if bad else 0
    if "--budget" in a:
        print(json.dumps(budget(root, cfg), indent=1))
        return 0
    rs = rules(root, cfg)
    if "--list" in a:
        print("\n".join(_line(r) for r in rs))
        return 0
    if "--show" in a:
        keys = [x for x in a[a.index("--show") + 1:] if not x.startswith("--")]
        got = [r for k in keys for r in find(rs, k)]
        print("\n\n".join(r["text"] for r in dict((r["id"], r) for r in got).values()) or f"no rule matches {keys}; try --list")
        return 0 if got else 1
    if "--for" in a:
        rest = a[a.index("--for") + 1:]
        limit = int(rest[rest.index("--limit") + 1]) if "--limit" in rest else 8
        paths = [x for i, x in enumerate(rest) if not x.startswith("--") and (i == 0 or rest[i - 1] != "--limit")]
        hits = for_paths(rs, paths, cfg.get("path_prefix", ""))
        if not hits:
            print(f"no standing rule names {' '.join(paths)}; the entry file's limits still apply")
            return 0
        for _, r in hits[:limit]:
            print(r["text"] if "--full" in rest else _line(r) + "".join(f"\n    check: {c}" for c in r["checks"][:4]))
        if len(hits) > limit:
            print(f"... {len(hits) - limit} more: " + ", ".join(r["id"] for _, r in hits[limit:]))
        if "--full" not in rest:
            print("full text: --show ID")
        return 0
    print(__doc__)
    return 0 if a in ([], ["--help"], ["-h"]) else 2


if __name__ == "__main__":
    sys.exit(main())
