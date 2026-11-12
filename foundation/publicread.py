"""Public, unauthenticated, read-only surface for repositories that are public (CLOSED-LOOP-AXIOM). Never writes, never sends a credential.
Repositories are listed in doctrine/fleet.json `public_read`. The executor loads this before labelling any "cannot reach X" failure executor-failed.
"""
from __future__ import annotations
import json, re, subprocess, urllib.request, urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/fleet.json").read_text(encoding="utf-8"))


def _get(url: str, timeout=30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-public-read", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # no Authorization header, by construction
        return r.read().decode("utf-8", "replace")


def file_text(repo: str, path: str, ref="HEAD") -> str:
    return _get(f"https://raw.githubusercontent.com/{repo}/{ref}/{path}")


def history(repo: str, n=50, path: str | None = None) -> list[dict]:
    q = f"?per_page={n}" + (f"&path={path}" if path else "")
    return [{"sha": c["sha"], "date": c["commit"]["author"]["date"], "message": c["commit"]["message"].splitlines()[0]} for c in json.loads(_get(f"https://api.github.com/repos/{repo}/commits{q}"))]


def clone(repo: str, dest: str) -> tuple[int, str]:
    r = subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", f"https://github.com/{repo}.git", dest], capture_output=True, text=True, timeout=300,
                       env={"GIT_TERMINAL_PROMPT": "0", "PATH": "/usr/bin:/bin:/usr/local/bin"})
    return r.returncode, (r.stdout + r.stderr).strip()[-300:]


def works(repo: str) -> bool:
    try:
        return bool(history(repo, 1))
    except (urllib.error.URLError, OSError, ValueError, KeyError):
        return False


def mentioned(text: str, root=REPO) -> list[str]:
    return [r for r in cfg(root)["public_read"] if r.lower() in (text or "").lower() or r.split("/")[1].lower() in (text or "").lower()]


def context(issue: dict, root=REPO) -> str:
    """Public history for any public-read repository the issue mentions, ready to put in the prompt. Empty when none or unreachable."""
    out = []
    for r in mentioned(f"{issue.get('title','')} {issue.get('body','')}", root):
        try:
            rows = history(r, 60)
        except (urllib.error.URLError, OSError, ValueError, KeyError):
            continue
        out.append(f"PUBLIC READ-ONLY HISTORY of {r} (unauthenticated):\n" + "\n".join(f"{c['date'][:10]} {c['sha'][:8]} {c['message'][:100]}" for c in rows))
    return "\n\n".join(out)


def is_reach_error(detail: str, root=REPO) -> bool:
    return bool(re.search(cfg(root)["reach_error"], detail or "", re.I))
