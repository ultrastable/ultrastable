"""PINS-1 ratchet (owner, 2026-11-12): nothing the roadmap says may be unlinked from code.

scripts/build_site_roadmap.py (SITE-PINS-1) ties every site status pin to an issue and to code paths that exist. This module covers the rest of the
roadmap: every open issue in docs/issues must carry a `Done check` that is a probe the system can run (`file:` or `grep:`), so it can leave the
roadmap by itself when the code exists. Issues whose check is still prose are a shrink-only baseline (doctrine/pins-baseline.json): a new one fails
the build, and one that gains a probe or closes must be removed from the baseline. Drain it by writing probes, never by growing it.

  python3 -m foundation pins --check    the ratchet holds
  python3 -m foundation pins --report   open issues without a runnable probe, as JSON
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ISSUES, BASELINE = "docs/issues", "doctrine/pins-baseline.json"


def unprobed(root=REPO) -> list[dict]:
    out = []
    for f in sorted((Path(root) / ISSUES).glob("*.json")):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8")); body = d.get("body", "")
        g = lambda k: (re.search(rf"\*\*{k}:\*\*\s*(.+)", body) or [None, ""])[1].strip()
        if g("Status").lower() in ("done", "closed", "superseded"):
            continue
        done = g("Done check")
        if not done.startswith(("file:", "grep:")) and not (f.stem.startswith("Q-CRIT-") and done.startswith(("cmd:python3 -m foundation criticality ", "cmd:gh api "))):  # CRITICALITY-1: the queue lane runs these cmd probes itself
            out.append({"id": f.stem, "owner": g("Owner"), "done_check": done})
    return out


def check(root=REPO) -> list[str]:
    root = Path(root)
    bp = root / BASELINE
    base = set(json.loads(bp.read_text(encoding="utf-8"))["unprobed"]) if bp.is_file() else set()
    ids = {u["id"] for u in unprobed(root)}
    return ([f"issue {i} is on the roadmap with no probe the system can run (file: or grep:); write the probe, do not add it to {BASELINE}" for i in sorted(ids - base)]
            + [f"{i} now has a probe or is closed: remove it from {BASELINE} (shrink-only)" for i in sorted(base - ids)])


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--report" in a:
        print(json.dumps(unprobed(), indent=1)); return 0
    p = check()
    print("pins ok" if not p else "\n".join(p))
    return 1 if p else 0


if __name__ == "__main__":
    sys.exit(main())
