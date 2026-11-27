"""EXEC-X: the executor works issues of sibling repositories (EXECUTOR_TARGET_REPOS, default ultrastable/workers), not only its own queue.

The change is made in a fresh clone, checked with that repository's own test command, and opened as a PR that carries the self-hosting
contract record; the repository's required checks gate the merge. Guards: epics, held, blocked, owner and protected-change items are never
taken; an item needs a machine-readable `Closing probe:` line so the loop can close it; at most MAX_PRS_PER_DAY PRs a day per repository.
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, tempfile
from pathlib import Path

DEFAULT_TARGETS = ""
MAX_PRS_PER_DAY = int(os.environ.get("EXECUTOR_MAX_PRS_PER_DAY", "4"))
CHECKS = [["npm", "test"]]
SKIP = {"hold", "blocked", "owner", "gate", "identity-bound", "wontfix", "in-progress", "executor-failed", "protected-change", "extraction-epic"}
PROBE = re.compile(r"^\s*closing probe:\s*(file_exists|release_exists|pr_merged):", re.I | re.M)


def targets() -> list[str]:
    return [t.strip() for t in os.environ.get("EXECUTOR_TARGET_REPOS", DEFAULT_TARGETS).split(",") if t.strip()]


def _gh(args: list[str], cwd=None, timeout=120) -> tuple[int, str]:
    try:
        r = subprocess.run(["gh"] + args, capture_output=True, text=True, cwd=cwd, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def eligible(issue: dict) -> bool:
    """Pure filter: a body-bearing, non-epic, unheld issue with a machine-readable closing probe."""
    names = {(l["name"] if isinstance(l, dict) else l) for l in issue.get("labels", [])}
    title = issue.get("title", "")
    return not (names & SKIP) and not title.upper().startswith(("EPIC", "GATE", "INCIDENT")) and bool(PROBE.search(issue.get("body") or ""))


def prs_today(repo: str, now: dt.datetime | None = None) -> int:
    now = now or dt.datetime.now(dt.timezone.utc)
    code, out = _gh(["pr", "list", "-R", repo, "--state", "all", "--limit", "50", "--json", "headRefName,createdAt"])
    if code:
        return MAX_PRS_PER_DAY  # cannot count: do not risk a flood
    rows = json.loads(out or "[]")
    return sum(1 for r in rows if r["headRefName"].startswith("agent/") and (now - dt.datetime.fromisoformat(r["createdAt"].replace("Z", "+00:00"))).total_seconds() < 86400)


def takeable(repo: str, root=None) -> list[dict]:
    """Open eligible issues of the repository, [] when the daily cap is used."""
    if prs_today(repo) >= MAX_PRS_PER_DAY:
        return []
    # REST, not `gh issue list`: it carries author_association and user, which executor.trusted() reads (RULE-OF-TWO-1)
    code, out = _gh(["api", f"repos/{repo}/issues?state=open&per_page=100"])
    if code:
        raise RuntimeError("gh api issues failed: " + out[-300:])
    return [i for i in json.loads(out) if "pull_request" not in i and eligible(i)]


def pr_body(n: int, row: dict, at: str) -> str:
    """The self-hosting contract record (Item, Spec, Prediction, Evidence, Author, Reviewer) so the target's contract check passes."""
    rv = row.get("review") or {}
    reviewer = f"independent model {rv.get('model')} (verdict: {'approve' if rv.get('approve') else 'n/a'})" if rv else "automated required checks (a different agent than the author)"
    models = ", ".join(row.get("models", [])) or "the executor's model ladder"
    return (f"Item: #{n}\nSpec: n/a, change scoped by the issue's closing probe\nPrediction: issue_{n}_closed = 1 within 24 h\n"
            f"Evidence: the repository's tests ({' '.join(' '.join(c) for c in CHECKS)}) passed before this pull request was opened; executor run {at}.\n"
            f"Author: ultrastable executor ({models})\nReviewer: {reviewer}\n\nCloses #{n}\n")


def clone(repo: str) -> Path:
    d = Path(tempfile.mkdtemp(prefix="exec-x-"))
    code, out = _gh(["repo", "clone", repo, str(d / "repo"), "--", "-q"], timeout=300)
    if code:
        raise RuntimeError("clone failed: " + out[-300:])
    if (d / "repo" / "package.json").exists():
        subprocess.run(["npm", "ci", "--silent"], cwd=d / "repo", capture_output=True, timeout=600)
    return d / "repo"
