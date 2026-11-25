"""Append-only JSONL ledgers that survive the launch pass (QNFO-PORT-1 shared helper).

A launch pass starts from main and commits its evidence to branch `loop-evidence` (foundation/launch.py), so a ledger written by one pass is not
in the next pass's checkout. `rows()` reads the ledger from that branch and from this working copy and de-duplicates identical lines, the same
rule foundation/queue.executor_rows applies to the executor log. Event-sourced loops (contracts, metric loop, throughput, fold) replay these
rows to get their state, so no loop keeps a mutable state file that a fresh checkout would lose.
"""
from __future__ import annotations
import json, subprocess
from pathlib import Path
from . import cloudevents

BRANCH = "origin/loop-evidence"


def _branch_text(root: Path, rel: str) -> str:
    """The ledger as the evidence branch holds it. LEDGER-FETCH-1: a runner checks out main only, so `origin/loop-evidence` is absent and a bare
    `git show` returned "" without a word: every fleet pass replayed main's rows alone, saw a streak of 1 and closed nothing (2026-11-19, items
    with three recorded passes held at "1 of 2"). The branch is fetched once when the ref is missing; a missing file on it is still ""."""
    show = ["git", "-C", str(root), "show", f"{BRANCH}:{rel}"]
    try:
        r = subprocess.run(show, capture_output=True, text=True, encoding="utf-8", timeout=30)
        if r.returncode and subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "-q", BRANCH], capture_output=True).returncode:
            remote, _, name = BRANCH.partition("/")
            subprocess.run(["git", "-C", str(root), "fetch", "-q", remote, f"+refs/heads/{name}:refs/remotes/{BRANCH}"], capture_output=True, timeout=120)
            r = subprocess.run(show, capture_output=True, text=True, encoding="utf-8", timeout=30)
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
                out.append(cloudevents.unwrap(json.loads(line)))  # a row written as a CloudEvents envelope reads as its payload; older rows are the payload
            except ValueError:
                pass
    return sorted(out, key=lambda r: r.get("at") or "")


def _git(root: Path, *args, data: bytes | None = None, env: dict | None = None, timeout=120) -> subprocess.CompletedProcess:
    import os
    return subprocess.run(["git", "-C", str(root), *args], input=data, capture_output=True, timeout=timeout, env={**os.environ, **(env or {})})


def merged_text(branch_text: str, local_text: str, rel: str) -> str:
    """EVIDENCE-APPEND-1: a ledger (.jsonl) keeps every line the branch holds and gains the local lines it lacks, in local order; any other
    file is the local copy. A pass therefore never removes a row another pass or host wrote."""
    if not rel.endswith(".jsonl"):
        return local_text
    have = set(branch_text.splitlines())
    new = [l for l in local_text.splitlines() if l.strip() and l not in have]
    if not new:
        return branch_text
    base = branch_text if not branch_text or branch_text.endswith("\n") else branch_text + "\n"
    return base + "\n".join(new) + "\n"


def publish(root, paths: list[str], message: str, branch: str = "loop-evidence", remote: str = "origin", tries: int = 4) -> dict:
    """EVIDENCE-APPEND-1: write `paths` onto `branch` as one commit whose parent is the branch tip, built with a scratch index so the working copy
    and HEAD are untouched, and pushed without force. A rejected push (another host appended first) refetches and rebuilds on the new tip.
    The earlier route committed on top of main and force-pushed, which replaced the branch with main plus one pass: every earlier pass's
    contract and executor rows were deleted, so no closing probe could reach two recorded passes (seen 2026-11-19: 801 rows, 3 passes in 4 days)."""
    import os, tempfile, time
    root = Path(root)
    ident = {"GIT_AUTHOR_NAME": "ultrastable-loop", "GIT_AUTHOR_EMAIL": "loop@ultrastable.invalid",
             "GIT_COMMITTER_NAME": "ultrastable-loop", "GIT_COMMITTER_EMAIL": "loop@ultrastable.invalid"}
    last = ""
    for attempt in range(1, tries + 1):
        f = _git(root, "fetch", "-q", remote, f"+refs/heads/{branch}:refs/remotes/{remote}/{branch}")
        tip = _git(root, "rev-parse", "--verify", "-q", f"refs/remotes/{remote}/{branch}").stdout.decode().strip() if f.returncode == 0 else ""
        fd, idx = tempfile.mkstemp(prefix="evidence-index-"); os.close(fd); os.unlink(idx)
        env = {**ident, "GIT_INDEX_FILE": idx}
        try:
            r = _git(root, "read-tree", *([tip] if tip else ["--empty"]), env=env)
            if r.returncode:
                return {"ok": False, "step": "read-tree", "detail": r.stderr.decode()[-300:]}
            changed = 0
            for rel in paths:
                p = root / rel
                if not p.is_file():
                    continue
                old = _git(root, "show", f"{tip}:{rel}").stdout.decode("utf-8", "replace") if tip else ""
                text = merged_text(old, p.read_text(encoding="utf-8"), rel)
                if tip and text == old:
                    continue
                blob = _git(root, "hash-object", "-w", "--stdin", data=text.encode("utf-8")).stdout.decode().strip()
                r = _git(root, "update-index", "--add", "--cacheinfo", f"100644,{blob},{rel}", env=env)
                if r.returncode:
                    return {"ok": False, "step": "update-index", "detail": r.stderr.decode()[-300:]}
                changed += 1
            if not changed:
                return {"ok": True, "detail": "nothing to publish"}
            tree = _git(root, "write-tree", env=env).stdout.decode().strip()
            sha = _git(root, "commit-tree", tree, *(["-p", tip] if tip else []), "-m", message, env=env).stdout.decode().strip()
        finally:
            if os.path.exists(idx):
                os.unlink(idx)
        r = _git(root, "push", "-q", remote, f"{sha}:refs/heads/{branch}")
        if r.returncode == 0:
            return {"ok": True, "step": "push", "detail": f"{changed} file(s) on {branch} at {sha[:12]}", "sha": sha}
        last = r.stderr.decode()[-300:]
        time.sleep(attempt * 2)
    return {"ok": False, "step": "push", "detail": last}


def append(root, rel: str, recs: list[dict]) -> None:
    if not recs:
        return
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, sort_keys=True) + "\n")
