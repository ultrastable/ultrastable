"""FAILURE-AUDIT-1 (owner, 2026-11-12): the system continuously audits and remediates its own failure modes and their root causes.

doctrine/registers.json lists failure modes, but its probes only prove a test exists. This module runs a live detector for each failure mode
(doctrine/detectors.json: a command, what a pass looks like, the suspected root cause, the owner and the remedy). Every run:

  - appends one line per detector to ops/failure-audit.jsonl (passes too: absence of findings is not absence of probing),
  - for a failing detector writes ONE backlog issue docs/issues/AUDIT-<id>.json (owner, trigger, done check = the detector itself, root cause),
    which the executor drains; the issue is never duplicated and carries the failure signature,
  - loop-breaker (guiding directive section 2): the same signature failing twice marks the issue `mutate` (change the approach, do not retry),
    three times marks it `incident` and files AUDIT-<id>-incident asking for a redesign rather than a fourth attempt,
  - when a detector passes again, the issue file gets a recorded disposition `recovered` in the ledger and is removed (nothing drops silently).

  python3 -m foundation failure_audit --run [--only ID,ID] [--no-issues]   execute detectors, update ledger and issues
  python3 -m foundation failure_audit --check                             registry valid; every detector maps to a failure mode and a workflow

Detectors are argv lists run without a shell. Nothing here handles secret values. A detector that cannot run (missing tool) is recorded as
`unavailable`, which is itself an audit finding, not a pass.
"""
from __future__ import annotations
import hashlib, json, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DETECTORS = "doctrine/detectors.json"
LEDGER = "ops/failure-audit.jsonl"
ISSUES = "docs/issues"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DETECTORS).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root = Path(root)
    problems, d = [], load(root)
    modes = {m["id"] for m in json.loads((root / "doctrine/registers.json").read_text(encoding="utf-8"))["failure_modes"]}
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
        if x.get("kind") not in ("command", "http"):
            problems.append(f"{i}: unknown kind {x.get('kind')}")
        if x.get("failure_mode") and x["failure_mode"] not in modes:
            problems.append(f"{i}: failure_mode {x['failure_mode']} is not in doctrine/registers.json")
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
        else:
            cwd = Path(root) / x.get("cwd", ".")
            argv = []
            for a in x["run"]:  # no shell: expand globs here so the same detector runs on every host
                argv += sorted(m.relative_to(cwd).as_posix() for m in cwd.glob(a)) if "*" in a else [a]
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


def _issue(x: dict, res: dict, streak: int, suffix="") -> dict:
    mode = "incident" if streak >= 3 else "mutate" if streak == 2 else "fix"
    body = (f"**Owner:** {x['owner']}\n**Trigger:** every executor run and the daily failure audit\n**Done check:** detector:{x['id']} passes\n**Status:** open\n\n"
            f"Failure mode `{x['failure_mode']}` detected by `{x['id']}`.\nEvidence: {res['evidence']}\nSignature: {res['signature']} (failed {streak} run(s) in a row; disposition: {mode}).\n"
            f"Suspected root cause: {x['root_cause']}\nRemedy: {x['remedy']}\n"
            + ("Same signature twice: do not retry the same fix, change the approach (guiding directive section 2).\n" if mode == "mutate" else "")
            + ("Three identical failures: open an incident and redesign; a fourth attempt of the same fix is not allowed.\n" if mode == "incident" else ""))
    return {"id": f"AUDIT-{x['id']}{suffix}", "title": f"AUDIT-{x['id']}{suffix}: {x['failure_mode']} failing ({res['status']}): {x['remedy']}"[:240], "body": body,
            "labels": [f"role:{x['owner']}", "audit", mode], "milestone": "Now", "workstream": "Failure modes"}


def run(root=REPO, only=None, issues=True, now=None) -> list[dict]:
    root = Path(root)
    d = load(root)
    results = []
    (root / "ops").mkdir(exist_ok=True)
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
        ipath = root / ISSUES / f"AUDIT-{x['id']}.json"
        if issues and res["status"] != "pass":
            ipath.parent.mkdir(parents=True, exist_ok=True)
            ipath.write_text(json.dumps(_issue(x, res, streak), indent=2) + "\n", encoding="utf-8")
            res["disposition"] = "filed" if streak == 1 else "mutate" if streak == 2 else "incident"
            if streak >= 3:
                (root / ISSUES / f"AUDIT-{x['id']}-incident.json").write_text(json.dumps(_issue(x, res, streak, "-incident"), indent=2) + "\n", encoding="utf-8")
        elif issues and res["status"] == "pass":
            res["disposition"] = "recovered" if ipath.exists() else "clean"
            for p in (ipath, root / ISSUES / f"AUDIT-{x['id']}-incident.json"):
                if p.exists():
                    p.unlink()
        with (root / LEDGER).open("a", encoding="utf-8") as f:
            f.write(json.dumps(res) + "\n")
        results.append(res)
    return results


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        p = check()
        print("failure-audit ok" if not p else "\n".join(p))
        return 1 if p else 0
    if "--run" in a:
        only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else None
        rs = run(only=only, issues="--no-issues" not in a)
        for r in rs:
            print(f"{r['status']:<11} {r['id']:<22} {r.get('disposition', '')} {r['evidence'][:90]!r}")
        return 1 if any(r["status"] != "pass" for r in rs) else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
