# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""GH-MIRROR-1 (Rowan, 2026-11-21): the work queue is visible on GitHub. "There's not even an issues board in the ultrastable repo ... the collateral
material that managers, virtual managers would use are basically invisible through GitHub."

The canonical queue stays docs/issues/*.json (QUEUE-1: the executor, dispose and queue loops read and close those files). This module mirrors it one
way onto GitHub Issues, the pattern QNFO ran (canonical record, one-way mirror, sync label, audit row; provisional [0140]):

  - one GitHub issue per queue item, found again by the marker `<!-- us-item:ID -->` in its body; title `ID: title`
  - labels: the item's own labels plus the sync label `queue`; created on GitHub when missing
  - milestone: the item's milestone (Now, Next, Later, ...), created when missing, so the milestones page shows progress per horizon
  - state: open while the item's Status is open (or gate/shelved), closed with reason completed when the file says closed or done
  - an issue edited on GitHub is put back to the file's state on the next run: the file wins, a comment never feeds back
  - the org Project board (github/board.json) is filled by GitHub's own built-in auto-add workflow on `label:queue`, so no extra credential is needed

  python3 -m foundation ghmirror --plan            what would change (reads GitHub, writes nothing)
  python3 -m foundation ghmirror --apply [--max N] make the changes, at most N writes per run (default 120; open items first, then the newest closed)
  python3 -m foundation ghmirror --check           offline: every item maps to a valid issue shape (title, labels <= 50 chars, milestone)

Runs server-side in the `fleet` workflow (dispatched by the tick Worker) and the daily `issues` workflow, on the run's built-in token (issues: write).
Writes are capped and idempotent, so a run that stops half way is finished by the next. A repository with Issues off answers 410: the run reports
`issues-off` and exits 0, and github/org-settings.json keeps has_issues true so the settings apply turns them back on.
Consumers: .github/workflows/fleet.yml, .github/workflows/issues.yml, tests/foundation/test_ghmirror.py.
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
THIS = "ultrastable/ultrastable"
SYNC = "queue"
MARK = re.compile(r"<!-- us-item:([A-Za-z0-9._-]+) -->")
FIELD = lambda body, name: (re.search(rf"^\*\*{name}:\*\*\s*(.+)$", body or "", re.M) or [None, ""])[1].strip()
CLOSED = ("closed", "done", "fixed", "superseded", "cancelled", "canceled", "live")
MILESTONES = {"Now": "Work the executor takes first.", "Next": "Queued after Now.", "Later": "Backlog beyond Next.",
              "After filing": "Held items (historic patent track).", "Done": "Finished items kept for the record."}
COLORS = {"queue": "5319e7", "p0": "b60205", "p1": "d93f0b", "p2": "fbca04", "role:": "0e8a16", "ws:": "1d76db", "open-loop": "c5def5"}
API = "https://api.github.com"
FOOTER = ("\n\n---\nMirrored one way from [`docs/issues/{id}.json`](https://github.com/{repo}/blob/main/docs/issues/{id}.json) by `foundation/ghmirror.py` "
          "(GH-MIRROR-1). The file is the record: an edit here is put back on the next run.\n<!-- us-item:{id} -->")


def status_of(item: dict) -> str:
    s = FIELD(item.get("body", ""), "Status").lower().rstrip(":").split(" ")[0] if item.get("body") else ""
    return s or str(item.get("status") or item.get("state") or "open").lower()


def items(root=REPO) -> list[dict]:
    out = []
    for p in sorted((Path(root) / "docs/issues").glob("*.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if isinstance(j, dict) and j.get("id"):
            out.append(j)
    return out


def label_name(x: str) -> str:
    return str(x).strip()[:50]


def desired(item: dict, repo=THIS) -> dict:
    iid = str(item["id"])
    title = str(item.get("title") or iid)
    if not title.startswith(iid):
        title = f"{iid}: {title}"
    labels = sorted({label_name(x) for x in (item.get("labels") or []) if str(x).strip()} | {SYNC})
    state = "closed" if status_of(item) in CLOSED else "open"
    ms = item.get("milestone") if item.get("milestone") in MILESTONES else ("Done" if state == "closed" else "Later")
    body = str(item.get("body") or "")[:60000] + FOOTER.format(id=iid, repo=repo)
    return {"id": iid, "title": title[:250], "body": body, "labels": labels, "milestone": ms, "state": state}


def color(name: str) -> str:
    for k, v in COLORS.items():
        if name == k or (k.endswith(":") and name.startswith(k)):
            return v
    return "ededed"


class GH:
    def __init__(self, token: str, repo: str = THIS, opener=urllib.request.urlopen):
        self.token, self.repo, self.open, self.calls = token, repo, opener, 0

    def req(self, method, path, body=None):
        url = path if path.startswith("http") else API + path
        r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                   headers={"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                                            "Content-Type": "application/json", "User-Agent": "ultrastable-ghmirror"})
        self.calls += 1
        try:
            with self.open(r, timeout=60) as resp:
                t = resp.read().decode() or "null"
                return resp.status, json.loads(t), resp.headers.get("Link", "") if hasattr(resp, "headers") else ""
        except urllib.error.HTTPError as e:
            return e.code, None, ""

    def pages(self, path):
        out, url = [], path
        while url:
            st, js, link = self.req("GET", url)
            if st != 200 or not isinstance(js, list):
                return st, out
            out += js
            m = re.search(r'<([^>]+)>;\s*rel="next"', link or "")
            url = m.group(1) if m else None
        return 200, out


def plan(want: list[dict], have: list[dict], labels: set, milestones: dict) -> list[tuple]:
    """Pure diff. have: GitHub issues carrying the sync label. Returns ordered actions: labels, milestones, then per item create/update."""
    acts = []
    need_labels = sorted({l for w in want for l in w["labels"]} - labels)
    acts += [("label", l) for l in need_labels]
    acts += [("milestone", m) for m in sorted({w["milestone"] for w in want} - set(milestones))]
    by_id = {}
    for h in have:
        m = MARK.search(h.get("body") or "")
        if m and m.group(1) not in by_id:
            by_id[m.group(1)] = h
    # open items first (they are the board), then closed ones newest id last so the most recent history lands first after them
    for w in sorted(want, key=lambda w: (w["state"] != "open", w["id"])):
        h = by_id.get(w["id"])
        if not h:
            acts.append(("create", w))
            continue
        cur_labels = sorted(x["name"] for x in h.get("labels") or [])
        cur_ms = (h.get("milestone") or {}).get("title")
        if (h.get("title") != w["title"] or (h.get("body") or "") != w["body"] or cur_labels != w["labels"]
                or cur_ms != w["milestone"] or h.get("state") != w["state"]):
            acts.append(("update", w, h["number"]))
    gone = [h for k, h in by_id.items() if k not in {w["id"] for w in want} and h.get("state") == "open"]
    acts += [("orphan", h["number"]) for h in gone]
    return acts


def apply(gh: GH, acts: list[tuple], milestones: dict, max_writes=120, sleep=time.sleep) -> dict:
    res = {"created": 0, "updated": 0, "closed_orphans": 0, "labels": 0, "milestones": 0, "errors": [], "deferred": 0}
    writes = 0
    for a in acts:
        if writes >= max_writes:
            res["deferred"] += 1
            continue
        kind = a[0]
        if kind == "label":
            st, _, _ = gh.req("POST", f"/repos/{gh.repo}/labels", {"name": a[1], "color": color(a[1])})
            res["labels"] += st == 201
        elif kind == "milestone":
            st, js, _ = gh.req("POST", f"/repos/{gh.repo}/milestones", {"title": a[1], "description": MILESTONES.get(a[1], "")})
            if st == 201:
                milestones[a[1]] = js["number"]; res["milestones"] += 1
        elif kind == "create":
            w = a[1]
            st, js, _ = gh.req("POST", f"/repos/{gh.repo}/issues", {"title": w["title"], "body": w["body"], "labels": w["labels"],
                                                                  "milestone": milestones.get(w["milestone"])})
            if st == 201 and w["state"] == "closed":
                writes += 1
                st, _, _ = gh.req("PATCH", f"/repos/{gh.repo}/issues/{js['number']}", {"state": "closed", "state_reason": "completed"})
                st = 201 if st == 200 else st
            res["created"] += st == 201
            if st != 201:
                res["errors"].append(f"create {w['id']} {st}")
            sleep(1)  # GitHub's secondary limit on content creation: stay well under 80 a minute
        elif kind == "update":
            w, n = a[1], a[2]
            body = {"title": w["title"], "body": w["body"], "labels": w["labels"], "milestone": milestones.get(w["milestone"]), "state": w["state"]}
            if w["state"] == "closed":
                body["state_reason"] = "completed"
            st, _, _ = gh.req("PATCH", f"/repos/{gh.repo}/issues/{n}", body)
            res["updated"] += st == 200
            if st != 200:
                res["errors"].append(f"update {w['id']} #{n} {st}")
        elif kind == "orphan":
            st, _, _ = gh.req("PATCH", f"/repos/{gh.repo}/issues/{a[1]}", {"state": "closed", "state_reason": "not_planned"})
            res["closed_orphans"] += st == 200
        writes += 1
    return res


def run(root=REPO, token=None, repo=THIS, do_apply=False, max_writes=120, opener=urllib.request.urlopen) -> dict:
    token = token or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        return {"status": "no-token"}
    gh = GH(token, repo, opener)
    st, meta, _ = gh.req("GET", f"/repos/{repo}")
    if st != 200:
        return {"status": f"repo-read-{st}"}
    if not meta.get("has_issues", True):
        return {"status": "issues-off", "note": "Issues are off; github/org-settings.json has has_issues true and the org-settings apply turns them on"}
    want = [desired(i, repo) for i in items(root)]
    st, labels = gh.pages(f"/repos/{repo}/labels?per_page=100")
    st2, ms = gh.pages(f"/repos/{repo}/milestones?state=all&per_page=100")
    st3, have = gh.pages(f"/repos/{repo}/issues?state=all&labels={SYNC}&per_page=100")
    if 200 not in (st,) or st2 != 200 or st3 != 200:
        return {"status": "read-failed", "codes": [st, st2, st3]}
    have = [h for h in have if "pull_request" not in h]
    milestones = {m["title"]: m["number"] for m in ms}
    acts = plan(want, have, {l["name"] for l in labels}, milestones)
    out = {"status": "ok", "items": len(want), "open_items": sum(w["state"] == "open" for w in want), "mirrored": len(have),
           "pending": {k: sum(a[0] == k for a in acts) for k in ("label", "milestone", "create", "update", "orphan")}}
    if do_apply:
        out["applied"] = apply(gh, acts, milestones, max_writes)
        out["status"] = "partial" if out["applied"]["deferred"] else "ok"
    out["api_calls"] = gh.calls
    return out


def check(root=REPO) -> list[str]:
    errs, seen = [], set()
    for i in items(root):
        w = desired(i)
        if w["id"] in seen:
            errs.append(f"duplicate id {w['id']}")
        seen.add(w["id"])
        if not w["title"].strip():
            errs.append(f"{w['id']}: empty title")
        if any(len(l) > 50 or not l for l in w["labels"]):
            errs.append(f"{w['id']}: label longer than 50 characters")
    return errs


def main(argv) -> int:
    if "--check" in argv:
        errs = check()
        print("\n".join(errs) or f"ghmirror ok: {len(items())} items map to issues")
        return 1 if errs else 0
    mx = int(argv[argv.index("--max") + 1]) if "--max" in argv else 120
    res = run(do_apply="--apply" in argv, max_writes=mx)
    print(json.dumps(res, indent=1))
    # a missing token or Issues off is a recorded state, not a crash; a failed read or write errors fail the step so ciwatch files it
    if res.get("status") in ("read-failed",) or str(res.get("status", "")).startswith("repo-read"):
        return 1
    return 1 if res.get("applied", {}).get("errors") and not (res["applied"]["created"] or res["applied"]["updated"]) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
