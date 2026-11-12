"""AGENT-INTEROP-1: agent-interoperability standards as data, checked in code (owner directive 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation agentstd --check    every standard has a source and date; implemented ones have code and a passing proof; declined/pending have a reason/trigger and probe;
                                            every instruction file carries the AGENT-CONSUMPTION marker
  python3 -m foundation agentstd --stamp    append the marker line to instruction files that lack it
Data: doctrine/agent-standards.json.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/agent-standards.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _files(root: Path, pats):
    return [p for g in pats for p in sorted(root.glob(g)) if p.is_file()]


def probe_ok(root, spec: str) -> bool:
    root = Path(root)
    if spec.startswith("file:"):
        return (root / spec[5:]).is_file()
    if spec.startswith("grep:"):
        f, _, rx = spec[5:].partition("::")
        p = root / f
        return p.is_file() and re.search(rx, p.read_text(encoding="utf-8")) is not None
    return False


def marker_gaps(root, d) -> list[str]:
    out = []
    for p in _files(Path(root), d["instruction_files"]):
        if d["marker"] not in p.read_text(encoding="utf-8"):
            out.append(f"{p.relative_to(root).as_posix()}: lacks {d['marker']}")
    return out


def check(root=REPO) -> list[str]:
    root, d, bad, seen = Path(root), load(root), [], set()
    for s in d["standards"]:
        i = s.get("id", "?")
        if i in seen:
            bad.append(f"{i}: duplicate id")
        seen.add(i)
        if s.get("status") not in ("implemented", "declined", "pending"):
            bad.append(f"{i}: status must be implemented, declined or pending")
        if not str(s.get("source", "")).startswith("https://") or not re.fullmatch(r"\d{4}-\d\d-\d\d", str(s.get("read", ""))):
            bad.append(f"{i}: needs an https source and the date it was read")
        if s.get("status") == "implemented":
            if not (root / s.get("code", "-")).is_file():
                bad.append(f"{i}: code file missing")
            if not probe_ok(root, s.get("proof", "")):
                bad.append(f"{i}: proof probe fails")
        else:
            if not s.get("trigger") or not probe_ok(root, s.get("probe", "")):
                bad.append(f"{i}: declined/pending needs a trigger and a passing probe")
            if s["status"] == "declined" and not s.get("reason"):
                bad.append(f"{i}: declined needs a reason")
    return bad + marker_gaps(root, d)


def stamp(root=REPO) -> list[str]:
    d, done = load(root), []
    for p in _files(Path(root), d["instruction_files"]):
        t = p.read_text(encoding="utf-8")
        if d["marker"] not in t:
            p.write_text(t.rstrip("\n") + "\n\n> " + d["marker_text"] + "\n", encoding="utf-8")
            done.append(p.relative_to(root).as_posix())
    return done


def main(argv) -> int:
    if "--stamp" in argv:
        print("stamped", stamp())
        return 0
    bad = check()
    print("agentstd ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
