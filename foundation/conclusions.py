# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CONCLUSION-CACHE-1: memoize what an agent worked out, keyed by the files it read, like a build system's action cache.

  python3 -m foundation conclusions --ask "QUESTION"                          print the cached answer if every evidence file is unchanged
  python3 -m foundation conclusions --put "QUESTION" --answer A --evidence F [F ...]   record an answer with the hash of each file read
  python3 -m foundation conclusions --check                                   the ledger parses; stale entries are listed, not failed

"Where are protected paths defined?" gets derived again by every session. An answer stays valid while the sha256 of every file it
cites is unchanged; one changed byte in its evidence makes it stale, and --ask then says so and names the changed files so the agent
re-derives only that. Record every file read during the derivation, or the cache can serve an answer that depended on a file it
never saw. The ledger is doctrine/conclusions.json; stale entries are dropped the next time the same question is put.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LEDGER = "doctrine/conclusions.json"


def key(q: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", q.lower()).strip()


def fhash(root: Path, f: str) -> str | None:
    p = root / f
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16] if p.is_file() else None


def load(root=REPO) -> dict:
    p = root / LEDGER
    return json.loads(p.read_text()) if p.exists() else {"_doc": "CONCLUSION-CACHE-1: read by foundation/conclusions.py", "entries": []}


def save(data: dict, root=REPO):
    data["entries"].sort(key=lambda e: e["key"])
    (root / LEDGER).write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")


def changed(entry: dict, root=REPO) -> list[str]:
    return [f for f, h in entry["evidence"].items() if fhash(root, f) != h]


def ask(q: str, root=REPO) -> tuple[str, dict | None, list[str]]:
    """('hit'|'stale'|'miss', entry, changed files)."""
    for e in load(root)["entries"]:
        if e["key"] == key(q):
            ch = changed(e, root)
            return ("stale" if ch else "hit"), e, ch
    return "miss", None, []


def put(q: str, answer: str, evidence: list[str], root=REPO) -> dict:
    if not evidence:
        raise ValueError("an answer needs the files it was derived from")
    ev = {}
    for f in evidence:
        h = fhash(root, f)
        if h is None:
            raise ValueError(f"evidence file not found: {f}")
        ev[f] = h
    data = load(root)
    data["entries"] = [e for e in data["entries"] if e["key"] != key(q)]
    entry = {"key": key(q), "question": q, "answer": answer, "evidence": ev}
    data["entries"].append(entry)
    save(data, root)
    return entry


def check(root=REPO) -> tuple[list[str], list[str]]:
    errs, stale = [], []
    try:
        data = load(root)
    except ValueError as e:
        return [f"ledger does not parse: {e}"], []
    for e in data.get("entries", []):
        if not {"key", "question", "answer", "evidence"} <= set(e) or not e["evidence"]:
            errs.append(f"entry {e.get('key', '?')}: needs question, answer and at least one evidence file")
        elif changed(e, root):
            stale.append(e["question"])
    return errs, stale


def main(argv) -> int:
    if "--ask" in argv:
        state, e, ch = ask(argv[argv.index("--ask") + 1])
        if state == "hit":
            print(e["answer"]); print("evidence: " + ", ".join(e["evidence"])); return 0
        print(f"conclusions: {state}" + (f"; changed since: {', '.join(ch)}" if ch else "")); return 1
    if "--put" in argv:
        i = argv.index("--evidence")
        ev = [a for a in argv[i + 1:] if not a.startswith("--")]
        put(argv[argv.index("--put") + 1], argv[argv.index("--answer") + 1], ev)
        print("conclusions: recorded"); return 0
    if "--check" in argv:
        errs, stale = check()
        for x in errs:
            print(f"conclusions: {x}")
        for q in stale:
            print(f"conclusions: stale (re-derive on next ask): {q}")
        print(f"conclusions {'ok' if not errs else 'FAILED'}")
        return 1 if errs else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
