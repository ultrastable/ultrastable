"""FAILURE-AUDIT-1 (owner, 2026-11-12) + FAILURE-RESOLVE-1 (owner, 2026-11-21): the system audits every failure mode it has registered and
resolves each finding through its own queue.

doctrine/registers.json lists failure modes, but its probes only prove a test exists. This module runs a live detector for each failure mode
(doctrine/detectors.json: a command, an https reading or a file/grep probe, what the suspected root cause is, the owner and the remedy). Every run:

  - appends one line per detector to ops/failure-audit.jsonl with the commit it ran on (passes too: absence of findings is not absence of probing),
  - for a failing detector writes ONE queue item docs/issues/Q-AUDIT-<id>.json. The id is in foundation/queue.items, so the executor takes it,
    and its done check is `cmd:python3 -m foundation failure_audit --probe <id>`, so the closing-probe contracts close it. Measured 2026-11-21:
    the older AUDIT-<id>.json name matched no queue pattern, its done check `detector:<id>` was no probe kind and the files lived only on branch
    audit-evidence, so two detectors failed five daily runs with nothing taking them,
  - root cause: the item names the files changed between the last commit the detector passed on and this one, and the repository files its
    evidence names, so the executor is shown the suspects and not only a symptom,
  - loop-breaker (guiding directive section 2): the same signature failing twice marks the item `mutate` (change the approach, do not retry),
    three times marks it `incident` (redesign, no fourth attempt of the same fix),
  - when a detector passes again, the item is closed with the passing evidence, never deleted (nothing drops silently),
  - writes ops/failure-audit-state.json (status, signature, streak and first failing time per detector), which changes only when a status does.

  python3 -m foundation failure_audit --run [--only ID,ID] [--no-issues]   execute detectors, update ledger, state and queue items
  python3 -m foundation failure_audit --probe ID                          closing probe of Q-AUDIT-<ID>: exit 0 when the detector passes
  python3 -m foundation failure_audit --coverage                          failure modes and the detectors that watch them, as JSON
  python3 -m foundation failure_audit --check                             registry valid; every failure mode has a live detector

Detectors are argv lists run without a shell. Nothing here handles secret values. A detector that cannot run (missing tool) is recorded as
`unavailable`, which is itself an audit finding, not a pass.
"""
from __future__ import annotations
import hashlib, json, re, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DETECTORS = "doctrine/detectors.json"
LEDGER = "ops/failure-audit.jsonl"
STATE = "ops/failure-audit-state.json"
ISSUES = "docs/issues"
KINDS = ("command", "http", "probe")
LIVE_PROBE_S = 45  # the queue runs a closing probe for at most 60 s; a slower detector is answered from the state its last run wrote
NOISE = ("ops/", "docs/issues/", "site/roadmap-data.js", "site/pins.js")  # written by loops on every pass; never the cause of a regression
PATH_RX = re.compile(r"[\w][\w./-]*\.(?:py|js|mjs|json|yml|yaml|sh|md|sql|toml)\b")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DETECTORS).read_text(encoding="utf-8"))


def item_id(did: str) -> str:
    return f"Q-AUDIT-{did}"


def coverage(root=REPO) -> dict:
    """Every registered failure mode and the detectors that watch it. A mode with an empty list is audited by nothing."""
    root = Path(root)
    modes = [m["id"] for m in json.loads((root / "doctrine/registers.json").read_text(encoding="utf-8"))["failure_modes"]]
    cov = {m: [] for m in modes}
    for x in load(root)["detectors"]:
        if x.get("failure_mode") in cov:
            cov[x["failure_mode"]].append(x.get("id", "?"))
    return cov


