"""CLOSED-LOOP-AXIOM as code (owner, 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation closedloop --check          axiom in every instruction file and prompt, human-dependency lint, consumers registry, loop trace, control register
  python3 -m foundation closedloop --lint FILE...   flag outputs that assume a person reads, reviews or decides
  python3 -m foundation closedloop --trace          each registered loop traced trigger -> consumer -> verification, open ends listed

Data: doctrine/closed-loop.json (axiom, patterns, scan globs), doctrine/consumers.json (artifact -> code consumer).
"""
from __future__ import annotations
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH, CONSUMERS = "doctrine/closed-loop.json", "doctrine/consumers.json"
CODE_SUFFIX = {".py", ".js", ".mjs", ".yml", ".yaml", ".sh"}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _glob(root: Path, patterns) -> list[Path]:
    out = []
    for g in patterns:
        out += [p for p in sorted(root.glob(g)) if p.is_file()]
    return out


def _exempt(root: Path, p: Path, d: dict) -> bool:
    return any(p.match(g) or p.relative_to(root).match(g) for g in d["lint_exempt"])


def lint(text: str, d: dict | None = None) -> list[dict]:
    d = d or load()
    excused, out = re.compile(d["excused_by"], re.I), []
    for n, ln in enumerate(text.splitlines(), 1):
        if excused.search(ln):
            continue
        for r in d["human_dependency"]:
            if any(re.search(p, ln, re.I) for p in r["patterns"]):
                out.append({"line": n, "rule": r["id"], "text": ln.strip()[:100]})
    return out


def axiom_check(root, d) -> list[str]:
    bad = []
    for p in _glob(root, d["instruction_files"]):
        t = p.read_text(encoding="utf-8")
        if p.name == "CLAUDE.md" and "@agents/AGENTS.md" in t or p.name == "CLAUDE.md" and "@AGENTS.md" in t:
            continue
        if d["marker"] not in t:
            bad.append(f"{p.relative_to(root).as_posix()}: lacks {d['marker']}")
    for rel in d["prompt_sources"]:
        if d["marker"] not in (root / rel).read_text(encoding="utf-8"):
            bad.append(f"{rel}: the prompt does not load {d['marker']}")
    return bad


def lint_check(root, d) -> list[str]:
    bad = []
    for p in _glob(root, d["lint_scan"]):
        if _exempt(root, p, d):
            continue
        for f in lint(p.read_text(encoding="utf-8"), d):
            bad.append(f"{p.relative_to(root).as_posix()}:{f['line']}: {f['rule']}: {f['text']}")
    return bad


def consumers_check(root, d=None) -> list[str]:
    """Every generated artifact matches a registry entry whose consumer is code that exists and names the artifact."""
    root, bad = Path(root), []
    reg = json.loads((root / CONSUMERS).read_text(encoding="utf-8"))
    covered: set[Path] = set()
    for e in reg["artifacts"]:
        files = _glob(root, [e["glob"]])
        if not files and not e.get("optional"):
            bad.append(f"consumer entry {e['glob']}: matches no file (stale entry)")
        cons = root / e["consumer"]
        if cons.suffix not in CODE_SUFFIX or not cons.is_file():
            bad.append(f"{e['glob']}: consumer {e['consumer']} is not code that exists")
            continue
        src = cons.read_text(encoding="utf-8", errors="replace")
        if not re.search(e["reads"], src):
            bad.append(f"{e['glob']}: consumer {e['consumer']} does not read it (no match for /{e['reads']}/)")
            continue
        covered.update(files)
    for g in reg["roots"]:
        for p in _glob(root, [g]):
            if p not in covered:
                bad.append(f"{p.relative_to(root).as_posix()}: generated artifact with no code consumer (register it or remove it)")
    return bad


def trace(root=REPO) -> list[str]:
    """trigger -> consumer -> verification for every loop; an open end is any link that is a person."""
    from . import loops, selfhost
    root, d, bad = Path(root), load(root), []
    wf = {p.name: p.read_text(encoding="utf-8") for p in (root / ".github/workflows").glob("*.yml")}
    for l in loops.load(root)["loops"]:
        i = l["id"]
        if l.get("closes_by") != "system":
            bad.append(f"{i}: closes_by {l.get('closes_by')!r}; only 'system' closes a loop (a gate card is an open end)")
        if re.search(r"\b(owner|person|human|rowan)\b.*\b(dispatch|click|decide|approve|review)", l.get("trigger", ""), re.I):
            bad.append(f"{i}: trigger depends on a person ({l['trigger'][:60]})")
        code = [s for s in l.get("system_path", []) if (root / s).suffix in CODE_SUFFIX | {".json"} and (root / s).is_file()]
        if not code and not l.get("workflows"):
            bad.append(f"{i}: no code consumer (system_path or workflow)")
        if not l.get("staged_default") and l.get("credentials"):
            bad.append(f"{i}: uses credentials but has no staged_default (what runs while the credential is absent)")
        try:
            if not selfhost.probe(root, l["closing_probe"]):
                bad.append(f"{i}: verification (closing probe) fails")
        except (ValueError, KeyError) as e:
            bad.append(f"{i}: verification unusable: {e}")
    return bad


def controls_check(root, d=None) -> list[str]:
    """Human-approval controls are replaced by automated gates and recorded in the control register."""
    root, bad = Path(root), []
    regs = json.loads((root / "doctrine/registers.json").read_text(encoding="utf-8"))
    ids = {c["id"]: c for c in regs["controls"]}
    for need in ("ctl-codeowners", "ctl-protected-change-label", "ctl-required-human-review"):
        c = ids.get(need)
        if not c:
            bad.append(f"control {need} is not in the register")
        elif c["disposition"] not in ("remove", "replace") or not c.get("replacement"):
            bad.append(f"{need}: a human-approval control is removed or replaced with an automated gate")
    co = root / ".github/CODEOWNERS"
    if co.exists() and re.search(r"^\s*[^#\s]+\s+@\w", co.read_text(encoding="utf-8"), re.M):
        bad.append(".github/CODEOWNERS assigns a human approver; replace it with the automated protected-path check")
    return bad


def merge_policy_check(root) -> list[str]:
    m = json.loads((Path(root) / "doctrine/fleet.json").read_text(encoding="utf-8"))["merge"]
    bad = []
    if m.get("wait_minutes") != 0 or m.get("reviews_required") != 0:
        bad.append("doctrine/fleet.json merge: wait_minutes and reviews_required must be 0 (merge on green at once)")
    if not m.get("ready_drafts") or not m.get("auto_close_on_probe"):
        bad.append("doctrine/fleet.json merge: ready_drafts and auto_close_on_probe must be true (resolve every PR and issue automatically)")
    return bad


def check(root=REPO) -> list[str]:
    root = Path(root); d = load(root)
    from . import queue
    return queue.check(root) + axiom_check(root, d) + lint_check(root, d) + consumers_check(root, d) + trace(root) + controls_check(root, d) + merge_policy_check(root)


def main(argv: list[str]) -> int:
    if argv[:1] == ["--lint"]:
        found = [f"{fn}:{x['line']}: {x['rule']}: {x['text']}" for fn in argv[1:] for x in lint(Path(fn).read_text(encoding="utf-8"))]
        print("\n".join(found) or "closed-loop lint ok"); return 1 if found else 0
    bad = trace() if argv[:1] == ["--trace"] else check()
    print("\n".join(bad) or "closedloop ok"); return 1 if bad else 0
