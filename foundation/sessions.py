"""SESSION-CLOSE-1 and STRANGE-LOOP-1 as code (owner, 2026-11-12): the system closes its own loops and resolves its own threads and sessions,
there is never a zombie idle session, and every loop gets better each time it closes.

A session is any unit of agent work that holds state outside main: an `agent/*` or `claude/*` branch, with or without an open pull request.
A zombie is a session with no activity for longer than `idle_ttl_hours` (doctrine/sessions.json). Every zombie leaves the active set with a
recorded disposition, never silently (GUIDING-DIRECTIVE section 6):

  close-superseded  the branch has nothing main lacks: close its PR (reversible: the sha is in the ledger) and delete the branch
  lane-merge        it has work and its checks pass: marked for the merge lane, which merges it (scripts/lane.sh)
  backlog           it has work that is not ready: one backlog issue (owner, trigger, closing probe) the executor drains, and the branch is parked as parked/<name> (sha kept, reversible)

The strange loop: after every scan, `meta` reads the ledger of the loop's own past scans, grades the prediction attached to its last change to
its own parameters (keep it if zombies fell to 0, otherwise revert it and never retry that value), and, if zombies persisted, tightens the
idle TTL and records a new prediction. The reaper also scans its own branch, so it is reaped by the same rule it enforces.

  python3 -m foundation sessions --scan [--json]    list zombies and the planned disposition (read-only)
  python3 -m foundation sessions --apply            execute dispositions, append the ledger, then run meta
  python3 -m foundation sessions --meta             grade the last self-change and propose the next one
  python3 -m foundation sessions --check            policy is valid, the loop is registered, the ledger parses (no wall-clock assertions)

Two routes (no single route): GitHub (`gh pr list`) and plain git (`git for-each-ref`); with `gh` missing, the git route alone still finds and
resolves zombies. Nothing here handles secrets.
"""
from __future__ import annotations
import json, re, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY = "doctrine/sessions.json"
LEDGER = "ops/session-ledger.jsonl"
REGISTRY = "instances/ultrastable/loop-registry.json"
LOOP_ID = "branch-reaper"
PREFIXES = ("agent/", "claude/")


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def _write_policy(root, pol: dict) -> None:
    (Path(root) / POLICY).write_text(json.dumps(pol, indent=1) + "\n", encoding="utf-8", newline="\n")


def _run(root, *cmd):
    try:
        p = subprocess.run(list(cmd), cwd=root, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)
    return p.returncode, (p.stdout if p.returncode == 0 else p.stderr or p.stdout)


def collect(root=REPO) -> list[dict]:
    """Sessions as data: git route first (always available), GitHub route adds PR number, draft flag and check state."""
    root = Path(root)
    rc, out = _run(root, "git", "for-each-ref", "--format=%(refname:short)|%(committerdate:unix)|%(objectname)", "refs/remotes/origin")
    items = {}
    if rc == 0:
        for line in out.splitlines():
            ref, ts, sha = (line.split("|") + ["", ""])[:3]
            name = ref[len("origin/"):] if ref.startswith("origin/") else ref
            if not name.startswith(PREFIXES):
                continue
            rc2, n = _run(root, "git", "rev-list", "--count", f"origin/main..{ref}")
            items[name] = {"name": name, "last_activity": int(ts or 0), "sha": sha, "ahead": int(n.strip() or 0) if rc2 == 0 else 1, "pr": None, "draft": None, "checks": "unknown"}
    rc, out = _run(root, "git", "worktree", "list", "--porcelain")
    if rc == 0:  # a branch checked out in a worktree has a live session on this machine: never a zombie
        for line in out.splitlines():
            if line.startswith("branch refs/heads/") and line[18:] in items:
                items[line[18:]]["last_activity"] = int(time.time())
    rc, out = _run(root, "gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,headRefName,isDraft,updatedAt,statusCheckRollup")
    if rc == 0:
        try:
            for pr in json.loads(out or "[]"):
                it = items.get(pr["headRefName"])
                if not it:
                    continue
                roll = pr.get("statusCheckRollup") or []
                states = {c.get("conclusion") or c.get("state") for c in roll}
                it.update(pr=pr["number"], draft=pr.get("isDraft"), checks="pass" if roll and states <= {"SUCCESS", "NEUTRAL", "SKIPPED"} else ("fail" if states & {"FAILURE", "ERROR", "TIMED_OUT"} else "pending"))
        except (ValueError, KeyError):
            pass
    return sorted(items.values(), key=lambda i: i["name"])


def classify(items: list[dict], now: float, pol: dict) -> dict:
    """Pure function: which sessions are live, which are zombies, and what happens to each zombie."""
    ttl = float(pol["idle_ttl_hours"]) * 3600
    live, zombies = [], []
    for it in items:
        age = now - it["last_activity"]
        if age <= ttl:
            live.append(it["name"])
            continue
        if it.get("ahead", 1) == 0:
            action = "close-superseded"
        elif it.get("pr") and it.get("checks") == "pass":
            action = "lane-merge"
        else:
            action = "backlog"
        zombies.append({**it, "age_hours": round(age / 3600, 1), "action": action})
    return {"entered": len(items), "live": live, "zombies": zombies}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]


