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
from . import queue as qmod
from . import crossrepo
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG = "ops/executor-log.jsonl"
SKIP_LABELS = {"hold", "blocked", "owner", "gate", "identity-bound", "wontfix", "in-progress", "executor-failed"}
CLAIM_LABEL = "in-progress"
DENY_PREFIXES = (".git/", ".github/", "autonomy/", "ops/executor-log")
DENY_NAMES = (".env", "id_rsa", "credentials")
MAX_FILES, MAX_BYTES = 8, 200_000
# Generated files are derived from the queue and docs, so any change makes them stale; the executor regenerates them instead of failing its own checks.
REPAIRS = 2
GENERATORS = [["python3", "scripts/build_dashboard.py"], ["python3", "scripts/build_site_roadmap.py"], ["python3", "-m", "foundation", "doctrine", "--apply"], ["python3", "-m", "foundation", "glossary", "--apply"], ["python3", "-m", "foundation", "standards", "--apply"]]
CHECKS = [["python3", "scripts/lint_workflows.py"], ["python3", "-m", "unittest", "discover", "-s", "tests/foundation"]]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def priority(issue: dict) -> tuple:
    """Driver order: p0..p9 label (lower first), then oldest number. Unlabelled issues sort after labelled ones."""
    if "score" in issue:  # PRIORITIZE-1: the ranker's score (goal weight, dependency centrality, size, age) replaces label-then-age order
        return (0, -issue["score"], str(issue["number"]))
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
    base = Path(root).resolve()
    for e in edits:
        f = Path(root) / e["path"]
        try:  # RND-1 (adopted from claude-code v2.1.314): a symlink inside the tree must not carry a write outside the working tree
            f.parent.resolve().relative_to(base)
            if f.is_symlink():
                f.resolve().relative_to(base)
        except ValueError:
            raise ValueError(f"{e['path']!r}: resolves outside the working tree")
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
    return (axiom() + "\n\n" + json.loads((REPO / "doctrine/self-improvement.json").read_text(encoding="utf-8"))["axiom"] + "\n\nYou are the work step of an autonomous software organization. Resolve this issue with the smallest correct change to the repository. "
            'Reply with ONLY JSON: {"summary":"one line","files":[{"path":"relative/path","content":"full new file content"}]}. '
            "Never touch .github/, autonomy/, secrets or git files. Write tests where the change is code. "
            "Every new Markdown file must contain the exact line: Ultrastable is the foundation for any autonomous system. Do not write about memory or chat as storage. Server-side only: never reference localhost, 127.0.0.1 or a listening port; code runs as a Cloudflare Worker or a plain function with injected fetch.\n\n"
            f"ISSUE #{issue['number']}: {issue['title']}\n{(issue.get('body') or '')[:6000]}\n\nREPOSITORY FILES (partial):\n{tree[:6000]}\n"
            + (lambda c: f"\n{c[:6000]}\n" if c else "")(_public_context(issue)) + ref)


def agents_block_format() -> str:
    from . import agents
    return agents.BLOCK_FORMAT


def cf_ready() -> bool:
    return bool(os.environ.get("CLOUDFLARE_API_TOKEN") and os.environ.get("CLOUDFLARE_ACCOUNT_ID"))


def call_cloudflare(prompt: str) -> dict:
    """Second model route (no Anthropic key needed): Workers AI on the account the fleet already holds. Same JSON contract as call_model."""
    acct, tok = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]
    model = os.environ.get("EXECUTOR_CF_MODEL", "@cf/qwen/qwen2.5-coder-32b-instruct")
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}", method="POST",
        data=json.dumps({"messages": [{"role": "user", "content": prompt}], "max_tokens": 7000}).encode(),
        headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = json.loads(r.read())["result"]["response"]
    if isinstance(text, dict):  # some Workers AI models return the JSON object already parsed
        return text
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def call_model(prompt: str, key: str | None, model: str | None = None) -> dict:
    if not key:
        from . import agents  # CODE-AGENTS-1: routed by cost across the adapter registry, falling back on failure
        return agents.complete(prompt)[0]
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


REPO_SLUG = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")


def publish_change(repo: str, root, branch: str, subject: str, body: str) -> dict:
    """Commit the working tree on `branch` and open it the executor's way: draft PR, marked ready, checks dispatched on the branch (a PR opened with the workflow token
    raises no pull_request event); the lane merges on green. Used by the product manager loop for the items it files."""
    steps = [["git", "checkout", "-B", branch], ["git", "add", "-A", "--", ".", f":!{LOG}"],
             ["git", "-c", "user.name=ultrastable-pm", "-c", "user.email=pm@users.noreply.github.com", "commit", "-m", subject], ["git", "push", "-u", "origin", branch]]
    for s in steps:
        code, o = sh(s, root)
        if code:
            return {"pr": None, "error": f"{' '.join(s[:2])} failed: {o[-200:]}"}
    code, o = sh(["gh", "pr", "create", "-R", repo, "--draft", "--base", "main", "--head", branch, "--title", subject, "--body", body + "\n\nProduct manager pass " + now() + "."], root)
    if code:
        return {"pr": None, "error": "pr create failed: " + o[-200:]}
    pr, res = o.splitlines()[-1], {}
    res["pr"] = pr
    for kick in (["gh", "pr", "ready", pr, "-R", repo], ["gh", "workflow", "run", "ci.yml" if remote else "checks.yml", "-R", repo, "--ref", branch]):
        kc, ko = sh(kick, root)
        if kc:
            res["kick_failed"] = (res.get("kick_failed", "") + f" {' '.join(kick[:3])}: {ko[-120:]}").strip()
    return res


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


