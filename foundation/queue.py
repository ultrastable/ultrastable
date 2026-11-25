"""The machine-read queue of residual work (CLOSED-LOOP-AXIOM). No thread stays alive to hold an item: every residual of a finished thread is an
`OL-*` item in docs/issues/ with an owner, a trigger and a closing probe, worked by the scheduled executor and merge lane until the probe passes.

  python3 -m foundation queue --check     every item complete; every thread residual in doctrine/thread-residuals.json has an item
  python3 -m foundation queue --run [--apply]   evaluate each open item's probe on every executor run and close the ones that pass (closing-probe contracts:
                                                reopen on relapse, hold after a reopen; foundation/contracts.py)

Probe kinds: file:<path>, grep:<path>::<regex>, cmd:<command> (allow-listed prefixes only, 60 s, argv without a shell).
"""
from __future__ import annotations
import json, re, shlex, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
QUEUE_GLOB = "docs/issues/"
CMD_ALLOWED = ("gh ", "python3 scripts/", "python3 -m foundation ", "python3 tools/", "git ")
FIELD = lambda body, name: (re.search(rf"^\*\*{name}:\*\*\s*(.+)$", body, re.M) or [None, ""])[1].strip()


def items(root=REPO) -> list[dict]:
    out = []
    for p in sorted(f for pat in ("OL-*.json", "Q-*.json", "PORT-BRANCH-*.json") for f in (Path(root) / "docs/issues").glob(pat)):
        j = json.loads(p.read_text(encoding="utf-8")); b = j.get("body", "")
        out.append({"id": j["id"], "path": p, "json": j, "owner": FIELD(b, "Owner"), "trigger": FIELD(b, "Trigger"), "probe": FIELD(b, "Done check"),
                    "status": FIELD(b, "Status"), "residual": FIELD(b, "Residual")})
    return out


def executor_rows(root=REPO) -> list[dict]:
    """Every executor provenance row, oldest first: the shared evidence branch (a run's checkout holds only its own rows, so parking would never see earlier failures) plus
    this working copy's rows, de-duplicated. A missing branch or a git failure leaves the local rows, never an error."""
    root, texts = Path(root), []
    for ref in ("origin/loop-evidence",):
        r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:ops/executor-log.jsonl"], capture_output=True, text=True, encoding="utf-8")
        if r.returncode:
            subprocess.run(["git", "-C", str(root), "fetch", "-q", "--depth=1", "origin", "loop-evidence:refs/remotes/origin/loop-evidence"], capture_output=True, text=True, timeout=60)
            r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:ops/executor-log.jsonl"], capture_output=True, text=True, encoding="utf-8")
        if r.returncode == 0:
            texts.append(r.stdout)
    log = root / "ops/executor-log.jsonl"
    if log.exists():
        texts.append(log.read_text(encoding="utf-8"))
    rows, remote = [], set()
    for n, t in enumerate(texts):            # the evidence branch first; a local row is added unless the branch already holds that exact line
        for line in t.splitlines():
            if n == 0 and len(texts) > 1:
                remote.add(line)
            elif n > 0 and line in remote:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return sorted(rows, key=lambda r: r.get("at") or "")


def protected_probe(probe: str) -> bool:
    m = re.match(r"(?:file|grep):(\S+?)(?:::|$)", probe or "")
    return bool(m and m.group(1).startswith((".github/", "autonomy/")))


def fail_counts(root=REPO) -> dict[str, int]:
    """Consecutive failed executor rows per item (reset by any other result)."""
    fails: dict[str, int] = {}
    for r in executor_rows(root):
        if r.get("issue") is not None:
            k = str(r["issue"]); fails[k] = fails.get(k, 0) + 1 if r.get("result") == "failed" else 0
    return fails


def takeable(root=REPO, gated=True) -> list[dict]:
    """QUEUE-1: open queue items in the shape the executor's pick() expects. Owner-held items (identity-bound, ROWAN) are not the executor's.
    An item whose last three executor log rows all failed is parked until a row of another result appears, so a bad item cannot starve the rest."""
    root = Path(root); fails = fail_counts(root)
    out = []
    try:
        from . import prioritize
        scores = prioritize.score_map(root)
    except Exception:  # the ranker must never block the queue; unscored items fall back to label order
        scores = {}
    for it in items(root):
        j = it["json"]
        if it["status"] != "open" or re.search(r"ROWAN|identity-bound", it["owner"], re.I) or fails.get(str(it["id"]), 0) >= 3:
            continue
        if protected_probe(it["probe"]):  # the executor may not write .github/ or autonomy/, so an item whose done check lives there can only fail (it starved the queue head on 2026-11-12)
            continue
        out.append({"number": it["id"], "title": j.get("title", it["id"]), "body": j.get("body", ""), "labels": [{"name": n} for n in j.get("labels", [])],
                    "updated_at": "1970-01-01T00:00:00Z", **({"score": scores[str(it["id"])]} if str(it["id"]) in scores else {})})
    if not out:  # DISPOSE-1: an empty open queue is when shelved items are retried, least recently attempted first
        from . import dispose
        for d in dispose.revive(root):
            j = d["json"]
            out.append({"number": d["id"], "title": j.get("title", d["id"]), "body": j.get("body", ""), "labels": [{"name": n} for n in j.get("labels", [])],
                        "updated_at": "1970-01-01T00:00:00Z", "revived": True})
    if not gated:  # the executor's reach before the criticality gate: foundation/throughput.py asks whether any doer can take an item at all
        return out
    from . import criticality
    return criticality.gate(out, root)


