# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""SAMPLE-AUDIT-1 (Beer's System 3*): audit a risk-weighted sample of merged PRs instead of re-verifying all of them.

  python3 -m foundation sampleaudit [--run [--apply]]   pick today's sample from PRs merged in the last day; --apply files Q-AUDIT items
  python3 -m foundation sampleaudit --probe N           pass when Q-AUDIT-N carries a verdict (clean or defect)
  python3 -m foundation sampleaudit --rate              print the sampling rate in effect and why

Every PR that touches a protected path (scripts/protected_paths.py) is audited. Others are sampled at a base rate that rises after
an audit finds a defect and falls back after a clean run, between the floor and ceiling in doctrine/sample-audit.json. The draw is
seeded by PR number and date, so a rerun picks the same PRs. Each pick becomes a queue item for the executor: a reviewer with a clean
context (not the author) reads the merged diff, and writes `"verdict": "clean"` or `"verdict": "defect"` with a reason into the item.
A defect also gets its own fix item. Mechanical checks still run on every PR; this sample is the extra judgement on top of them.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import datetime as dt, hashlib, json, sys
from pathlib import Path

from . import mergeaudit

REPO = Path(__file__).resolve().parents[1]
CONFIG = "doctrine/sample-audit.json"
ISSUES = "docs/issues"


def config(root=REPO) -> dict:
    return json.loads((root / CONFIG).read_text())


def verdicts(root=REPO) -> list[tuple[str, str]]:
    """(merged_at, verdict) for audited items, oldest first."""
    out = []
    for f in sorted((root / ISSUES).glob("Q-AUDIT-*.json")):
        d = json.loads(f.read_text())
        if d.get("verdict") in ("clean", "defect"):
            out.append((d.get("merged_at", ""), d["verdict"]))
    return sorted(out)


def open_items(root=REPO) -> int:
    return sum(1 for f in (root / ISSUES).glob("Q-AUDIT-*.json") if json.loads(f.read_text()).get("verdict") not in ("clean", "defect"))


def rate(root=REPO) -> tuple[float, str]:
    c = config(root)
    recent = [v for _, v in verdicts(root)][-c["window"]:]
    defects = recent.count("defect")
    r = min(c["ceiling"], max(c["floor"], c["base"] * (c["step_up"] ** defects)))
    return r, f"{defects} defect(s) in the last {len(recent)} verdict(s)"


def protected(paths: list[str], root=REPO) -> bool:
    sys.path.insert(0, str(root / "scripts"))
    from protected_paths import PROTECTED  # type: ignore  # the same list the protected-path gate reads
    return any(p.startswith(PROTECTED) or p.startswith("seed/autonomy/") or p.startswith(".github/") for p in paths)


def draw(n: int, day: str) -> float:
    return int(hashlib.sha256(f"{n}:{day}".encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def files(n: int, run=mergeaudit.gh) -> list[str]:
    code, o = run("api", f"repos/{mergeaudit.SLUG}/pulls/{n}/files?per_page=100", "--jq", "[.[].filename]")
    if code:
        raise RuntimeError("pr files unreadable: " + o[:120])
    return json.loads(o or "[]")


def pick(prs: list[dict], r: float, day: str, filesof) -> list[dict]:
    out = []
    for p in prs:
        fs = filesof(p["n"])
        why = "protected path" if protected(fs) else ("sampled" if draw(p["n"], day) < r else None)
        if why:
            out.append({**p, "why": why, "files": len(fs)})
    return out


def item(p: dict) -> dict:
    n = p["n"]
    body = (f"**Owner:** staff\n**Trigger:** every lane pass\n**Done check:** cmd:python3 -m foundation sampleaudit --probe {n}\n**Closing probe:** python3 -m foundation sampleaudit --probe {n}\n"
            f"**Prediction:** spec_quality >= 0 within 72 h\n**Out of scope:** re-auditing other pull requests; fixing a defect inside this item (a defect gets its own fix item)\n**Status:** open\n\n"
            f"SAMPLE-AUDIT-1: PR #{n} ({p['title']}) merged at {p['merged_at']} was picked for audit ({p['why']}).\n\n"
            f"Read the merged diff with a clean context; the reviewer is not the author. Write `\"verdict\": \"clean\"` or `\"verdict\": \"defect\"` "
            f"and a `\"reason\"` into this file. A defect also gets its own fix item.")
    return {"id": f"Q-AUDIT-{n}", "title": f"Q-AUDIT-{n}: audit merged PR #{n}", "body": body, "merged_at": p["merged_at"],
            "labels": ["role:staff", "audit"], "milestone": "Now", "workstream": "Reliability"}


def scan(root=REPO, apply=False, run=mergeaudit.gh, now=None) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    r, _ = rate(root)
    picked = pick(mergeaudit.merged(run, now, window_h=24), r, now.date().isoformat(), lambda n: files(n, run))
    picked = [p for p in picked if not (root / ISSUES / f"Q-AUDIT-{p['n']}.json").exists()]
    c = config(root)
    room = max(0, min(c["max_per_day"], c["max_open"] - open_items(root)))
    picked = sorted(picked, key=lambda p: p["why"] != "protected path")[:room]  # a backlog the reviewer cannot clear gets no new work
    rows = []
    for p in picked:
        f = root / ISSUES / f"Q-AUDIT-{p['n']}.json"
        new = not f.exists()
        if apply and new:
            f.write_text(json.dumps(item(p), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        rows.append({"pr": p["n"], "why": p["why"], "filed": bool(apply and new)})
    return rows


def probe(n: int, root=REPO) -> bool:
    f = root / ISSUES / f"Q-AUDIT-{n}.json"
    return f.exists() and json.loads(f.read_text()).get("verdict") in ("clean", "defect")


def main(argv) -> int:
    if argv[:1] == ["--probe"]:
        ok = probe(int(argv[1])); print("audited" if ok else "no verdict yet"); return 0 if ok else 1
    if argv[:1] == ["--rate"]:
        r, why = rate(); print(f"sampleaudit rate {r:.2f}: {why}"); return 0
    print(json.dumps(scan(apply="--apply" in argv), indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
