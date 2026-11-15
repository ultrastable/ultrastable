"""Append-only JSONL ledgers that survive the launch pass (QNFO-PORT-1 shared helper).

A launch pass starts from main and commits its evidence to branch `loop-evidence` (foundation/launch.py), so a ledger written by one pass is not
in the next pass's checkout. `rows()` reads the ledger from that branch and from this working copy and de-duplicates identical lines, the same
rule foundation/queue.executor_rows applies to the executor log. Event-sourced loops (contracts, metric loop, throughput, fold) replay these
rows to get their state, so no loop keeps a mutable state file that a fresh checkout would lose.
"""
from __future__ import annotations
import json, subprocess
from pathlib import Path

BRANCH = "origin/loop-evidence"


def _branch_text(root: Path, rel: str) -> str:
    try:
        r = subprocess.run(["git", "-C", str(root), "show", f"{BRANCH}:{rel}"], capture_output=True, text=True, encoding="utf-8", timeout=30)
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout if r.returncode == 0 else ""


def rows(root, rel: str, branch: bool = True) -> list[dict]:
    """Every row of ledger `rel`, oldest first: the evidence branch's rows, then this copy's rows that the branch does not already hold."""
    root, out, seen = Path(root), [], set()
    texts = [_branch_text(root, rel)] if branch else []
    p = root / rel
    if p.is_file():
        texts.append(p.read_text(encoding="utf-8"))
    for t in texts:
        for line in t.splitlines():
            if not line.strip() or line in seen:
                continue
            seen.add(line)
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return sorted(out, key=lambda r: r.get("at") or "")


def append(root, rel: str, recs: list[dict]) -> None:
    if not recs:
        return
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, sort_keys=True) + "\n")
