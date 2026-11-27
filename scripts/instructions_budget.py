#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""INSTRUCTIONS-BUDGET-1: agent instruction files stay small enough to be loaded whole.

Codex stops reading AGENTS.md files once the root-to-leaf chain reaches 32 KiB and does it silently, so a rule past that point does not exist for it
(research 2026-11-27, doctrine/instructions-budget.json). Limits per file kind come from the data file. A file already over its limit is on a
shrink-only baseline: it may not grow, and every byte it loses lowers its baseline (`--ratchet`). A new file over its limit fails. A dead relative link fails.

  python3 scripts/instructions_budget.py --check      exit 1 on growth, a new oversize file or a dead link; prints each remediation
  python3 scripts/instructions_budget.py --zero       exit 1 while the baseline lists a file (the done check of Q-REPO-agents-map)
  python3 scripts/instructions_budget.py --ratchet    lower every baseline entry to the file's current size (never raises one)
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CFG = "doctrine/instructions-budget.json"
LINK = re.compile(r"\]\((?!https?://|#|mailto:)([^)\s#]+)")


def kind(rel: str) -> str:
    n = Path(rel).name
    if n == "SKILL.md":
        return "skill_lines"
    return "root_bytes" if rel in ("AGENTS.md", "CLAUDE.md") else "file_bytes"


def files(root: Path):
    out = []
    for pat in ("AGENTS.md", "CLAUDE.md", "agents/AGENTS.md", "agents/PROJECT-INSTRUCTIONS.md", "seed/CLAUDE.md", "seed/agents/AGENTS.md", "**/SKILL.md"):
        out += [p for p in root.glob(pat) if p.is_file() and "node_modules" not in p.parts]
    return sorted({p.relative_to(root).as_posix() for p in out})


def measure(root: Path, rel: str):
    t = (root / rel).read_text(encoding="utf-8", errors="replace")
    return (len(t.splitlines()) if kind(rel) == "skill_lines" else len(t.encode("utf-8"))), t


def check(root=ROOT, ratchet=False):
    cfg = json.loads((root / CFG).read_text(encoding="utf-8"))
    base, errs, notes = dict(cfg.get("baseline", {})), [], []
    for rel in files(root):
        k = kind(rel); size, text = measure(root, rel); limit = cfg["limits"][k]
        if size > limit:
            cap = base.get(rel)
            if cap is None:
                errs.append(f"{rel}: {size} > {limit} ({k}) and not on the baseline. Move rules into a lint, schema or skill and keep this file a map of about 100 lines.")
            elif size > cap:
                errs.append(f"{rel}: grew from {cap} to {size} ({k}); the baseline only shrinks. Put the new rule in code (doctrine/*.json plus a check) and point to it.")
            elif size < cap:
                notes.append(f"{rel}: {size} < baseline {cap}; run --ratchet"); base[rel] = size if ratchet else cap
        elif rel in base:
            notes.append(f"{rel}: under its limit; drop it from the baseline"); base.pop(rel) if ratchet else None
        for m in LINK.findall(text):
            if not (root / Path(rel).parent / m).exists() and not (root / m).exists():
                errs.append(f"{rel}: dead link {m}")
    if ratchet:
        cfg["baseline"] = dict(sorted(base.items())); (root / CFG).write_text(json.dumps(cfg, indent=1) + "\n", encoding="utf-8")
    return errs, notes


def main(argv):
    if "--zero" in argv:  # done check of the map refactor: the baseline is empty
        left = json.loads((ROOT / CFG).read_text(encoding="utf-8")).get("baseline", {})
        print("baseline empty" if not left else "baseline still lists: " + ", ".join(left)); return 1 if left else 0
    errs, notes = check(ratchet="--ratchet" in argv)
    for n in notes:
        print("note:", n)
    print("\n".join(errs) if errs else "instructions budget ok")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
