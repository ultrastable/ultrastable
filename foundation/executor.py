"""Agent executor: the step of the tick that does the work. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation executor [--apply] [--issue N] [--repo OWNER/REPO]

One run = pick the top open issue in driver order, claim it, ask a model for a change, apply it under a path guard, run the
checks, and open a PR on green (the lane marks it ready and squash-merges it after CI). Every run, success or failure, appends
one provenance row to ops/executor-log.jsonl. Hosts: the Cloudflare tick Worker dispatches `executor.yml` (seed/worker/src/
executor.js); GitHub's own daily schedule and a manual dispatch run the same command, so the loop has two routes and no host
is required. Without --apply nothing is changed on GitHub or in git: the pick, the prompt size and the guard are reported.
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG = "ops/executor-log.jsonl"
SKIP_LABELS = {"hold", "blocked", "owner", "gate", "identity-bound", "wontfix", "in-progress", "executor-failed"}
CLAIM_LABEL = "in-progress"
DENY_PREFIXES = (".git/", ".github/", "autonomy/", "ops/executor-log")
DENY_NAMES = (".env", "id_rsa", "credentials")
MAX_FILES, MAX_BYTES = 8, 200_000
CHECKS = [["python3", "scripts/lint_workflows.py"], ["python3", "-m", "unittest", "discover", "-s", "tests/foundation"]]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def priority(issue: dict) -> tuple:
    """Driver order: p0..p9 label (lower first), then oldest number. Unlabelled issues sort after labelled ones."""
    p = 5
    for l in issue.get("labels", []):
        m = re.fullmatch(r"(?:p|priority[:/ -]?)(\d)", l["name"] if isinstance(l, dict) else l, re.I)
        if m:
            p = min(p, int(m.group(1)))
    return (p, issue["number"])


def pick(issues: list[dict], at: dt.datetime | None = None):
    """Top issue the executor may take. A claim older than 2h is stale and does not block."""
    at = at or dt.datetime.now(dt.timezone.utc)
    ok = []
    for i in issues:
        if "pull_request" in i:
            continue
        names = {(l["name"] if isinstance(l, dict) else l) for l in i.get("labels", [])}
        if names & (SKIP_LABELS - {CLAIM_LABEL}):
            continue
        if CLAIM_LABEL in names:
            upd = dt.datetime.fromisoformat(i["updated_at"].replace("Z", "+00:00"))
            if (at - upd).total_seconds() < 7200:
                continue
        ok.append(i)
    return min(ok, key=priority) if ok else None


def safe_path(p: str) -> str | None:
    """None when the path is acceptable, else the reason. The executor never touches workflows, policy, git or secrets."""
    if not p or p.startswith("/") or ".." in Path(p).parts or "\\" in p:
        return "path escapes the repository"
    if p.startswith(DENY_PREFIXES) or Path(p).name in DENY_NAMES:
        return "path is on the deny list (workflows, policy, git, secrets)"
    return None


def apply_edits(edits: list[dict], root=REPO) -> list[str]:
    if not edits or len(edits) > MAX_FILES:
        raise ValueError(f"need 1..{MAX_FILES} files, got {len(edits or [])}")
    total = 0
    for e in edits:
        why = safe_path(e.get("path", ""))
        if why:
            raise ValueError(f"{e.get('path')!r}: {why}")
        total += len(e.get("content", ""))
    if total > MAX_BYTES:
        raise ValueError("change is larger than the executor limit")
    out = []
    for e in edits:
        f = Path(root) / e["path"]
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(e["content"], encoding="utf-8")
        out.append(e["path"])
    return out


def _public_context(issue: dict) -> str:
    from . import publicread
    return publicread.context(issue, REPO)


def axiom() -> str:
    """The CLOSED-LOOP-AXIOM, loaded from doctrine/closed-loop.json so every prompt carries it (a test fails when it does not)."""
    return json.loads((REPO / "doctrine/closed-loop.json").read_text(encoding="utf-8"))["axiom"]


def build_prompt(issue: dict, tree: str) -> str:
    from . import kb  # reference documents are consumed here: the best matches for this issue are read by the agent
    ref = kb.retrieve(f"{issue['title']} {issue.get('body') or ''}")
    return (axiom() + "\n\nYou are the work step of an autonomous software organization. Resolve this issue with the smallest correct change to the repository. "
            'Reply with ONLY JSON: {"summary":"one line","files":[{"path":"relative/path","content":"full new file content"}]}. '
            "Never touch .github/, autonomy/, secrets or git files. Write tests where the change is code.\n\n"
            f"ISSUE #{issue['number']}: {issue['title']}\n{(issue.get('body') or '')[:6000]}\n\nREPOSITORY FILES (partial):\n{tree[:6000]}\n"
            + (lambda c: f"\n{c[:6000]}\n" if c else "")(_public_context(issue)) + ref)


def call_model(prompt: str, key: str, model: str | None = None) -> dict:
    model = model or os.environ.get("EXECUTOR_MODEL", "claude-sonnet-5-5")
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
        data=json.dumps({"model": model, "max_tokens": 16000, "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = json.loads(r.read())["content"][0]["text"]
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def sh(argv, root=REPO, timeout=600):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, cwd=root, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def gh_json(args, root=REPO):
    code, out = sh(["gh"] + args, root, 90)
    if code:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {out[-300:]}")
    return json.loads(out or "null")


def log(root, row: dict) -> None:
    p = Path(root) / LOG
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"schema": "ultrastable-executor/1", "at": now(), "host": os.environ.get("ULTRASTABLE_HOST", "unspecified"), **row}) + "\n")


def run(repo: str, apply: bool = False, issue_no: int | None = None, root=REPO, model_call=None, checks=None) -> dict:
    """Returns the provenance row. Never raises for a failed step; the failure is the row (and an `executor-failed` label)."""
    root = Path(root)
    issues = gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root)
    issue = next((i for i in issues if i["number"] == issue_no), None) if issue_no else pick(issues)
    if not issue:
        row = {"result": "idle", "detail": "no open issue the executor may take", "prediction": "open_issues_takeable <= 0 within 24 h"}
        log(root, row); return row
    n = issue["number"]
    row = {"issue": n, "title": issue["title"], "prediction": f"issue_{n}_closed = 1 within 24 h"}
    key = os.environ.get("ANTHROPIC_API_KEY")
    if model_call is None and not key:
        row.update(result="no-model-credential", detail="ANTHROPIC_API_KEY is not bound on this host; recorded as a failure (docs/failures/). The Claude-session route (scheduled task that starts a Claude session, which runs --pick and --record) takes the item without any key")
        log(root, row); return row
    if not apply:
        row.update(result="dry-run", detail="would claim, change, check and open a PR")
        return row
    sh(["gh", "issue", "edit", str(n), "-R", repo, "--add-label", CLAIM_LABEL], root)
    sh(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"claim: executor {now()}"], root)
    try:
        _, tree = sh(["git", "ls-files"], root)
        out = (model_call or (lambda p: call_model(p, key)))(build_prompt(issue, tree))
        branch = f"agent/{n}-{re.sub(r'[^a-z0-9]+', '-', issue['title'].lower())[:40].strip('-')}"
        sh(["git", "checkout", "-B", branch], root)
        files = apply_edits(out["files"], root)
        failed = []
        for c in (checks if checks is not None else CHECKS):
            code, o = sh(c, root)
            if code:
                failed.append(f"{' '.join(c)}: {o[-400:]}")
        if failed:
            sh(["git", "checkout", "--", "."], root); sh(["git", "clean", "-fd"], root)
            raise RuntimeError("checks failed: " + " | ".join(failed))
        row.update(files=files, summary=out.get("summary", ""))
        sh(["git", "add", "-A", "--", ".", f":!{LOG}"], root)
        sh(["git", "-c", "user.name=ultrastable-executor", "-c", "user.email=executor@users.noreply.github.com", "commit", "-m", f"{out.get('summary', issue['title'])} (#{n})"], root)
        code, o = sh(["git", "push", "-u", "origin", branch], root)
        if code:
            raise RuntimeError("push failed: " + o[-300:])
        body = f"Closes #{n}\n\nExecutor run {now()}. Checks passed before the PR: {', '.join(' '.join(c) for c in (checks if checks is not None else CHECKS))}.\nProvenance: {LOG} on branch loop-evidence. The lane merges on green CI."
        code, o = sh(["gh", "pr", "create", "-R", repo, "--draft", "--base", "main", "--head", branch, "--title", f"{out.get('summary', issue['title'])} (#{n})", "--body", body], root)
        if code:
            raise RuntimeError("pr create failed: " + o[-300:])
        row.update(result="pr-opened", pr=o.splitlines()[-1])
        log(root, row)
    except Exception as e:  # recorded, labelled, never swallowed
        row.update(result="failed", detail=f"{type(e).__name__}: {str(e)[:600]}")
        from . import publicread
        if publicread.is_reach_error(row["detail"]) and publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}") and publicread.works(publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}")[0]):
            # A public route exists: do not label executor-failed; release the claim so the next tick retries with public history in the prompt.
            row.update(result="retry-public", detail=row["detail"] + " | public unauthenticated read works; retrying next tick through it")
            sh(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL], root)
            log(root, row)
            return row
        sh(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL, "--add-label", "executor-failed"], root)
        sh(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"executor failed: {row['detail']}\n\nA failure is a backlog item: remove `executor-failed` to retry, or the next tick with a different provider takes it."], root)
        log(root, row)
    return row


def pick_row(repo: str, root=REPO) -> dict:
    """The pick alone: what a model session (any host, no API key) should work next. Same driver order as run()."""
    issue = pick(gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root))
    if not issue:
        return {"result": "idle", "detail": "no open issue the executor may take"}
    return {"result": "picked", "issue": issue["number"], "title": issue["title"], "body": (issue.get("body") or "")[:6000]}


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation executor")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--issue", type=int)
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable"))
    ap.add_argument("--pick", action="store_true", help="print the top takeable issue and exit; needs no model credential (Claude-session route)")
    ap.add_argument("--record", action="store_true", help="append one provenance row for work done by a model session (with --issue --result [--pr --detail --host])")
    ap.add_argument("--result"); ap.add_argument("--pr"); ap.add_argument("--detail", default=""); ap.add_argument("--host", default="claude-session")
    a = ap.parse_args(argv)
    if a.pick:
        row = pick_row(a.repo)
        print(json.dumps(row, indent=2)); return 0
    if a.record:
        if not (a.issue and a.result):
            ap.error("--record needs --issue and --result")
        row = {"issue": a.issue, "result": a.result, "detail": a.detail, "prediction": f"issue_{a.issue}_closed = 1 within 24 h"}
        if a.pr:
            row["pr"] = a.pr
        os.environ["ULTRASTABLE_HOST"] = a.host
        log(REPO, row); print(json.dumps(row, indent=2)); return 0
    row = run(a.repo, a.apply, a.issue)
    print(json.dumps(row, indent=2))
    if row["result"] == "no-model-credential":
        print("::warning::executor has no model credential on this host; recorded")
    return 1 if row["result"] == "failed" else 0
