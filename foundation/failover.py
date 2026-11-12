"""Host failover without coordination. Every loop host writes evidence naming itself (ops/loop-evidence/*.jsonl). A fallback host runs
`launch --failover`: it reads the newest evidence from any host and runs the loop only when nobody has written for its own
`takeover_after_hours` (instances/ultrastable/loops.json). Staggered thresholds make the chain: the Cloudflare worker (0, it always runs),
the cloud-hosted Claude routine (3 h), then GitHub Actions (12 h, checked by a daily gate). Every host is server-side (doctrine/server-side.json);
GitHub Actions is the credential-free one, because its built-in token is minted by GitHub for each run and by no person. No host needs to know
the others are down."""
from __future__ import annotations
import datetime as dt, json
from pathlib import Path

from . import launch


def sync_evidence(root) -> str:
    """Pull the shared evidence branch so every host sees what the others wrote. A failure is reported, not hidden; deciding goes on
    with the evidence already in the checkout (which errs toward running the loop)."""
    code, out = launch._run(["git", "fetch", "origin", "loop-evidence"], root, timeout=60)
    if code:
        return f"could not fetch loop-evidence ({out[-120:]}); using the evidence in the checkout"
    code, out = launch._run(["git", "checkout", "FETCH_HEAD", "--", launch.EVIDENCE], root)
    return "evidence synced" if code == 0 else f"could not read fetched evidence ({out[-120:]})"


def last_evidence(root, hosts_only=None):
    newest = {}
    for f in sorted((Path(root) / launch.EVIDENCE).glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            h = r.get("host", "unspecified").removeprefix("failover:")
            newest[h] = max(newest.get(h, ""), r["at"])
    return newest


def decide(root, host, now=None, sync=True) -> dict:
    """{'run': bool, 'reason': str, 'silent_hours': float|None}"""
    reg = launch.registry(root)
    note = sync_evidence(root) if sync else "sync skipped"
    mine = next((h for h in reg["hosts"] if h["id"] == host), None)
    if mine is None:
        return {"run": True, "reason": f"host {host} not in the registry; running (never silent)", "silent_hours": None}
    now = now or dt.datetime.now(dt.timezone.utc)
    seen = last_evidence(root)
    if not seen:
        return {"run": True, "note": note, "reason": "no evidence from any host", "silent_hours": None}
    newest = max(dt.datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc) for v in seen.values())
    silent = (now - newest).total_seconds() / 3600
    need = mine["takeover_after_hours"]
    if silent >= need:
        return {"run": True, "note": note, "reason": f"no host wrote evidence for {silent:.1f}h (takeover after {need}h)", "silent_hours": round(silent, 2)}
    return {"run": False, "note": note, "reason": f"a host wrote evidence {silent:.1f}h ago; takeover after {need}h", "silent_hours": round(silent, 2)}
