# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RULE-OF-TWO-2 (kernel 9.0.0 §9 X1; Meta, "Agents Rule of Two", 2025): a job holds at most two of untrusted input, sensitive data or secrets,
and external state change.

  python3 -m foundation ruleoftwo --check   every job in .github/workflows/*.yml read from its own text; a job with all three fails
  python3 -m foundation ruleoftwo --report  the three properties per job (JSON)

The properties are read from the workflow, never declared beside it, so they cannot drift:
  untrusted  triggered by an event anyone can write (issues, comments, pull_request_target, discussions), or it interpolates an issue, comment or
             pull request body
  sensitive  it reads a secret other than GITHUB_TOKEN
  state      it holds a write permission, or it pushes, merges, deploys or releases
Run by `kernel --check`.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UNTRUSTED_EVENTS = {"issues", "issue_comment", "pull_request_target", "discussion", "discussion_comment", "pull_request_review_comment"}
UNTRUSTED_TEXT = re.compile(r"github\.event\.(issue|comment|pull_request|review|discussion)\.(body|title)")
SECRET = re.compile(r"secrets\.(?!GITHUB_TOKEN\b)[A-Za-z_]\w*")
STATE_TEXT = re.compile(r"git push|gh pr merge|gh api -X (POST|PUT|PATCH|DELETE)|wrangler (deploy|versions)|gh release (create|upload)")


def _events(w: dict) -> set[str]:
    on = w.get(True, w.get("on")) or {}
    return {on} if isinstance(on, str) else set(on) if isinstance(on, (list, dict)) else set()


def _reachable(evs: set[str], cond: str) -> set[str]:
    """The workflow's events that can start this job, given its `if:`: `github.event_name == 'x'` keeps only x, `!= 'x'` drops x."""
    only = set(re.findall(r"github\.event_name\s*==\s*'([\w-]+)'", cond))
    drop = set(re.findall(r"github\.event_name\s*!=\s*'([\w-]+)'", cond))
    return ((evs & only) if only else evs) - drop


def _writes(perm) -> bool:
    if perm == "write-all":
        return True
    return isinstance(perm, dict) and any(v == "write" for v in perm.values())


def jobs(root=REPO) -> list[dict]:
    import yaml
    out = []
    for f in sorted((Path(root) / ".github/workflows").glob("*.y*ml")):
        w = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        evs, wperm = _events(w), w.get("permissions")
        for jid, j in (w.get("jobs") or {}).items():
            txt = yaml.safe_dump(j)
            row = {"workflow": f.name, "job": jid,
                   "untrusted": bool(_reachable(evs, str(j.get("if") or "")) & UNTRUSTED_EVENTS) or bool(UNTRUSTED_TEXT.search(txt)),
                   "sensitive": bool(SECRET.search(txt)),
                   "state": _writes(j.get("permissions", wperm)) or bool(STATE_TEXT.search(txt))}
            out.append(row)
    return out


def check(root=REPO) -> list[str]:
    return [f"{r['workflow']} job {r['job']}: untrusted input, a secret and external state change in one job (kernel 9.0.0 X1); split it so one job "
            f"reads the untrusted text with no secret and hands a validated result to another" for r in jobs(root)
            if r["untrusted"] and r["sensitive"] and r["state"]]


def main(argv) -> int:
    if "--report" in argv:
        print(json.dumps(jobs(), indent=1)); return 0
    bad = check()
    for b in bad:
        print("ruleoftwo:", b)
    if not bad:
        print(f"ruleoftwo ok: {len(jobs())} jobs, none holds all three of untrusted input, a secret and state change (RULE-OF-TWO-2)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
