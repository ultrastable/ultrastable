"""Launch: start Ultrastable's own loops on Ultrastable's own records, on any host that can run a schedule.

  python3 -m foundation launch                       one pass of every loop, evidence written to ops/loop-evidence/
  python3 -m foundation launch --commit [--push]     ... and commit the evidence (push goes to branch `loop-evidence`)
  python3 -m foundation launch --probe               test every host surface and say what each returned
  python3 -m foundation launch --export-d1 FILE      SQL that loads the real records into the Cloudflare D1 the cron worker ticks on
  python3 -m foundation launch --install SURFACE     print the install artifact: cron | task-scheduler | github-actions | claude-routine | cloudflare

The loops (instances/ultrastable/loops.json): tick (manager heartbeat), plussing (plus share), probes (verifier and gap
register), funding-outreach (engine run; every contact stays dry-run until outreach/gate.json says live), write-back (evidence
and a four-line report committed to the repository, so nothing lives only in a session). Hosts differ only in who calls this
command; the command and its evidence format are the same everywhere.
"""
from __future__ import annotations
import datetime as dt, json, os, platform, shutil, sqlite3, subprocess
from pathlib import Path

from . import selfhost

REPO = selfhost.REPO
EVIDENCE = "ops/loop-evidence"
REGISTRY = "instances/ultrastable/loops.json"
SURFACES = ("cloudflare-worker", "claude-routine", "local-scheduler", "github-actions")


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def registry(root=REPO) -> dict:
    return json.loads((Path(root) / REGISTRY).read_text(encoding="utf-8"))


def _run(argv, root, timeout=120):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, cwd=root, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def probe_surfaces(root=REPO, env=None) -> list[dict]:
    """Test each place the recurring loop could live. Reports what each returned; never prints a secret value."""
    env = os.environ if env is None else env
    out = []
    has = lambda *names: [n for n in names if env.get(n)]
    cf = has("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")
    out.append({"surface": "cloudflare-worker", "available": len(cf) == 2,
                "detail": "API credentials present as bindings" if len(cf) == 2 else f"CLOUDFLARE_API_TOKEN/ACCOUNT_ID not both set here (found: {cf or 'none'}); the worker `ultrastable-tick` already exists in the account with an every-10-minutes cron, and the account connector reaches D1; deploys of new code go through the connector or `deploy-site`-style workflow",
                "how": "worker `ultrastable-tick` (cron) + D1 `ultrastable-org`; `launch --export-d1` loads the real records"})
    claude = shutil.which("claude")
    out.append({"surface": "claude-routine", "available": bool(claude) or bool(env.get("CLAUDE_CODE_REMOTE")),
                "detail": "claude CLI on PATH" if claude else ("running inside a Claude Code cloud session (scheduled triggers and in-session loops available)" if env.get("CLAUDE_CODE_REMOTE") else "no claude CLI and not a cloud session"),
                "how": "scheduled routine or /loop running `python3 -m foundation launch --failover --commit --push` (deploy/loops/claude-routine.md)"})
    sched = [n for n in ("crontab", "schtasks", "systemctl", "launchctl") if shutil.which(n)]
    out.append({"surface": "local-scheduler", "available": bool(sched), "detail": f"scheduler tools on PATH: {sched or 'none'} ({platform.system()})",
                "how": "deploy/loops/local/ (cron line, systemd timer, Windows Task Scheduler)"})
    gh = has("GH_TOKEN", "GITHUB_TOKEN", "GITHUB_ACTIONS")
    budget = json.loads((Path(root) / "actions-budget.json").read_text(encoding="utf-8"))
    out.append({"surface": "github-actions", "available": bool(gh) or (Path(root) / ".github/workflows/loop.yml").exists(),
                "detail": f"workflow .github/workflows/loop.yml present, weekly only, ~2 min/run inside the {budget['monthly_free_minutes']} free minutes (budget paused={budget['paused']})" if (Path(root) / ".github/workflows/loop.yml").exists() else "loop workflow missing",
                "how": ".github/workflows/loop.yml (weekly + dispatch; actions_guard + budget headers)"})
    node = shutil.which("node")
    out.append({"surface": "runtime", "available": True, "detail": f"python {platform.python_version()}, node {'present' if node else 'absent (minimal python tick path is used)'}", "how": ""})
    return out