def backlog_item(z: dict, pol: dict) -> dict:
    return {"id": f"ZOMBIE-{_slug(z['name'])}", "title": f"ZOMBIE-{_slug(z['name'])}: finish or retire {z['name']}",
            "body": f"**Owner:** {pol['backlog_owner']}\n**Trigger:** session idle {z['age_hours']} h (ttl {pol['idle_ttl_hours']} h)\n**Status:** open\n\n"
                    f"Branch `{z['name']}` at {z['sha'][:10]} has work main lacks and no live session. Finish it, or supersede it with evidence. "
                    f"Closing probe: `git rev-list --count origin/main..parked/{z['name']}` is 0 or the work is merged. The reaper parked the branch as parked/{z['name']}; "
                    f"the sha above holds the work.",
            "labels": ["role:" + pol["backlog_owner"], "ws:sessions"], "milestone": "Now", "workstream": "Operations"}


def apply(root=REPO, now=None, dry=False) -> dict:
    root, now = Path(root), now or time.time()
    pol = policy(root)
    res = classify(collect(root), now, pol)
    done = []
    for z in res["zombies"]:
        a = z["action"]
        if a == "close-superseded":
            if z.get("pr") and not dry:
                _run(root, "gh", "pr", "close", str(z["pr"]), "--comment", f"Closed by the session reaper: nothing here that main lacks (sha {z['sha']}).", "--delete-branch")
            elif not dry:
                _run(root, "git", "push", "origin", "--delete", z["name"])
        elif a == "backlog":
            p = root / "docs/issues" / (backlog_item(z, pol)["id"] + ".json")
            if not dry:
                # park, never lose: the sha moves to parked/<name> (not scanned), then the active ref is released; reversible by pushing the sha back
                _run(root, "git", "push", "origin", f"{z['sha']}:refs/heads/parked/{z['name']}")
                _run(root, "git", "push", "origin", "--delete", z["name"])
                p.write_text(json.dumps(backlog_item(z, pol), indent=2) + "\n", encoding="utf-8", newline="\n")
        # lane-merge: the merge lane merges it; the reaper only marks the disposition (and never merges by itself)
        done.append({"name": z["name"], "sha": z["sha"], "action": a, "age_hours": z["age_hours"]})
    rec = {"at": int(now), "entered": res["entered"], "live": len(res["live"]), "zombies": len(done), "dispositions": done,
           "invariant": res["entered"] == len(res["live"]) + len(done), "dry": dry}
    if not dry:
        with (root / LEDGER).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(rec) + "\n")
    return rec


def ledger(root=REPO) -> list[dict]:
    p = Path(root) / LEDGER
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []


def meta(root=REPO, write=True) -> dict:
    """The strange loop: the reaper improves its own parameter from its own history, with a graded prediction."""
    pol, led = policy(root), ledger(root)
    out = {"ttl_hours": pol["idle_ttl_hours"], "change": None}
    if not led:
        return out
    latest = led[-1]
    hist = pol.setdefault("history", [])
    last = hist[-1] if hist else None
    if last and last.get("grade") is None and last.get("scans_at_change", 0) < len(led):
        if latest["zombies"] == 0:
            last["grade"] = "kept"
        else:
            last["grade"] = "reverted"
            pol["idle_ttl_hours"] = last["from"]
            pol.setdefault("blocked_values", []).append(last["to"])
        out["graded"] = {"change": f"{last['from']}->{last['to']}", "grade": last["grade"]}
    elif last is None or last.get("grade") is not None:
        persistent = len(led) >= 2 and led[-1]["zombies"] > 0 and led[-2]["zombies"] > 0
        new = max(pol["ttl_floor_hours"], round(pol["idle_ttl_hours"] / 2, 2))
        if persistent and new < pol["idle_ttl_hours"] and new not in pol.get("blocked_values", []):
            hist.append({"at": latest["at"], "from": pol["idle_ttl_hours"], "to": new, "prediction": "zombies == 0 on the next scan",
                         "scans_at_change": len(led), "grade": None})
            pol["idle_ttl_hours"] = new
            out["change"] = {"from": hist[-1]["from"], "to": new, "prediction": hist[-1]["prediction"]}
    out["ttl_hours"] = pol["idle_ttl_hours"]
    if write:
        _write_policy(root, pol)
    return out


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        pol = policy(root)
    except (OSError, ValueError) as e:
        return [f"{POLICY}: {e}"]
    for k in ("idle_ttl_hours", "ttl_floor_hours", "backlog_owner"):
        if k not in pol:
            bad.append(f"{POLICY}: lacks {k}")
    if not bad and not (0 < pol["ttl_floor_hours"] <= pol["idle_ttl_hours"]):
        bad.append(f"{POLICY}: need 0 < ttl_floor_hours <= idle_ttl_hours")
    reg = json.loads((root / REGISTRY).read_text(encoding="utf-8"))
    if LOOP_ID not in {l.get("id") for l in reg["loops"]}:
        bad.append(f"{REGISTRY}: loop {LOOP_ID} is not registered (a session loop that is not in the registry is an open loop)")
    try:
        ledger(root)
    except ValueError as e:
        bad.append(f"{LEDGER}: {e}")
    return bad


def main(argv) -> int:
    root = REPO
    if "--check" in argv:
        bad = check(root)
        print("\n".join(bad) if bad else "sessions ok")
        return 1 if bad else 0
    if "--meta" in argv:
        print(json.dumps(meta(root), indent=1))
        return 0
    if "--apply" in argv:
        rec = apply(root)
        m = meta(root)
        print(json.dumps({"scan": rec, "meta": m}, indent=1))
        return 0 if rec["invariant"] else 1
    res = classify(collect(root), time.time(), policy(root))
    if "--json" in argv:
        print(json.dumps(res, indent=1))
    else:
        print(f"{res['entered']} sessions, {len(res['live'])} live, {len(res['zombies'])} zombie")
        for z in res["zombies"]:
            print(f"  {z['name']}: idle {z['age_hours']} h, ahead {z['ahead']}, -> {z['action']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
