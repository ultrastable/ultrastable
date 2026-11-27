# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""ROUTE-CANARY-1 (ZHC-R14, #2679): every coder route answers a canary with a known schema before the executor trusts it.

  python3 -m foundation routehealth --run [--apply]   ask each routed author a tiny JSON question, append one row per rung to ops/route-health.jsonl
  python3 -m foundation routehealth --probe [--ref origin/loop-evidence]  exit 0 when a row from the last 24 h shows a passing canary for a coder route

GitHub Models answered every request with a 200 and a non-JSON body for eight days and the executor kept choosing it. A canary catches that kind of
silent failure: the reply must parse as {"ok": true, "sum": 5}. A rung whose canary failed is demoted for DEMOTE_H hours: agent_ladder.rungs() reads
demoted() and skips it while another rung is healthy. Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import json, sys
from datetime import datetime, timedelta, timezone

from . import agents
from .agents import REPO

LEDGER = "ops/route-health.jsonl"
DEMOTE_H = 6
PROMPT = 'Reply with only this JSON object and nothing else: {"ok": true, "sum": <the sum of 2 and 3 as a number>}'


def judge(text: str) -> tuple[bool, str]:
    s, e = (text or "").find("{"), (text or "").rfind("}")
    if s < 0 or e < s:
        return False, "no JSON object in the reply"
    try:
        j = json.loads(text[s:e + 1])
    except ValueError as ex:
        return False, f"invalid JSON: {ex}"[:120]
    return (j.get("ok") is True and j.get("sum") == 5), ("ok" if j.get("ok") is True and j.get("sum") == 5 else f"wrong answer {j}"[:120])


def _rows(root=REPO, ref=None) -> list[dict]:
    from pathlib import Path
    root = Path(root)
    """The local ledger, or with ref (origin/loop-evidence, where the executor job commits it) the copy on that branch."""
    if ref:
        import subprocess
        r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{LEDGER}"], capture_output=True, text=True)
        text = r.stdout if r.returncode == 0 else ""
    else:
        p = root / LEDGER; text = p.read_text() if p.exists() else ""
    return [json.loads(l) for l in text.splitlines() if l.strip()]


def demoted(root=REPO, now=None) -> set[str]:
    """Adapter ids whose newest canary inside DEMOTE_H hours failed."""
    now = now or datetime.now(timezone.utc); cut = now - timedelta(hours=DEMOTE_H); last = {}
    for r in _rows(root):
        if datetime.fromisoformat(r["at"].replace("Z", "+00:00")) >= cut:
            last[r["id"]] = r
    return {k for k, r in last.items() if not r["pass"]}


def run(root=REPO, env=None, send=None, apply=False, now=None) -> list[dict]:
    from pathlib import Path
    root, now, out = Path(root), now or datetime.now(timezone.utc), []
    for a in agents.route_authors(env, root):
        try:
            text = send(a, PROMPT, env) if send else agents.invoke(a, PROMPT, env)
            ok, why = judge(text)
        except Exception as ex:  # recorded as a failed canary; the next rung is still asked
            ok, why = False, f"{type(ex).__name__}: {str(ex)[:100]}"
        out.append({"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "id": a["id"], "route": a.get("route"), "model": a.get("model"), "pass": ok, "why": why})
    if apply and out:
        p = root / LEDGER; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a") as f:
            f.writelines(json.dumps(r) + "\n" for r in out)
    return out


def probe(root=REPO, now=None, ref=None) -> tuple[bool, str]:
    now = now or datetime.now(timezone.utc); cut = now - timedelta(hours=24)
    good = [r for r in _rows(root, ref) if r["pass"] and datetime.fromisoformat(r["at"].replace("Z", "+00:00")) >= cut]
    return (bool(good), f"{len(good)} passing canaries in 24 h" + (f", newest {good[-1]['id']}" if good else ""))


def main(argv) -> int:
    if "--run" in argv:
        rows = run(apply="--apply" in argv)
        print(json.dumps(rows, indent=1))
        return 0 if any(r["pass"] for r in rows) else 1
    if "--probe" in argv:
        ref = argv[argv.index("--ref") + 1] if "--ref" in argv else None
        ok, why = probe(ref=ref); print(f"routehealth: {why}"); return 0 if ok else 1
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
