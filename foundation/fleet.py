"""One executor and merge lane across every org repository (CLOSED-LOOP-AXIOM). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation fleet [--apply] [--repo OWNER/REPO ...]

Per run: (1) probe the write surface per repository and record it, (2) build one queue from every repository's open issues in driver order,
(3) merge every open pull request that is non-draft, green and not held, (4) run the cross-repo drift and dependency loop and open the
dependent issue where a repository has fallen behind. Without --apply nothing is written. Data: doctrine/fleet.json. Log: ops/fleet-log.jsonl.
The GitHub transport is a callable `api(method, path, body) -> (status, json)` so tests inject a fake and any surface supplies the token.
"""
from __future__ import annotations
import datetime as dt, json, os, re, urllib.request, urllib.error
from pathlib import Path
from .executor import priority

REPO = Path(__file__).resolve().parents[1]
LOG = "ops/fleet-log.jsonl"
HOME = "ultrastable"  # the repository this code runs from; its queue is read from docs/issues when Issues are off


def load(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/fleet.json").read_text(encoding="utf-8"))


def http_api(token: str):
    def api(method, path, body=None):
        req = urllib.request.Request("https://api.github.com" + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, {"message": e.read().decode()[:300]}
    return api


def tokens() -> list[tuple[str, str]]:
    """Surfaces with a token in this environment, in the order of doctrine/fleet.json."""
    env = {"fleet-token": "FLEET_TOKEN", "lane-pat": "LANE_PAT", "github-token": "GH_TOKEN"}
    return [(s["id"], os.environ[env[s["id"]]]) for s in load()["surfaces"] if env.get(s["id"]) and os.environ.get(env[s["id"]])]


def probe_surfaces(cfg: dict, apis: dict) -> dict:
    """For each repository, the first surface whose token can read it and can write (permissions.push). None means every surface failed (recorded, never a card)."""
    out = {}
    for r in cfg["repos"]:
        out[r] = {"surface": None, "tried": []}
        for sid, api in apis.items():
            st, j = api("GET", f"/repos/{cfg['org']}/{r}")
            if st == 200 and j.get("archived"):
                out[r]["archived"] = True  # read-only: skipped, recorded, never a card
                break
            ok = st == 200 and bool((j.get("permissions") or {}).get("push"))
            out[r]["tried"].append({"surface": sid, "status": st, "push": ok})
            if ok:
                out[r]["surface"] = sid
                break
    return out


def queue(cfg: dict, api, repos: list[str] | None = None, root=REPO) -> list[dict]:
    """One queue: every open non-PR issue of every repo, driver order (p-label, then oldest), repo name as tie-break."""
    items = []
    for r in repos or cfg["repos"]:
        st, rows = api("GET", f"/repos/{cfg['org']}/{r}/issues?state=open&per_page=100")
        if st != 200:
            # Issues are off (or unreadable): the queue lives as repo data (docs/issues/Q-*.json); the home repo is this checkout.
            if r == HOME:
                from .queue import takeable
                items += [dict(i, repo=r) for i in takeable(root)]
            continue
        items += [dict(i, repo=r) for i in rows if "pull_request" not in i]
    return sorted(items, key=lambda i: (priority(i), i["repo"]))


# GATE-SKIP-1 (Q-RECUR-7f3c1db956): the lane read the legacy combined /status, which never carries Actions check-runs, so it answered
# "pending, 0 statuses" and merged PRs whose `checks` run was skipped or still running (MERGE-AUDIT-1 caught #617 .. #1461). The gate is now the
# same as seed/worker/src/greenguard.js: every check-run finished and green, and REQUIRED runs concluded `success` (skipped is not green).
REQUIRED = {"ultrastable": ["checks"]}


def not_green(repo: str, sha: str, runs: list | None) -> str | None:
    if runs is None:
        return "check-runs unreadable"
    runs = [c for c in runs if c.get("name") != "lane"]
    for c in runs:
        if c.get("status") != "completed":
            return f"{c.get('name')} still running"
    for c in runs:
        if c.get("conclusion") not in ("success", "neutral", "skipped"):
            return f"{c.get('name')} {c.get('conclusion')}"
    for need in REQUIRED.get(repo, []):
        if not any(c.get("name") == need and c.get("conclusion") == "success" for c in runs):
            return f"{need} has not passed on {str(sha)[:7]}"
    return None


def mergeable(cfg: dict, pr: dict, runs: list | None, repo: str = "") -> tuple[bool, str]:
    names = {(l["name"] if isinstance(l, dict) else l).lower() for l in pr.get("labels", [])}
    if pr.get("draft"):
        return False, "draft"
    if names & set(cfg["merge"]["skip_labels"]):
        return False, "held by label"
    why = not_green(repo, pr.get("head", {}).get("sha", ""), runs)
    if why:
        return False, why
    return True, "green"


def merge_lane(cfg: dict, api, apply=False, repos=None) -> list[dict]:
    rows = []
    for r in repos or cfg["repos"]:
        st, prs = api("GET", f"/repos/{cfg['org']}/{r}/pulls?state=open&per_page=50")
        for pr in (prs if st == 200 else []):
            _, detail = api("GET", f"/repos/{cfg['org']}/{r}/pulls/{pr['number']}")
            if (detail or {}).get("mergeable") is False:
                rows.append({"repo": r, "pr": pr["number"], "action": "skip", "why": "conflicts"}); continue
            st3, cr = api("GET", f"/repos/{cfg['org']}/{r}/commits/{pr['head']['sha']}/check-runs?per_page=100")
            ok, why = mergeable(cfg, pr, (cr or {}).get("check_runs", []) if st3 == 200 else None, r)
            row = {"repo": r, "pr": pr["number"], "action": "merge" if ok else "skip", "why": why}
            if ok and apply:
                s2, j2 = api("PUT", f"/repos/{cfg['org']}/{r}/pulls/{pr['number']}/merge", {"merge_method": cfg["merge"]["method"]})
                row["merged"] = s2 == 200
                if s2 != 200:
                    row["error"] = (j2 or {}).get("message", "")[:160]
            rows.append(row)
    return rows


def drift(cfg: dict, read) -> list[dict]:
    """`read(repo, path) -> text|None`. Reports copies that differ or lack their required text, with the repository to fix."""
    out = []
    for c in cfg["copies"]:
        for f in c["files"]:
            texts = {r: read(r, f) for r in c["repos"]}
            if c["rule"] == "identical":
                base = next((t for t in texts.values() if t is not None), None)
                out += [{"copy": c["id"], "repo": r, "file": f, "problem": "differs" if t is not None else "missing"} for r, t in texts.items() if t != base]
            elif c["rule"].startswith("contains:"):
                need = c["rule"].split(":", 1)[1]
                out += [{"copy": c["id"], "repo": r, "file": f, "problem": f"lacks {need}"} for r, t in texts.items() if not t or need not in t]
    return out


def dependent_issues(cfg: dict, drifts: list[dict]) -> list[dict]:
    """The issue to open for each drift, in the repository that must change. Idempotent through the title."""
    return [{"repo": d["repo"], "title": f"fleet drift: {d['copy']} {d['problem']} in {d['file']}",
             "body": f"Found by `python3 -m foundation fleet`. Rule: {d['copy']}. Closing probe: the next fleet run reports no drift for this copy. Labels: p2."} for d in drifts]


def open_issue(cfg, api, spec: dict) -> str:
    st, rows = api("GET", f"/repos/{cfg['org']}/{spec['repo']}/issues?state=open&per_page=100")
    if st == 200 and any(i["title"] == spec["title"] for i in rows):
        return "exists"
    st, _ = api("POST", f"/repos/{cfg['org']}/{spec['repo']}/issues", {"title": spec["title"], "body": spec["body"], "labels": ["p2"]})
    return "opened" if st in (200, 201) else f"failed {st}"


def run(root=REPO, apply=False, apis: dict | None = None, repos=None) -> dict:
    cfg = load(root)
    apis = apis if apis is not None else {sid: http_api(t) for sid, t in tokens()}
    rec = {"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "apply": apply, "surfaces": {}, "queue": 0, "merges": [], "drift": [], "issues": []}
    if not apis:
        rec["error"] = "no write surface has a token in this environment; falling back to the claude-session surface (the cloud-hosted routine, deploy/loops/claude-routine.md)"
        return _log(root, rec)
    rec["surfaces"] = probe_surfaces(cfg, apis)
    best = next(iter(apis.values()))
    use = lambda r: apis.get((rec["surfaces"].get(r) or {}).get("surface")) or best
    rec["queue"] = len(queue(cfg, best, repos, root))
    for r in repos or cfg["repos"]:
        rec["merges"] += merge_lane(cfg, use(r), apply, [r])

    def read(repo, path):
        st, j = best("GET", f"/repos/{cfg['org']}/{repo}/contents/{path}")
        import base64
        return base64.b64decode(j["content"]).decode("utf-8", "replace") if st == 200 and isinstance(j, dict) and j.get("content") else None
    rec["drift"] = drift(cfg, read)
    if apply:
        rec["issues"] = [dict(i, result=open_issue(cfg, use(i["repo"]), i)) for i in dependent_issues(cfg, rec["drift"])]
    return _log(root, rec)


def _log(root, rec):
    p = Path(root) / LOG
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true"); ap.add_argument("--repo", action="append")
    a = ap.parse_args(argv)
    rec = run(apply=a.apply, repos=[x.split("/")[-1] for x in a.repo] if a.repo else None)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in rec.items() if k != "surfaces"}, indent=1))
    return 1 if rec.get("error") else 0