def queue_mode() -> bool:
    """QUEUE-1: the work queue is repository data (docs/issues/*.json, foundation/queue.py), not GitHub Issues, so Issues can stay off on the code
    repository. EXECUTOR_SOURCE=issues restores the old source for a repository that still uses it."""
    return os.environ.get("EXECUTOR_SOURCE", "queue") == "queue"


def run(repo: str, apply: bool = False, issue_no=None, root=REPO, model_call=None, checks=None, remote: bool = False) -> dict:
    """Returns the provenance row. Never raises for a failed step; the failure is the row (and an `executor-failed` label)."""
    root = Path(root)
    qm = queue_mode() and not remote  # EXEC-X: a remote repository (EXECUTOR_TARGET_REPOS) is worked from its own GitHub issues in a clone
    lroot = REPO if remote else root  # the log, the model ladder and its reviewer stay the executor's own, whatever repository is being changed
    if remote and checks is None:
        checks = crossrepo.CHECKS
    issues = crossrepo.takeable(repo, root) if remote else qmod.takeable(root) if qm else gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root)
    if qm and not issue_no:
        from . import growth  # GROWTH-1: a product manager keeps the backlog from devolving into bug fixes
        from . import rnd  # RND-1: competitor gaps and adopted findings carry a priority the loop computed
        issues = rnd.boost(growth.prefer(issues, root), root)
    issue = next((i for i in issues if str(i["number"]) == str(issue_no)), None) if issue_no else pick(issues)
    if not issue:
        row = {"result": "idle", "detail": "no open issue the executor may take", "prediction": "open_issues_takeable <= 0 within 24 h"}
        log(lroot, row); return row
    n = issue["number"]
    row = {"issue": n, "title": issue["title"], "prediction": f"issue_{n}_closed = 1 within 24 h"}
    key = os.environ.get("ANTHROPIC_API_KEY")
    from . import agent_ladder  # SYS-2: which model writes the change, who reviews it and what it cost
    if model_call is None and not key and not cf_ready() and not agent_ladder.rungs(root):
        row.update(result="no-model-credential", detail="ANTHROPIC_API_KEY is not bound on this host; recorded as a failure (docs/failures/). The Claude-session route (a cloud-hosted routine that starts a Claude session, which runs --pick and --record) takes the item without any key")
        log(lroot, row); return row
    if not apply:
        row.update(result="dry-run", detail="would claim, change, check and open a PR")
        return row
    gi = (lambda *a, **k: (0, "")) if qm else sh  # queue items carry no remote labels or comments; the log row is the claim
    gi(["gh", "issue", "edit", str(n), "-R", repo, "--add-label", CLAIM_LABEL], root)
    gi(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"claim: executor {now()}"], root)
    try:
        _, tree = sh(["git", "ls-files"], root)
        branch = f"agent/{n}-{re.sub(r'[^a-z0-9]+', '-', issue['title'].lower())[:40].strip('-')}"
        sh(["git", "checkout", "-B", branch], root)
        prompt, failed, files, out = build_prompt(issue, tree), [], [], {}
        for attempt in range(REPAIRS + 1):  # REPAIR-1: a failed check is fed back to the model; the change is only abandoned after the last try
            failed = []
            try:
                if model_call:
                    out, meta = model_call(prompt), {}
                else:
                    out, meta = agent_ladder.call(prompt, attempt, root=lroot)
                    row.setdefault("models", []).append(meta["model"])
                files = apply_edits(out["files"], root)
            except (ValueError, KeyError, TypeError, OSError, AttributeError) as e:  # unusable reply (bad JSON, missing files): counts as a failed attempt, not a crash
                failed.append("the reply was not valid JSON with a files list: " + type(e).__name__ + ": " + str(e)[:300])
                if attempt < REPAIRS:
                    prompt = build_prompt(issue, tree) + chr(10) * 2 + "YOUR PREVIOUS REPLY COULD NOT BE USED (" + failed[0] + "). Do NOT reply with JSON this time. Reply in exactly this format instead:" + chr(10) + agents_block_format()
                continue
            if checks is None:
                for g in GENERATORS:
                    sh(g, root)
            for c in (checks if checks is not None else CHECKS):
                code, o = sh(c, root)
                if code:
                    failed.append(f"{' '.join(c)}: {o[-2500:]}")
            if not failed and model_call is None:
                rv = agent_ladder.review(issue, out, meta.get("family", ""), root=lroot)
                row["review"] = rv
                if not rv["approve"]:
                    failed.append("independent reviewer (" + str(rv.get("model")) + ") vetoed the change: " + "; ".join(rv["reasons"]))
            if not failed:
                break
            sh(["git", "checkout", "--", "."], root); sh(["git", "clean", "-fd"], root)
            prompt = build_prompt(issue, tree) + chr(10) * 2 + "YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS; fix exactly these problems and reply with the full JSON again:" + chr(10) + chr(10).join(failed)[:5000]
        if failed:
            raise RuntimeError("checks failed after " + str(REPAIRS + 1) + " attempts: " + " | ".join(failed))
        row.update(files=files, summary=out.get("summary", ""))
        # WRITEBACK-1: the `checks` write-back gate fails any change that has code and no write-back (the first live executor PR failed on it), so
        # the executor records its own decision in the same commit: what it did, the evidence (checks that passed) and a file probe.
        probe_file = next((f for f in files if f != qmod.QUEUE_GLOB and not f.startswith("docs/issues/")), files[0] if files else "docs/issues")
        wc, wo = (0, "") if remote else sh(["python3", "-m", "foundation", "writeback", "record", "--kind", "decision", "--title", f"Executor closed {n}: {out.get('summary', issue['title'])}"[:140],
                     "--body", f"Measured: checks passed before the PR ({', '.join(' '.join(c) for c in (checks if checks is not None else CHECKS))}); files changed: {', '.join(files)}.",
                     "--owner", "executor", "--probe", f"file:{probe_file}"], root)
        if wc:
            raise RuntimeError("write-back failed: " + wo[-300:])
        if qm:
            qmod.close(root, n, "closed by the pull request that carries this change")  # merging the PR closes the item: no remote state to update
        if checks is None and not remote:
            for g in GENERATORS:
                gc, go = sh(g, root)
                if gc:
                    raise RuntimeError("generator failed: " + " ".join(g) + ": " + go[-300:])
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
        # A PR opened with GITHUB_TOKEN raises no pull_request event, and a draft runs no CI, so the executor starts the loop itself: mark ready,
        # dispatch checks on the branch (workflow_dispatch is allowed for the token); the lane merges when that run completes green.
        for kick in (["gh", "pr", "ready", row["pr"], "-R", repo], ["gh", "workflow", "run", "ci.yml" if remote else "checks.yml", "-R", repo, "--ref", branch]):
            kc, ko = sh(kick, root)
            if kc:
                row["kick_failed"] = (row.get("kick_failed", "") + f" {' '.join(kick[:3])}: {ko[-120:]}").strip()
        log(lroot, row)
    except Exception as e:  # recorded, labelled, never swallowed
        row.update(result="failed", detail=f"{type(e).__name__}: {str(e)[:600]}")
        from . import publicread
        if publicread.is_reach_error(row["detail"]) and publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}") and publicread.works(publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}")[0]):
            # A public route exists: do not label executor-failed; release the claim so the next tick retries with public history in the prompt.
            row.update(result="retry-public", detail=row["detail"] + " | public unauthenticated read works; retrying next tick through it")
            gi(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL], root)
            log(lroot, row)
            return row
        gi(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL, "--add-label", "executor-failed"], root)
        gi(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"executor failed: {row['detail']}\n\nA failure is a backlog item: remove `executor-failed` to retry, or the next tick with a different provider takes it."], root)
        log(lroot, row)
    return row


