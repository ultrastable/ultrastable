#!/usr/bin/env python3
"""BIZ-3 probe: every business/**/*.md is linked from business/README.md or its folder README, and short forms point to their source."""
import re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "business"
text = {p: p.read_text(encoding="utf-8") for p in root.rglob("*.md")}
fail = []
for p in text:
    if p.name == "README.md":
        continue
    indexes = [root / "README.md", p.parent / "README.md"]
    if not any(i in text and (p.name in text[i] or str(p.relative_to(root)) in text[i]) for i in indexes):
        fail.append(f"{p.relative_to(root)}: not indexed in business/README.md or its folder README")
short = {"marketing/strategy.md": "investor/marketing-strategy.md", "google-startups/deck-outline.md": "investor/pitch-deck-outline.md"}
for f, src in short.items():
    if src not in text[root / f]:
        fail.append(f"{f}: does not link its source of record {src}")
for p, t in text.items():
    if re.search(r"no licen[cs]e", t, re.I):
        fail.append(f"{p.relative_to(root)}: says QNFO has no licence (it carries the QNFO User License Agreement)")
print("\n".join(fail) if fail else "business index ok")
sys.exit(1 if fail else 0)
