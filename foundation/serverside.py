"""Server-side only, as code (owner, 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation serverside --check     the tree and the registries name no host, scheduler, agent or route on a person's computer
  python3 -m foundation serverside --scan      the text scan alone, one line per match

Ultrastable runs server-side only: every loop, merge, deploy and check runs on the Cloudflare worker, GitHub Actions or a cloud-hosted
agent routine. `doctrine/server-side.json` holds the rule, the banned patterns, the scanned globs, the skipped directories and the short
exclude list (a reason per entry). `check` has three parts: the rule is present in the agent files; no scanned file matches a banned
pattern (a line that states the rule and cites it is the only excuse); and every host, route and loop path in the registries runs on one
of the listed server-side platforms. `foundation/doctrine.py` calls `check`, so the doctrine step of checks.yml enforces it.
"""
from __future__ import annotations
import fnmatch, json, os, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/server-side.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _match(rel: str, globs) -> bool:
    return any(g == "**/*" or fnmatch.fnmatch(rel, g) for g in globs)


def files(root, d: dict) -> list[str]:
    """Repository-relative paths the scan reads: every file matching `scan`, outside `skip_dirs`, not on the `exclude` list."""
    root = Path(root)
    skip = {s["path"] for s in d["skip_dirs"]}
    excluded = [e["path"] for e in d["exclude"]]
    out = []
    for base, dirs, names in os.walk(root):
        rel_base = Path(base).relative_to(root).as_posix()
        dirs[:] = sorted(n for n in dirs if n not in skip and (n if rel_base == "." else f"{rel_base}/{n}") not in skip)
        for n in sorted(names):
            rel = n if rel_base == "." else f"{rel_base}/{n}"
            if _match(rel, d["scan"]) and not _match(rel, excluded):
                out.append(rel)
    return out


def lint(text: str, d: dict) -> list[dict]:
    """Matches in one text: [{line, id, text}]. A line that cites the rule (`excused_by`) states it and is not a match."""
    rules = [(b["id"], re.compile(b["pattern"], re.I)) for b in d["banned"]]
    excused = re.compile(d["excused_by"], re.I)
    out = []
    for n, ln in enumerate(text.splitlines(), 1):
        if excused.search(ln):
            continue
        for bid, rx in rules:
            m = rx.search(ln)
            if m:
                out.append({"line": n, "id": bid, "text": ln[max(0, m.start() - 30):m.end() + 30].strip()})
    return out


def scan(root=REPO, d: dict | None = None) -> list[str]:
    root = Path(root); d = d or load(root)
    quick = re.compile("|".join(f"(?:{b['pattern']})" for b in d["banned"]), re.I)
    bad = []
    for rel in files(root, d):
        p = root / rel
        try:
            if p.stat().st_size > d["max_bytes"]:
                continue
            raw = p.read_bytes()
        except OSError:
            continue
        if b"\0" in raw[:4096]:
            continue
        text = raw.decode("utf-8", "replace")
        if not quick.search(text):
            continue
        bad += [f"{rel}:{f['line']}: names infrastructure on a person's computer ({f['id']}): {f['text']}" for f in lint(text, d)]
    return bad


def exclude_check(root, d: dict) -> list[str]:
    """The exclude list stays short and honest: every entry has a reason and still matches a file."""
    root, bad = Path(root), []
    for e in d["exclude"] + d["skip_dirs"]:
        if not (e.get("reason") or "").strip():
            bad.append(f"{PATH}: {e.get('path', '?')} is excluded without a reason")
    for e in d["exclude"]:
        if not any(root.glob(e["path"])):
            bad.append(f"{PATH}: exclude entry {e['path']} matches no file (stale entry; remove it)")
    return bad


def rule_check(root, d: dict) -> list[str]:
    root, bad = Path(root), []
    need = re.compile(d["required_pattern"], re.I)
    for rel in d["required_in"]:
        p = root / rel
        if not p.is_file() or not need.search(p.read_text(encoding="utf-8")):
            bad.append(f"{rel}: lacks the server-side-only rule ('{d['marker']} (owner, 2026-11-12)')")
    return bad


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


def registries_check(root, d: dict) -> list[str]:
    """Structure, not wording: every loop host runs on a listed platform through that platform's adapter, and no host, route or loop path
    is named or classed as being on a person's computer."""
    root, bad = Path(root), []
    reg, plats = d["registries"], d["platforms"]
    tok = re.compile(reg["local_token"], re.I)
    lp = root / reg["loops"]
    if lp.is_file():
        for h in json.loads(lp.read_text(encoding="utf-8")).get("hosts", []):
            hid, on = h.get("id", "?"), h.get("runs_on")
            if on not in plats:
                bad.append(f"{reg['loops']}: host {hid} runs_on {on!r}; a host runs on one of {sorted(plats)} (server-side only)")
            elif not _match(h.get("adapter", ""), plats[on]["adapters"]):
                bad.append(f"{reg['loops']}: host {hid} has adapter {h.get('adapter')!r}, which is not a {on} adapter ({', '.join(plats[on]['adapters'])})")
            for k in ("id", "adapter", "credential"):
                if tok.search(str(h.get(k, ""))):
                    bad.append(f"{reg['loops']}: host {hid} {k} {h.get(k)!r} names a host on a person's computer (server-side only)")
    rp = root / reg["routes"]
    if rp.is_file():
        for t in json.loads(rp.read_text(encoding="utf-8")).get("targets", []):
            for r in t.get("routes", []):
                if tok.search(str(r.get("id", ""))) or tok.search(str(r.get("credential", ""))):
                    bad.append(f"{reg['routes']}: target {t.get('id')} route {r.get('id')!r} names a route on a person's computer (server-side only)")
    gp = root / reg["loop_registry"]
    if gp.is_file():
        for l in json.loads(gp.read_text(encoding="utf-8")).get("loops", []):
            for p in l.get("paths", []):
                if tok.search(str(p.get("class", ""))) or tok.search(str(p.get("id", ""))):
                    bad.append(f"{reg['loop_registry']}: loop {l.get('id')} path {p.get('id')!r} (class {p.get('class')!r}) is a path on a person's computer; use a server-side class (server-side only)")
    return bad


def check(root=REPO) -> list[str]:
    root = Path(root); d = load(root)
    return rule_check(root, d) + exclude_check(root, d) + registries_check(root, d) + scan(root, d)


def main(argv: list[str]) -> int:
    bad = scan() if argv[:1] == ["--scan"] else check()
    print("\n".join(bad) or "serverside ok")
    return 1 if bad else 0
