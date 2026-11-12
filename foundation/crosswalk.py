"""TERMS-CROSSWALK-1: one canonical term per idea (owner directive 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation crosswalk --check    every entry maps to an existing glossary term; instruction files carry the marker and none uses an avoided word
  python3 -m foundation crosswalk --stamp    append the marker line to instruction files that lack it
Data: doctrine/crosswalk.json. Glossary: doctrine/glossary.json.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/crosswalk.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _files(root: Path, pats):
    return [p for g in pats for p in sorted(root.glob(g)) if p.is_file()]


def avoided_hits(text: str, avoided) -> list[str]:
    """Words used as synonyms. A line that holds the marker (the crosswalk itself) is exempt."""
    hits = []
    for ln in text.splitlines():
        if "TERMS-CROSSWALK" in ln:
            continue
        for w in avoided:
            if re.search(r"(?<![\w-])" + re.escape(w) + r"(?![\w-])", ln, re.I):
                hits.append(w)
    return hits


def check(root=REPO) -> list[str]:
    root, d, bad = Path(root), load(root), []
    ids = {t["id"] for t in json.loads((root / "doctrine/glossary.json").read_text(encoding="utf-8"))["terms"]}
    for e in d["entries"]:
        if e["canonical"] not in ids:
            bad.append(f"{e['say']}: canonical term {e['canonical']} is not in the glossary")
        for k in ("means", "not"):
            if not e.get(k):
                bad.append(f"{e['say']}: missing {k}")
    for p in _files(root, d["instruction_files"]):
        t, rel = p.read_text(encoding="utf-8"), p.relative_to(root).as_posix()
        if d["marker"] not in t:
            bad.append(f"{rel}: lacks {d['marker']}")
        for w in sorted(set(avoided_hits(t, d["avoided"]))):
            bad.append(f"{rel}: uses avoided word '{w}'")
    return bad


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
        print("stamped", len(stamp()))
        return 0
    bad = check()
    print("crosswalk ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