def check(root=REPO) -> list[str]:
    root = Path(root)
    problems, d = [], load(root)
    cov = coverage(root)
    seen = set()
    for x in d["detectors"]:
        i = x.get("id", "?")
        if i in seen:
            problems.append(f"{i}: duplicate detector id")
        seen.add(i)
        for k in ("id", "failure_mode", "kind", "root_cause", "owner", "remedy"):
            if not x.get(k):
                problems.append(f"{i}: missing {k}")
        if x.get("kind") == "command" and not (isinstance(x.get("run"), list) and x["run"]):
            problems.append(f"{i}: command detector needs a run argv list")
        if x.get("kind") == "http" and not str(x.get("url", "")).startswith("https://"):
            problems.append(f"{i}: http detector needs an https url")
        if x.get("kind") == "probe" and not str(x.get("spec", "")).startswith(("file:", "grep:")):
            problems.append(f"{i}: probe detector needs a file: or grep: spec")
        if x.get("kind") not in KINDS:
            problems.append(f"{i}: unknown kind {x.get('kind')}")
        if x.get("failure_mode") and x["failure_mode"] not in cov:
            problems.append(f"{i}: failure_mode {x['failure_mode']} is not in doctrine/registers.json")
    for mode, dets in cov.items():  # FAILURE-RESOLVE-1: a registered failure mode nothing watches is unaudited, which is a failure of the audit
        if not dets:
            problems.append(f"{mode}: no live detector in {DETECTORS}")
    for did, st in _state(root).items():  # a recorded failure nothing can take is the open half of the loop this module exists to close
        if st.get("status") != "pass":
            ip = root / ISSUES / f"{item_id(did)}.json"
            if not ip.exists() or "**Status:** open" not in json.loads(ip.read_text(encoding="utf-8")).get("body", ""):
                problems.append(f"{did}: recorded as {st.get('status')} with no open {item_id(did)} in {ISSUES}")
    wf = root / ".github/workflows" / d.get("workflow", "")
    if not wf.exists():
        problems.append(f"workflow {d.get('workflow')} is missing")
    return problems


def run_detector(x: dict, root=REPO) -> dict:
    t0 = time.time()
    try:
        if x["kind"] == "http":
            req = urllib.request.Request(x["url"], headers={"User-Agent": "ultrastable-failure-audit/1.0"})  # the default urllib agent is blocked at the edge
            with urllib.request.urlopen(req, timeout=x.get("timeout", 15)) as r:  # nosec: https only, checked above
                body = r.read(20000).decode("utf-8", "replace")
                ok = 200 <= r.status < 300 and (not x.get("json_ok") or json.loads(body).get("ok") is True)
                out = f"HTTP {r.status} {body[:200]}"
        elif x["kind"] == "probe":
            from . import selfhost
            ok = selfhost.probe(root, x["spec"])
            out = f"{x['spec']} {'matches' if ok else 'does not match'}"
        else:
            cwd = Path(root) / x.get("cwd", ".")
            argv = []
            for a in x["run"]:  # no shell: expand globs here so the same detector runs on every host
                argv += sorted(m.relative_to(cwd).as_posix() for m in cwd.glob(a)) if "*" in a else [a]
            if argv[0] == "python3":  # the interpreter running the audit, so a host that names it differently still audits
                argv[0] = sys.executable
            p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=x.get("timeout", 300))
            ok, out = p.returncode == 0, (p.stdout + p.stderr)[-600:]
        status = "pass" if ok else "fail"
    except FileNotFoundError as e:
        status, out = "unavailable", f"tool missing: {e}"
    except subprocess.TimeoutExpired:
        status, out = "fail", "timeout"
    except Exception as e:  # recorded, not swallowed: it becomes a finding
        status, out = "fail", f"{type(e).__name__}: {e}"
    sig = hashlib.sha256(out.strip().splitlines()[-1].encode() if out.strip() else b"empty").hexdigest()[:12]
    return {"id": x["id"], "status": status, "signature": sig, "evidence": out[-300:], "seconds": round(time.time() - t0, 1)}


def history(root, did) -> list[dict]:
    p = Path(root) / LEDGER
    if not p.exists():
        return []
    rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    return [r for r in rows if r["id"] == did]


