# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISPOSITION-1 (kernel 9.0.0 §3 F1, F2, R3): every executor run ends in exactly one of five dispositions, and `done` names an independent verifier.

  python3 -m foundation disposition --check     every executor row maps to a known result; every `done` row carries its verifier
  python3 -m foundation disposition --summary   counts per disposition over ops/executor-log.jsonl and the evidence branch (JSON)

done              the change merged on main: the lane merged it after CI passed, so the merge commit is the independent check (F1)
flagged           the item contradicts itself or cannot be done as specified; nothing was applied (F2, foundation/executor.Flagged)
blocked_by_gate   a step only the owner can take, such as a credential only the owner can mint (G1)
deferred_budget   out of time or budget for this run; the item is retried
failed            the run or the pull request failed, with the reason in `detail` (R3)

Results that are not an end state (picked, pr-opened, dry-run, idle ...) map to None. A result this table does not know fails the check, so a new
executor outcome cannot appear without a disposition. The same five kinds are the CHECK constraint of the D1 table in
seed/worker/migrations/0035_disposition.sql, where `done` without a verifier is refused by the database.
"""
from __future__ import annotations
import collections, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SINCE = "2026-11-27"  # the rule's adoption: earlier rows are counted in --summary, never rewritten (ledgers are append-only)
KINDS = ("done", "flagged", "blocked_by_gate", "deferred_budget", "failed")
MAP = {
    "pr-merged": "done", "verified-no-change": "done",
    "flagged": "flagged",
    "no-model-credential": "blocked_by_gate",
    "stalled": "deferred_budget", "retry-public": "deferred_budget", "no-route": "deferred_budget",
    "failed": "failed", "pr-closed": "failed",
    "pr-opened": None, "pr-repaired": None, "picked": None, "dry-run": None, "idle": None,
}


def verifier(row: dict) -> str | None:
    """The independent evidence for a `done` row: the merge commit the lane made after CI, or the probe that verified no change was needed."""
    return row.get("merge_commit") or row.get("verify") or row.get("probe") or None


def classify(row: dict) -> tuple[str | None, str | None]:
    res = row.get("result")
    if res not in MAP:
        raise KeyError(res)
    kind = MAP[res]
    if kind == "failed" and row.get("out_of_time"):  # EXEC-WATCHDOG-2: ended for want of time, not for a defect
        kind = "deferred_budget"
    return kind, (verifier(row) if kind == "done" else None)


def rows(root=REPO) -> list[dict]:
    from . import queue as qmod
    return qmod.executor_rows(root)


def check(root=REPO, rs=None) -> list[str]:
    bad = []
    for r in (rows(root) if rs is None else rs):
        try:
            kind, ver = classify(r)
        except KeyError:
            bad.append(f"executor result {r.get('result')!r} has no disposition (add it to foundation/disposition.MAP)")
            continue
        if kind == "done" and not ver and str(r.get("at", "")) >= SINCE:
            bad.append(f"done without a verifier: issue {r.get('issue')} pr {r.get('pr')} at {r.get('at')} (F1: done needs an independent check)")
    return bad


def summary(root=REPO, rs=None) -> dict:
    c = collections.Counter()
    for r in (rows(root) if rs is None else rs):
        try:
            kind, ver = classify(r)
        except KeyError:
            c["unknown"] += 1
            continue
        c[kind or "in_progress"] += 1
        if kind == "done" and not ver:
            c["done_unverified"] += 1
    return {k: c.get(k, 0) for k in (*KINDS, "in_progress", "unknown", "done_unverified")}


def main(argv) -> int:
    if "--summary" in argv:
        print(json.dumps(summary(), indent=1))
        return 0
    bad = check()
    for b in bad:
        print("disposition:", b)
    if not bad:
        print("disposition ok: every executor row has one of " + ", ".join(KINDS) + " (or is in progress), and every done row names its verifier (DISPOSITION-1)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