def pick_row(repo: str, root=REPO) -> dict:
    """The pick alone: what a model session (any host, no API key) should work next. Same driver order as run()."""
    issue = pick(qmod.takeable(root) if queue_mode() else gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root))
    if not issue:
        return {"result": "idle", "detail": "no open issue the executor may take"}
    return {"result": "picked", "issue": issue["number"], "title": issue["title"], "body": (issue.get("body") or "")[:6000]}


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation executor")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--issue")
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
    if row["result"] in ("idle", "failed", "no-model-credential") and not a.issue:  # EXEC-X: own queue empty or its top item failed (e.g. needs a protected path), so work the target repositories' issues (EXECUTOR_TARGET_REPOS)
        for target in crossrepo.targets():
            try:
                root = crossrepo.clone(target) if a.apply else REPO
                row = run(target, a.apply, None, root=root, remote=True)
            except Exception as e:  # a target that cannot be reached must not hide the next one
                row = {"result": "failed", "detail": f"{target}: {type(e).__name__}: {str(e)[:300]}"}
                log(REPO, row)
            if row["result"] not in ("idle", "failed"):
                break
    print(json.dumps(row, indent=2))
    if row["result"] == "no-model-credential":
        print("::warning::executor has no model credential on this host; recorded")
    return 1 if row["result"] == "failed" else 0