def _git(root, *a) -> str:
    try:
        r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def suspects(root, prev: list[dict], evidence: str, head: str) -> dict:
    """Root-cause evidence for a failing detector: what changed since the last commit it passed on, and the repository files its output names."""
    root = Path(root)
    since = next((r.get("commit", "") for r in reversed(prev) if r["status"] == "pass" and r.get("commit")), "")
    changed = []
    if since and head and since != head:
        changed = [f for f in _git(root, "diff", "--name-only", since, head).splitlines() if f and not f.startswith(NOISE)]
    named = sorted({m for m in PATH_RX.findall(evidence) if (root / m).is_file()})
    return {"since": since, "changed": changed[:12], "changed_total": len(changed), "named": named[:8]}


def _mode(streak: int) -> str:
    return "incident" if streak >= 3 else "mutate" if streak == 2 else "fix"


def _issue(x: dict, res: dict, streak: int, sus: dict, since_at: str) -> dict:
    mode = _mode(streak)
    cause = ""
    if sus["changed"]:
        more = f" (and {sus['changed_total'] - len(sus['changed'])} more)" if sus["changed_total"] > len(sus["changed"]) else ""
        cause += f"Changed since the last passing commit {sus['since'][:10]}: " + ", ".join(f"`{f}`" for f in sus["changed"]) + more + "\n"
    elif sus["since"]:
        cause += f"No code changed since the last passing commit {sus['since'][:10]}: suspect the environment, a clock or an outside service before the code.\n"
    if sus["named"]:
        cause += "Files the evidence names: " + ", ".join(f"`{f}`" for f in sus["named"]) + "\n"
    body = (f"**Owner:** {x['owner']}\n**Trigger:** the daily failure audit files it; the executor takes it in driver order\n"
            f"**Done check:** cmd:python3 -m foundation failure_audit --probe {x['id']}\n**Status:** open\n\n"
            f"Failure mode `{x['failure_mode']}` detected by `{x['id']}`, failing since {since_at}.\nEvidence: {res['evidence']}\n"
            f"Signature: {res['signature']} (disposition: {mode}).\n"
            f"Suspected root cause: {x['root_cause']}\n{cause}Remedy: {x['remedy']}\n"
            "Fix the earliest cause, so the detector passes; do not weaken or remove the detector.\n"
            + ("Same signature twice: do not retry the same fix, change the approach (guiding directive section 2).\n" if mode == "mutate" else "")
            + ("Three identical failures: this is an incident. Redesign the failing part; a fourth attempt of the same fix is not allowed.\n" if mode == "incident" else "")
            + f"\n**Closing probe:** cmd:python3 -m foundation failure_audit --probe {x['id']}\n")
    return {"id": item_id(x["id"]), "title": f"{item_id(x['id'])}: {x['failure_mode']} failing ({res['status']}): {x['remedy']}"[:240], "body": body,
            "labels": [f"role:{x['owner']}", "audit", mode, "agent-ready", "p1"], "milestone": "Now", "workstream": "Failure modes"}


def _same_open_finding(path: Path, sig: str, mode: str) -> bool:
    """True when the item on disk already carries this signature and disposition and is open: rewriting it would only churn the file."""
    if not path.exists():
        return False
    j = json.loads(path.read_text(encoding="utf-8"))
    return "**Status:** open" in j.get("body", "") and f"Signature: {sig} " in j.get("body", "") and mode in j.get("labels", [])


def _close(path: Path, res: dict) -> bool:
    j = json.loads(path.read_text(encoding="utf-8"))
    if "**Status:** open" not in j.get("body", ""):
        return False
    j["body"] = j["body"].replace("**Status:** open", "**Status:** closed") + f"\n**Evidence:** detector passed at {res['at']} on commit {res.get('commit', '')[:10] or 'unknown'}: {res['evidence'][:160].strip()}\n"
    path.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
    return True


