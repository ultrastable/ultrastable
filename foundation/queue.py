"""The machine-read queue of residual work (CLOSED-LOOP-AXIOM). No thread stays alive to hold an item: every residual of a finished thread is an
`OL-*` item in docs/issues/ with an owner, a trigger and a closing probe, worked by the scheduled executor and merge lane until the probe passes.

  python3 -m foundation queue --check     every item complete; every thread residual in doctrine/thread-residuals.json has an item
  python3 -m foundation queue --run [--apply]   evaluate each open item's probe on every executor run and close the ones that pass

Probe kinds: file:<path>, grep:<path>::<regex>, cmd:<command> (allow-listed prefixes only, 60 s, argv without a shell).
"""
from __future__ import annotations
import json, re, shlex, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CMD_ALLOWED = ("gh ", "python3 scripts/", "python3 -m foundation ", "python3 tools/", "git ")
FIELD = lambda body, name: (re.search(rf"^\*\*{name}:\*\*\s*(.+)$", body, re.M) or [None, ""])[1].strip()


def items(root=REPO) -> list[dict]:
    out = []
    for p in sorted(f for pat in ("OL-*.json", "Q-*.json") for f in (Path(root) / "docs/issues").glob(pat)):
        j = json.loads(p.read_text(encoding="utf-8")); b = j.get("body", "")
        out.append({"id": j["id"], "path": p, "json": j, "owner": FIELD(b, "Owner"), "trigger": FIELD(b, "Trigger"), "probe": FIELD(b, "Done check"),
                    "status": FIELD(b, "Status"), "residual": FIELD(b, "Residual")})
    return out


def takeable(root=REPO) -> list[dict]:
    """QUEUE-1: open queue items in the shape the executor's pick() expects. Owner-held items (identity-bound, ROWAN) are not the executor's.
    An item whose last three executor log rows all failed is parked until a row of another result appears, so a bad item cannot starve the rest."""
    root = Path(root); fails: dict[str, int] = {}
    log = root / "ops/executor-log.jsonl"
    if log.exists():
        for line in log.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("issue") is not None:
                k = str(r["issue"]); fails[k] = fails.get(k, 0) + 1 if r.get("result") == "failed" else 0
    out = []
    for it in items(root):
        j = it["json"]
        if it["status"] != "open" or re.search(r"ROWAN|identity-bound", it["owner"], re.I) or fails.get(str(it["id"]), 0) >= 3:
            continue
        out.append({"number": it["id"], "title": j.get("title", it["id"]), "body": j.get("body", ""), "labels": [{"name": n} for n in j.get("labels", [])],
                    "updated_at": "1970-01-01T00:00:00Z"})
    return out


def close(root, item_id: str, why: str) -> None:
    """Mark an item closed with evidence (check() rejects a closed item without it). Called inside the executor's PR so the merge is the closure."""
    root = Path(root)
    for it in items(root):
        if str(it["id"]) == str(item_id):
            j = it["json"]
            j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n\n**Evidence:** {why}\n"
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
    rows = []
    for it in items(root):
        if it["status"] != "open":
            continue
        ok, ev = probe(root, it["probe"])
        rows.append({"id": it["id"], "probe": it["probe"], "passed": ok, "evidence": ev})
        if ok and apply:
            j = it["json"]
            j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n\n**Evidence:** probe passed: {ev}\n"
            it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
    return rows


def main(argv: list[str]) -> int:
    if argv[:1] == ["--run"]:
        rows = run(apply="--apply" in argv)
        print(json.dumps(rows, indent=1)); return 0
    bad = check()
    print("\n".join(bad) or "queue ok"); return 1 if bad else 0