def _loop_tick(root, scratch) -> dict:
    rep = selfhost.boot(root, db_path=scratch, node=shutil.which("node") is not None)
    if rep["status"] != "ok":
        return {"loop": "tick", "ok": False, "detail": json.dumps(rep)[:600]}
    t = rep["tick"]
    return {"loop": "tick", "ok": not t.get("errors"), "path": rep["path"], "steps": f"{t['completed']}/{t['total']}", "counts": rep["counts"], "report": t["report"].split("\n")}


def _loop_plussing(scratch) -> dict:
    con = sqlite3.connect(scratch)
    q = lambda s: con.execute(s).fetchone()[0]
    done, plus_done = q("SELECT COUNT(*) FROM items WHERE status='done'"), q("SELECT COUNT(*) FROM items WHERE status='done' AND kind='plus'")
    plus_open = q("SELECT COUNT(*) FROM items WHERE status!='done' AND kind='plus'")
    con.close()
    return {"loop": "plussing", "ok": True, "done": done, "plus_done": plus_done, "plus_open": plus_open, "queued_share_of_open": round(plus_open / max(1, q_open(scratch)), 3)}


def q_open(scratch) -> int:
    con = sqlite3.connect(scratch)
    n = con.execute("SELECT COUNT(*) FROM items WHERE status NOT IN ('done','superseded','cancelled')").fetchone()[0]
    con.close()
    return n


def _loop_probes(root) -> dict:
    problems = selfhost.verify(root)
    gaps = selfhost.gaps_report(root)
    open_g = [g["id"] for g in gaps if g["status"] == "open"]
    return {"loop": "probes", "ok": not problems, "verifier_problems": problems[:10], "gaps_open": open_g, "gaps_closed": sum(1 for g in gaps if g["status"] == "closed")}


def _loop_funding(root, skip) -> dict:
    if skip:
        return {"loop": "funding-outreach", "ok": True, "skipped": True, "mode": "dry-run"}
    gate = json.loads((Path(root) / "outreach/gate.json").read_text(encoding="utf-8")) if (Path(root) / "outreach/gate.json").exists() else {}
    code, text = _run(["python3", "scripts/outreach.py", "run"], root, timeout=180)
    return {"loop": "funding-outreach", "ok": code == 0, "mode": gate.get("mode", "dry-run"), "exit": code, "tail": text.splitlines()[-4:]}


def run_once(root=REPO, skip_outreach=False, now=None) -> dict:
    root = Path(root)
    scratch = root / ".selfhost" / "launch.db"
    results = [_loop_tick(root, scratch)]
    if results[0]["ok"]:
        results.append(_loop_plussing(scratch))
    results += [_loop_probes(root), _loop_funding(root, skip_outreach)]
    ok = [r["loop"] for r in results if r["ok"]]
    bad = [r["loop"] for r in results if not r["ok"]]
    t = next((r for r in results if r["loop"] == "tick"), {})
    rec = {"schema": "ultrastable-loop-evidence/1", "at": now or _now(), "host": os.environ.get("ULTRASTABLE_HOST", "unspecified"), "loops": results,
           "report": [f"Happened: ran {len(results)} loops ({', '.join(ok) or 'none'} ok{'; failed: ' + ', '.join(bad) if bad else ''}); tick {t.get('steps', 'n/a')} on the {t.get('path', 'n/a')} path.",
                      "Decided: failures become backlog items with a probe, not silence; contact stays dry-run until the gate says live.",
                      "Next: the next scheduled pass on every enabled host (instances/ultrastable/loops.json).",
                      f"Open: {len([r for r in results if r['loop'] == 'probes' for _ in r['gaps_open']])} gap(s) in the register, {len(bad)} failing loop(s)."]}
    return rec


