# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""HUMAN-VOICE-1 (Rowan, 2026-11-23): "Make all writing sound human. Everything."

Python twin of seed/worker/src/humanvoice.js, reading doctrine/human-voice.json. `lint(text)` returns plain reasons a text reads as AI.
`--check` scans the public surfaces in the doctrine file and fails when any file has more findings than its shrink-only baseline
(ops/humanvoice-baseline.json), so new AI-sounding text cannot land and old text can only get better. `--report [--apply]` prints the
metric `human_voice_share` (files with no findings / files scanned) and writes it to ops/humanvoice.json for the rules probe and dashboard.
`--baseline` rewrites the baseline, refusing to raise any count.
"""
from __future__ import annotations
import glob, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = ROOT / "doctrine" / "human-voice.json"
BASE = ROOT / "ops" / "humanvoice-baseline.json"
OUT = ROOT / "ops" / "humanvoice.json"

def cfg() -> dict:
    return json.loads(DOC.read_text())

def _phrase_re(phrases):
    return re.compile(r"\b(" + "|".join(re.escape(p).replace("'", "['’]") for p in phrases) + r")\b", re.I)

NOT_JUST = re.compile(r"\b(it'?s |is |are |was )?not (just|only|merely) [^.!?\n]{1,60}?,? (but|it'?s)\b", re.I)
OPENER = re.compile(r"^\s*(great question|in today'?s|imagine a|ever wondered|picture this|let'?s dive|here'?s the thing)", re.I)
CLOSER = re.compile(r"(^|\n|[.!?]\s+)(in (conclusion|summary|short)|overall|ultimately|to sum up)[,:]", re.I)
TRIPLET = re.compile(r"\b[a-z][\w-]*, [a-z][\w-]*,? and [a-z][\w-]*\b", re.I)

def lint(text: str, c: dict | None = None) -> list[str]:
    c = c or cfg()
    t = re.sub(r"```.*?```", "", str(text or ""), flags=re.S)
    t = re.sub(r"`[^`]*`", "", t)
    t = re.sub(r"https?://\S+", "", t)
    out = []
    hits = sorted({m.group(0).lower() for m in _phrase_re(c["phrases"]).finditer(t)})
    if hits: out.append("stock AI phrasing: " + ", ".join(hits[:5]))
    if NOT_JUST.search(t): out.append("'not just X but Y'")
    if OPENER.search(t): out.append("stock opener")
    if CLOSER.search(t): out.append("summary closer")
    if t.count("—") > c.get("max_em_dashes", 1): out.append("em-dash chain")
    if len(TRIPLET.findall(t)) > c.get("max_triplets", 1): out.append("tidy three-item lists")
    return out

def score(text: str, c: dict | None = None) -> int:
    """Findings count for a whole file, judged paragraph by paragraph so a long page is not failed for one triplet per section."""
    c = c or cfg()
    return sum(len(lint(p, c)) for p in re.split(r"\n\s*\n", str(text or "")) if p.strip())

def files(c: dict) -> list[str]:
    seen = set()
    for g in c["surfaces"]:
        for f in glob.glob(str(ROOT / g), recursive=True):
            seen.add(str(Path(f).relative_to(ROOT)))
    return sorted(seen)

def scan(c: dict | None = None) -> dict[str, int]:
    c = c or cfg()
    return {f: score((ROOT / f).read_text(errors="replace"), c) for f in files(c)}

def main(argv: list[str]) -> int:
    c = cfg()
    if "--lint" in argv:
        text = sys.stdin.read()
        r = lint(text, c)
        print("\n".join(r) or "ok")
        return 1 if r else 0
    s = scan(c)
    base = json.loads(BASE.read_text()) if BASE.exists() else {}
    if "--baseline" in argv:
        new = {f: n for f, n in s.items() if n}
        worse = [f for f, n in new.items() if f in base and n > base[f]]
        if worse and base:
            print("refused: baseline may only shrink: " + ", ".join(worse)); return 1
        BASE.write_text(json.dumps(new, indent=1, sort_keys=True) + "\n"); print(f"baseline: {len(new)} files"); return 0
    if "--report" in argv:
        share = round(sum(1 for n in s.values() if n == 0) / max(1, len(s)), 3)
        rep = {"metric": "human_voice_share", "value": share, "files": len(s), "findings": sum(s.values())}
        print(json.dumps(rep))
        if "--apply" in argv: OUT.write_text(json.dumps(rep, indent=1) + "\n")
        return 0
    bad = [f"{f}: {n} findings (baseline {base.get(f, 0)}): " + "; ".join(lint((ROOT / f).read_text(errors='replace'), c)[:3])
           for f, n in s.items() if n > base.get(f, 0)]
    for b in bad: print("HUMAN-VOICE-1 " + b)
    if not bad: print(f"humanvoice: ok ({len(s)} files, {sum(s.values())} baseline findings left to drain)")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
