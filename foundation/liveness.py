"""LIVENESS-1: are the autonomous code loops actually running? Ultrastable is the foundation for any autonomous system.

  python3 -m foundation liveness [--instance SLUG] [--json] [--file-items] [--check]

A closing probe in the loop registry proves that the code for a loop exists. This proves that the loop ran: for each probe in
`instances/<slug>/liveness.json` it reads the evidence the loop itself leaves (the latest GitHub Actions run of its workflow, the newest row
of its log on its evidence branch, the newest merged pull request) and gives one verdict:

  alive     evidence exists, is younger than max_age_hours and, where required, the run succeeded
  stale     evidence exists but is older than max_age_hours: the loop stopped
  failing   the latest run did not succeed
  never     no evidence at all: the loop was never started
  unknown   the evidence could not be read from here (no token, branch not fetched); never counted as alive

The headline is the system's own claim ("Ultrastable runs on Ultrastable") with the share of loops alive; it is true only when every probe
is alive. `--check` exits 1 otherwise. `--file-items` writes one queue item per loop that is not alive (docs/issues/Q-LIVE-<id>.json, owner,
trigger, probe `cmd:python3 -m foundation liveness --probe <id>`), so the executor works on restarting it, and closes nothing by hand: the
item's own probe passes when the loop is alive again. Each system declares its own probes; the list is data, not code.
"""
from __future__ import annotations
import datetime as dt, json, os, subprocess, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VERDICTS = ("alive", "stale", "failing", "never", "unknown")


def load(root=REPO, instance="ultrastable") -> dict:
    return json.loads((Path(root) / "instances" / instance / "liveness.json").read_text(encoding="utf-8"))


def _when(v) -> dt.datetime | None:
    """A timestamp from a log row: epoch seconds or an ISO string."""
    try:
        if isinstance(v, (int, float)):
            return dt.datetime.fromtimestamp(v, dt.timezone.utc)
        return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(dt.timezone.utc)
    except (ValueError, OSError, OverflowError):
        return None


def github(repo: str, token: str | None):
    """`get(path) -> (status, json)` against the GitHub API; status 0 means no token here, so the answer is unknown, never a guess."""
    def get(path):
        if not token or not repo:
            return 0, None
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}{path}", headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "ultrastable-liveness"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, None
        except (urllib.error.URLError, TimeoutError):
            return 0, None
    return get


def git_show(root):
    fetched = set()

    def show(ref, path):
        if ref.startswith("origin/") and ref not in fetched:      # evidence branches are not in a default checkout; a failed fetch reads as unknown
            fetched.add(ref)
            subprocess.run(["git", "-C", str(root), "fetch", "-q", "origin", f"{ref[7:]}:refs/remotes/{ref}"], capture_output=True, text=True, timeout=60)
        r = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{path}"], capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None
    return show


def evidence(spec: str, get, show) -> dict:
    """{'at': datetime|None, 'ok': bool|None, 'readable': bool, 'detail': str} for one evidence spec."""
    kind, _, rest = spec.partition(":")
    if kind == "workflow":
        st, j = get(f"/actions/workflows/{rest}/runs?status=completed&per_page=20")
        if st != 200:
            return {"at": None, "ok": None, "readable": False, "detail": f"GitHub API not readable from here (status {st})"}
        runs = [r for r in (j or {}).get("workflow_runs", []) if r.get("conclusion") not in ("skipped", "cancelled")]
        if not runs:
            return {"at": None, "ok": None, "readable": True, "detail": f"{rest} has no completed run"}
        r = runs[0]
        return {"at": _when(r.get("updated_at")), "ok": r.get("conclusion") == "success", "readable": True, "detail": f"{rest} run {r.get('run_number')} {r.get('conclusion')}"}
    if kind == "merged-pr":
        st, j = get("/pulls?state=closed&sort=updated&direction=desc&per_page=30")
        if st != 200:
            return {"at": None, "ok": None, "readable": False, "detail": f"GitHub API not readable from here (status {st})"}
        merged = sorted((p for p in j or [] if p.get("merged_at")), key=lambda p: p["merged_at"], reverse=True)
        if not merged:
            return {"at": None, "ok": None, "readable": True, "detail": "no merged pull request"}
        return {"at": _when(merged[0]["merged_at"]), "ok": True, "readable": True, "detail": f"pull request {merged[0]['number']} merged"}
    if kind == "jsonl":
        ref, path, field = rest.split(":", 2)
        text = show(ref, path)
        if text is None:
            return {"at": None, "ok": None, "readable": False, "detail": f"{path} not readable on {ref} (branch not fetched or file missing)"}
        times = []
        for line in text.splitlines():
            try:
                t = _when(json.loads(line).get(field))
            except (ValueError, AttributeError):
                continue
            if t:
                times.append(t)
        if not times:
            return {"at": None, "ok": None, "readable": True, "detail": f"{path} on {ref} has no dated row"}
        return {"at": max(times), "ok": True, "readable": True, "detail": f"{len(times)} rows in {path} on {ref}"}
    raise ValueError(f"unknown evidence kind {kind!r}")