def write_back(rec: dict, root=REPO) -> list[str]:
    root = Path(root)
    d = root / EVIDENCE
    d.mkdir(parents=True, exist_ok=True)
    day = d / f"{rec['at'][:10]}.jsonl"
    with day.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    latest = d / "LATEST.md"
    latest.write_text(f"# Latest loop pass\n\n{rec['at']} on `{rec['host']}`\n\n" + "\n".join(f"- {l}" for l in rec["report"]) + "\n\nEvidence: `" + str(day.relative_to(root)) + "`\n", encoding="utf-8")
    return [str(day.relative_to(root)), str(latest.relative_to(root))]


def commit(paths, root=REPO, push=False) -> dict:
    root = Path(root)
    code, out = _run(["git", "add", "--", *paths], root)
    if code:
        return {"ok": False, "step": "add", "detail": out}
    code, out = _run(["git", "diff", "--cached", "--quiet", "--", *paths], root)
    if code == 0:
        return {"ok": True, "detail": "nothing to commit"}
    code, out = _run(["git", "-c", "user.name=ultrastable-loop", "-c", "user.email=loop@ultrastable.invalid", "commit", "-m", "Loop evidence: tick pass", "--", *paths], root)
    if code:
        return {"ok": False, "step": "commit", "detail": out}
    if push:
        code, out = _run(["git", "push", "origin", "HEAD:refs/heads/loop-evidence", "--force-with-lease"], root, timeout=120)
        return {"ok": code == 0, "step": "push", "detail": out[-300:]}
    return {"ok": True, "detail": "committed"}


def _sql(v) -> str:
    return "NULL" if v is None else str(v) if isinstance(v, (int, float)) else "'" + str(v).replace("'", "''") + "'"


def export_d1(root=REPO) -> str:
    """INSERT OR IGNORE statements that put the real records (org, roles, items, trust rows) into a D1 with the seed schema."""
    root = Path(root)
    scratch = root / ".selfhost" / "export.db"
    rep = selfhost.boot(root, db_path=scratch, node=False)
    if rep["status"] != "ok":
        raise RuntimeError(f"cannot export: {rep}")
    con = sqlite3.connect(scratch)
    lines = []
    for table, cols in (("org", ("key", "value")), ("roles", ("id", "role", "tick_every", "model")),
                        ("items", ("id", "title", "kind", "owner_role", "done_check", "closing_probe", "priority", "status", "disposition")),
                        ("trust_ledger", ("surface", "action_class", "rung", "reliability", "outcomes"))):
        for row in con.execute(f"SELECT {','.join(cols)} FROM {table}"):
            lines.append(f"INSERT OR IGNORE INTO {table}({','.join(cols)}) VALUES({','.join(_sql(v) for v in row)});")
    con.close()
    return "\n".join(lines) + "\n"


def install_artifact(surface: str, root=REPO) -> str:
    root = Path(root)
    cmd = "python3 -m foundation launch --failover --commit --push"
    if surface == "cron":
        return f"17 * * * * cd {root} && ULTRASTABLE_HOST=local-cron {cmd} >> .selfhost/loop.log 2>&1\n"
    if surface == "task-scheduler":
        return f'schtasks /Create /SC HOURLY /TN "UltrastableLoop" /TR "cmd /c cd /d {root} && set ULTRASTABLE_HOST=windows-task&& {cmd}" /F\n'
    if surface == "github-actions":
        return (root / ".github/workflows/loop.yml").read_text(encoding="utf-8")
    if surface == "claude-routine":
        return (root / "deploy/loops/claude-routine.md").read_text(encoding="utf-8")
    if surface == "cloudflare":
        return (root / "deploy/loops/cloudflare.md").read_text(encoding="utf-8")
    raise ValueError(f"unknown surface {surface}")
