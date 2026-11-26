#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""HUMAN-VOICE-1 (Rowan, 2026-11-23): writing for people reads like a person wrote it. A small, deterministic lint any loop calls before it
publishes (posts, mails, pages, papers): stock openers and closers, buzzwords, and lists of three abstract nouns are refused.

  python3 scripts/humanvoice.py --check          lint the files named in doctrine/humanvoice.json `surfaces` (default: none; the module is tested)
  python3 scripts/humanvoice.py FILE ...         lint those files
  from humanvoice import lint; lint(text) -> list of problems
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

OPENERS = [r"^\s*(in today's (fast-paced|digital) world|in the ever-evolving|great question|certainly!|absolutely!)"]
CLOSERS = [r"(in conclusion,|in summary,|to sum up,|hope this helps|let me know if you have any questions)\s*"]
BUZZ = ["synergy", "leverage", "game-changer", "game changer", "cutting-edge", "best-in-class", "seamless experience", "unlock the power",
        "revolutionize", "paradigm shift", "next-generation", "world-class", "robust and scalable", "delve"]
# NO-PITCH-1 (Rowan, 2026-11-26: "All product, no pitch. No hyperbole anywhere."): words that sell instead of describe.
HYPE = ["revolutionary", "groundbreaking", "transformative", "unprecedented", "limitless", "infinitely", "effortless",
        "magical", "supercharge", "the future of", "any idea into", "dream it", "unstoppable", "the ultimate",
        "change the world", "10x", "state-of-the-art", "industry-leading", "blazing fast", "zero effort"]
TRIPLET = re.compile(r"\b(\w+(?:ity|ness|tion|ment|ency|ancy|ance|ence|ism)),\s+(\w+(?:ity|ness|tion|ment|ency|ancy|ance|ence|ism)),?\s+and\s+(\w+(?:ity|ness|tion|ment|ency|ancy|ance|ence|ism))\b", re.I)


def lint(text: str) -> list[str]:
    bad = []
    low = text.lower()
    for p in OPENERS + CLOSERS:
        if re.search(p, low, re.M):
            bad.append(f"stock phrase: {re.search(p, low, re.M).group(0).strip()[:40]}")
    for w in BUZZ:
        if w in low:
            bad.append(f"buzzword: {w}")
    for w in HYPE:
        if re.search(r"(^|[^a-z])" + re.escape(w) + r"([^a-z]|$)", low):
            bad.append(f"hyperbole: {w}")
    for m in TRIPLET.finditer(text):
        bad.append(f"abstract triplet: {m.group(0)}")
    return bad


def main(argv: list[str]) -> int:
    files = [a for a in argv if not a.startswith("--")]
    if "--check" in argv:
        cfg = Path(__file__).resolve().parent.parent / "doctrine" / "humanvoice.json"
        files += json.loads(cfg.read_text()).get("surfaces", []) if cfg.exists() else []
        if not lint("In conclusion, we leverage synergy."):
            print("humanvoice: self-test failed: the lint passed a stock closer")
            return 1
    n = 0
    for f in files:
        p = Path(f)
        if p.exists():
            for b in lint(p.read_text(encoding="utf-8")):
                print(f"{f}: {b}")
                n += 1
    print(f"humanvoice: {'ok' if not n else str(n) + ' problem(s)'}")
    return 1 if n else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