def verdict(p: dict, ev: dict, now: dt.datetime) -> dict:
    age = round((now - ev["at"]).total_seconds() / 3600, 1) if ev["at"] else None
    if not ev["readable"]:
        v = "unknown"
    elif ev["at"] is None:
        v = "never"
    elif age > p["max_age_hours"]:
        v = "stale"
    elif p.get("must_succeed") and ev["ok"] is False:
        v = "failing"
    else:
        v = "alive"
    return {"id": p["id"], "loop": p["loop"], "what": p["what"], "verdict": v, "age_hours": age, "max_age_hours": p["max_age_hours"], "evidence": p["evidence"], "detail": ev["detail"]}


def run(root=REPO, instance="ultrastable", now=None, get=None, show=None) -> dict:
    root = Path(root); d = load(root, instance)
    now = now or dt.datetime.now(dt.timezone.utc)
    get = get or github(os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    show = show or git_show(root)
    rows = [verdict(p, evidence(p["evidence"], get, show), now) for p in d["probes"]]
    alive = sum(r["verdict"] == "alive" for r in rows)
    share = alive / len(rows) if rows else 0.0
    return {"schema": "ultrastable-liveness/1", "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "system": d["system"], "claim": d["claim"],
            "claim_holds": bool(rows) and share >= d["alive_share_required"], "alive": alive, "total": len(rows), "probes": rows}


def check(root=REPO, instance="ultrastable") -> list[str]:
    """Static part, run in the doctrine of every PR: each probe names a registered loop, a known evidence kind and an age bound."""
    root, bad = Path(root), []
    d = load(root, instance)
    loops = {l["id"] for l in json.loads((root / "instances" / instance / "loop-registry.json").read_text(encoding="utf-8"))["loops"]}
    seen = set()
    for p in d["probes"]:
        if p["id"] in seen:
            bad.append(f"liveness probe {p['id']} is defined twice")
        seen.add(p["id"])
        if p["loop"] not in loops:
            bad.append(f"liveness probe {p['id']}: loop {p['loop']} is not in the loop registry")
        if p["evidence"].split(":", 1)[0] not in ("workflow", "jsonl", "merged-pr"):
            bad.append(f"liveness probe {p['id']}: unknown evidence kind in {p['evidence']!r}")
        if p["evidence"].startswith("workflow:") and not (root / ".github/workflows" / p["evidence"].split(":", 1)[1]).is_file():
            bad.append(f"liveness probe {p['id']}: workflow {p['evidence'].split(':', 1)[1]} does not exist")
        if not isinstance(p.get("max_age_hours"), (int, float)) or p["max_age_hours"] <= 0:
            bad.append(f"liveness probe {p['id']}: needs max_age_hours > 0")
    if not d["probes"]:
        bad.append("liveness: no probes; a system that claims to run on itself declares what must be running")
    return bad


def file_items(root, rep: dict) -> list[str]:
    """One queue item per loop that is provably not alive (stale, failing, never). Unknown files nothing: no evidence was read."""
    root, made = Path(root), []
    for r in rep["probes"]:
        if r["verdict"] not in ("stale", "failing", "never"):
            continue
        p = root / "docs/issues" / f"Q-LIVE-{r['id']}.json"
        if p.exists():
            continue
        body = (f"**Owner:** operations\n**Trigger:** liveness probe {r['id']} reported {r['verdict']} at {rep['at']}\n"
                f"**Done check:** cmd:python3 -m foundation liveness --probe {r['id']}\n**Status:** open\n\n"
                f"The loop `{r['loop']}` ({r['what']}) is not running: {r['verdict']}, {r['detail']}"
                + (f", last evidence {r['age_hours']} h ago (limit {r['max_age_hours']} h)" if r["age_hours"] is not None else "")
                + f". Evidence source: `{r['evidence']}`. Find why it stopped or never started, start it on a server-side host, and leave the fix in code. The item closes when its probe reports alive.")
        p.write_text(json.dumps({"id": f"Q-LIVE-{r['id']}", "title": f"Q-LIVE-{r['id']}: loop {r['loop']} is {r['verdict']}", "body": body,
                                 "labels": ["role:operations", "liveness"], "milestone": "Now", "workstream": "Open loops"}, indent=2) + "\n", encoding="utf-8")
        made.append(p.relative_to(root).as_posix())
    return made


def main(argv: list[str]) -> int:
    inst = argv[argv.index("--instance") + 1] if "--instance" in argv else "ultrastable"
    if "--static" in argv:
        bad = check(REPO, inst); print("\n".join(bad) or "liveness probes ok"); return 1 if bad else 0
    rep = run(REPO, inst)
    if "--probe" in argv:
        r = next((x for x in rep["probes"] if x["id"] == argv[argv.index("--probe") + 1]), None)
        print(json.dumps(r)); return 0 if r and r["verdict"] == "alive" else 1
    if "--json" in argv:
        print(json.dumps(rep, indent=1))
    else:
        for r in rep["probes"]:
            age = f"{r['age_hours']} h ago" if r["age_hours"] is not None else "no evidence"
            print(f"{r['verdict']:8} {r['id']:16} {age:14} (limit {r['max_age_hours']} h)  {r['detail']}")
        print(f"{rep['claim']}: {'yes' if rep['claim_holds'] else 'not yet'} ({rep['alive']} of {rep['total']} loops alive)")
    if "--file-items" in argv:
        made = file_items(REPO, rep)
        print("queue items filed:", ", ".join(made) or "none")
    return 1 if "--check" in argv and not rep["claim_holds"] else 0