def _state(root) -> dict:
    p = Path(root) / STATE
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def run(root=REPO, only=None, issues=True, now=None) -> list[dict]:
    root = Path(root)
    d = load(root)
    results = []
    (root / "ops").mkdir(exist_ok=True)
    head, state = _git(root, "rev-parse", "HEAD"), _state(root)
    for x in d["detectors"]:
        if only and x["id"] not in only:
            continue
        res = run_detector(x, root)
        prev = history(root, x["id"])
        streak = 0
        if res["status"] != "pass":
            streak = 1
            for r in reversed(prev):
                if r["status"] != "pass" and r["signature"] == res["signature"]:
                    streak += 1
                else:
                    break
        res["streak"] = streak
        res["at"] = now or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        res["commit"] = head
        was = state.get(x["id"], {})
        since_at = was.get("since") if was.get("status", "pass") != "pass" and res["status"] != "pass" else res["at"]
        ipath = root / ISSUES / f"{item_id(x['id'])}.json"
        if issues:
            for old in (root / ISSUES / f"AUDIT-{x['id']}.json", root / ISSUES / f"AUDIT-{x['id']}-incident.json"):  # the names no queue pattern matched
                if old.exists():
                    old.unlink()
        if issues and res["status"] != "pass":
            sus = suspects(root, prev, res["evidence"], head)
            res["suspects"] = sus["changed"] + [n for n in sus["named"] if n not in sus["changed"]]
            if not _same_open_finding(ipath, res["signature"], _mode(streak)):
                ipath.parent.mkdir(parents=True, exist_ok=True)
                ipath.write_text(json.dumps(_issue(x, res, streak, sus, since_at), indent=2) + "\n", encoding="utf-8")
            res["disposition"] = "filed" if streak == 1 else _mode(streak)
        elif issues and res["status"] == "pass":
            res["disposition"] = "recovered" if ipath.exists() and _close(ipath, res) else "clean"
        with (root / LEDGER).open("a", encoding="utf-8") as f:
            f.write(json.dumps(res) + "\n")
        row = {"status": res["status"], "signature": res["signature"] if res["status"] != "pass" else "", "streak": streak, "since": since_at if res["status"] != "pass" else ""}
        if was != row:
            state[x["id"]] = row
        results.append(res)
    live = {x["id"] for x in d["detectors"]}
    state = {k: v for k, v in sorted(state.items()) if k in live}  # a removed detector leaves the state with its registry row
    text = json.dumps(state, indent=1) + "\n"
    sp = root / STATE
    if not sp.exists() or sp.read_text(encoding="utf-8") != text:
        sp.write_text(text, encoding="utf-8")
    return results


def probe(did: str, root=REPO) -> tuple[bool, str]:
    """Closing probe of Q-AUDIT-<did>. A detector that fits in the queue's probe time is run now; a slower one is answered from the state
    its last full run wrote, so a fix is confirmed by the next audit and never by a guess."""
    root = Path(root)
    x = next((x for x in load(root)["detectors"] if x["id"] == did), None)
    if x is None:
        return False, f"no detector {did}"
    if x.get("timeout", 300 if x["kind"] == "command" else 15) <= LIVE_PROBE_S:
        res = run_detector(x, root)
        return res["status"] == "pass", f"live {res['status']}: {res['evidence'][-120:].strip()}"
    st = _state(root).get(did)
    if not st:
        return False, f"{did}: no recorded run yet"
    return st["status"] == "pass", f"last audit {st['status']}" + (f" since {st['since']}" if st.get("since") else "")


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        p = check()
        print("failure-audit ok" if not p else "\n".join(p))
        return 1 if p else 0
    if "--coverage" in a:
        print(json.dumps(coverage(), indent=1))
        return 0
    if "--probe" in a:
        ok, why = probe(a[a.index("--probe") + 1])
        print(why)
        return 0 if ok else 1
    if "--run" in a:
        only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
        rs = run(only=only, issues="--no-issues" not in a)
        if "--no-issues" not in a and only is None:  # ROOTCAUSE-1: the same daily pass names the root cause of what the detectors found and escalates recurrence
            from . import rootcause
            print("rootcause store:", rootcause.sync())
            print("rootcause", json.dumps(rootcause.run()["actions"]))
            print("rootcause store:", rootcause.push())
        for r in rs:
            print(f"{r['status']:<11} {r['id']:<22} {r.get('disposition', '')} {r['evidence'][:90]!r}")
        return 1 if any(r["status"] != "pass" for r in rs) else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