def close(root, item_id: str, why: str) -> None:
    """Mark an item closed with evidence (check() rejects a closed item without it). Called inside the executor's PR so the merge is the closure."""
    root = Path(root)
    for it in items(root):
        if str(it["id"]) == str(item_id):
            j = it["json"]
            j["body"] = re.sub(r"^(\*\*Disposition:\*\*\s*)shelved\b", r"\1fixed", j["body"].replace("**Status:** open", "**Status:** closed"), flags=re.M) + f"\n\n**Evidence:** {why}\n"
            it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
            return
    raise KeyError(f"queue item {item_id} not found")


def probe(root, spec: str) -> tuple[bool, str]:
    kind, _, rest = spec.partition(":")
    if kind in ("file", "grep"):
        from . import selfhost
        return selfhost.probe(root, spec), spec
    if kind == "cmd":
        if not rest.startswith(CMD_ALLOWED):
            return False, f"command not allow-listed: {rest[:40]}"
        try:
            r = subprocess.run(shlex.split(rest), cwd=root, capture_output=True, text=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, f"{type(e).__name__}: {e}"
        return r.returncode == 0 and bool(r.stdout.strip() or "|" not in rest), (r.stdout or r.stderr).strip()[:160]
    return False, f"unknown probe kind {kind!r}"


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    its = items(root)
    for it in its:
        for f in ("owner", "trigger", "probe", "status"):
            if not it[f]:
                bad.append(f"{it['id']}: lacks {f}")
        # A finished item says closed; done is accepted as the same thing, because the site roadmap and older items use that word and two
        # checks that disagree on vocabulary turned main red (2026-11-12). Either way a finished item needs evidence.
        if it["status"] not in ("open", "closed", "done"):
            bad.append(f"{it['id']}: status {it['status']!r} is not open, closed or done")
        if it["status"] in ("closed", "done") and "**Evidence:**" not in it["json"].get("body", ""):
            bad.append(f"{it['id']}: closed without evidence (silent drop)")
        if it["probe"].startswith("cmd:") and not it["probe"][4:].startswith(CMD_ALLOWED):
            bad.append(f"{it['id']}: probe command is not allow-listed")
    res = root / "doctrine/thread-residuals.json"
    if res.exists():
        have = {i["residual"] for i in its if i["residual"]}
        for r in json.loads(res.read_text(encoding="utf-8"))["residuals"]:
            if r["key"] not in have:
                bad.append(f"thread residual {r['key']} (from {r['thread']}) has no queue entry")
    return bad


def run(root=REPO, apply=False) -> list[dict]:
    """Every open item's probe, through the closing-probe contracts (foundation/contracts.py): an item closes only when its probe passes and,
    after a reopen, only once the passes span the hold; a closed item whose probe fails again is reopened. Rows keep the old shape."""
    from . import contracts
    rows = contracts.tick(root, apply=apply)["rows"]
    out = [{"id": r["id"], "probe": r["probe"], "passed": r["verdict"] == "pass", "evidence": r["evidence"], "action": r["action"]} for r in rows if r["status_before"] == "open" or r["action"] in ("reopen", "fulfilled")]
    # DISPOSE-1: after the probes, every item still open gets its rule applied (gate, shelved), so nothing stays open past the limit. A failure here is printed and
    # never stops the verdicts above from landing.
    try:
        from . import dispose
        closed_now = {r["id"] for r in rows if r["action"] == "close"}
        out += [{"id": d["id"], "probe": "", "passed": False, "evidence": d["evidence"], "action": d["disposition"]} for d in dispose.run(root, apply=apply) if d["id"] not in closed_now]
    except Exception as e:  # noqa: BLE001
        import sys
        print(f"dispose failed: {type(e).__name__}: {e}", file=sys.stderr)
    # FLOW-BALANCE-1: the second loop measures inflow against closures and SLA, and consolidates and throttles filing when the balance tips.
    try:
        from . import balance
        m = balance.run(root, apply=apply)
        out.append({"id": "FLOW-BALANCE-1", "probe": "balance --probe", "passed": not m["tipped"] and not m.get("unmeasured"), "evidence": json.dumps({"windows": m["windows"], "sla": {k: m["sla"].get(k) for k in ("within", "breached", "compliance")}, "unmeasured": m.get("unmeasured"), "actions": m["actions"]}), "action": "measure"})
    except Exception as e:  # noqa: BLE001
        import sys
        print(f"balance failed: {type(e).__name__}: {e}", file=sys.stderr)
    return out


def main(argv: list[str]) -> int:
    if argv[:1] == ["--run"]:
        rows = run(apply="--apply" in argv)
        print(json.dumps(rows, indent=1))
        if "--publish" in argv and "--apply" in argv:  # QUEUE-PERSIST-1: this pass's verdicts survive the runner, so streaks can reach a close
            from . import contracts, ledger
            from . import dispose
            res = ledger.publish(REPO, [contracts.LEDGER, dispose.LEDGER, "ops/balance.jsonl"], "queue: closing-probe verdicts (QUEUE-PERSIST-1)")
            print(json.dumps({"publish": res}))
            return 0 if res.get("ok") else 1
        return 0
    bad = check()
    print("\n".join(bad) or "queue ok"); return 1 if bad else 0
