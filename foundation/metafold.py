"""META-FOLD-1: tickets about another record close when that record resolves, ported from QNFO's ISSUE-HYGIENE-1 meta-ticket fold
(workflow issue-meta-fold, issue_fold_ledger). Ultrastable is the foundation for any autonomous system.

A meta-ticket is a queue item whose work is another record: a pull request to land (OL-PR-<n>), another queue item (`**About:** <ID>`), or an item
it has been replaced by (`**Superseded-by:** <ID>`). Each pass resolves every reference and closes the meta-ticket with evidence once all of them
are resolved:

  pr:<n>      the pull request is merged or closed (read once per pass with `gh pr list --state all`; unreadable -> nothing closes)
  item:<ID>   the referenced queue item is closed or done
  superseded  the successor item exists: the meta-ticket closes as "superseded by <ID>"

A reference to a record that does not exist is dangling: it is reported, never resolved. The before-state of every fold is appended to
ops/fold-ledger.jsonl (id, references, sha256 of the body before), so a fold can be undone from the ledger.

  python3 -m foundation metafold --tick [--apply]
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

from . import ledger

REPO = Path(__file__).resolve().parents[1]
LEDGER = "ops/fold-ledger.jsonl"
CLOSED = ("closed", "done")
FIELD = lambda body, name: (re.search(rf"^\*\*{name}:\*\*\s*(.+)$", body, re.M) or [None, ""])[1].strip()


def refs(it: dict) -> list[str]:
    """The records this item is about: explicit **About:** references, plus the pull request an OL-PR-<n> item exists to land."""
    body = it["json"].get("body", "")
    out = []
    for r in re.split(r"[,\s]+", FIELD(body, "About")):
        if not r:
            continue
        out.append(r if ":" in r else ("pr:" + r.lstrip("#") if r.lstrip("#").isdigit() else "item:" + r))
    m = re.match(r"^OL-PR-(\d+)$", str(it["id"]))
    if m and f"pr:{m[1]}" not in out:
        out.append(f"pr:{m[1]}")
    return out


def pr_states(root) -> dict[int, str] | None:
    try:
        r = subprocess.run(["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "number,state"], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=60)
        return {int(p["number"]): p["state"] for p in json.loads(r.stdout or "[]")} if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError):
        return None


def resolve(ref: str, items: dict[str, dict], prs: dict | None) -> tuple[str, str]:
    """(resolved | open | dangling | unknown, why)."""
    kind, _, key = ref.partition(":")
    if kind == "pr":
        if prs is None:
            return "unknown", "pull requests unreadable here"
        st = prs.get(int(key)) if key.isdigit() else None
        if st is None:
            return "dangling", f"pull request #{key} not found"
        return ("resolved" if st in ("MERGED", "CLOSED") else "open"), f"pull request #{key} {st.lower()}"
    if kind == "item":
        it = items.get(key)
        if not it:
            return "dangling", f"item {key} not in the queue"
        return ("resolved" if it["status"] in CLOSED else "open"), f"item {key} {it['status']}"
    return "dangling", f"unknown reference kind {kind!r}"


def tick(root=REPO, apply=False, now=None, prs="read") -> dict:
    from . import queue
    root = Path(root)
    at = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    its = queue.items(root)
    by = {str(i["id"]): i for i in its}
    need_pr = any(r.startswith("pr:") for i in its if i["status"] == "open" for r in refs(i))
    prs = (pr_states(root) if need_pr else {}) if prs == "read" else prs
    folded, waiting, dangling, recs = [], [], [], []
    for it in its:
        if it["status"] != "open":
            continue
        body = it["json"].get("body", "")
        succ = FIELD(body, "Superseded-by")
        if succ:
            if succ in by and succ != str(it["id"]):
                why = f"superseded by {succ}"
            else:
                dangling.append(f"{it['id']} -> {succ}"); continue
        else:
            rs = refs(it)
            if not rs:
                continue
            res = [(r, *resolve(r, by, prs)) for r in rs]
            if any(v == "dangling" for _, v, _ in res):
                dangling += [f"{it['id']} -> {r} ({w})" for r, v, w in res if v == "dangling"]
            if not all(v == "resolved" for _, v, _ in res):
                waiting.append(str(it["id"])); continue
            why = "moot: " + "; ".join(w for _, _, w in res)
        folded.append({"id": str(it["id"]), "why": why})
        recs.append({"at": at, "id": str(it["id"]), "refs": refs(it) or [succ], "reason": why, "body_sha256": hashlib.sha256(body.encode()).hexdigest()})
        if apply:
            j = it["json"]
            j["body"] = re.sub(r"\*\*Status:\*\*\s*open", "**Status:** closed", body, count=1) + f"\n\n**Evidence:** {why} (meta-ticket fold {at})\n"
            it["path"].write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
    if apply:
        ledger.append(root, LEDGER, recs)
    return {"at": at, "folded": folded, "waiting": waiting, "dangling": dangling, "prs_readable": prs is not None}


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--tick" in a:
        print(json.dumps(tick(apply="--apply" in a), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
