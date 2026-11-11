"""Ultrastable runs on itself. Boots Ultrastable's own organization from only this repository.

  python3 -m foundation selfhost                 verify, boot into .selfhost/ultrastable.db, run one tick, print the four-line report
  python3 -m foundation selfhost --no-node       the minimal path: Python 3 and a copy of the repo, no Node, no network, no git
  python3 -m foundation selfhost --verify        only the verifier (exit 1 on any finding)
  python3 -m foundation selfhost --gaps          print the gap register with each probe's state

The verifier fails when a process has no path in the repo, uses a tool with no recorded adapter, uses an outside tool that has no gap
entry, or a workflow or script names an outside tool (Slack, Linear, Jira, Notion ...) that the registry does not record.
"""
from __future__ import annotations
import json, re, shutil, sqlite3, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SELFHOST = "instances/ultrastable/selfhost.json"
GAPS = "instances/ultrastable/gaps.json"
REGISTRY = "platform/adapters/registry.json"
SCAN = (".github/workflows/*.yml", "scripts/*.py", "scripts/*.sh", "seed/scripts/*.py", "seed/worker/src/*.js", "seed/funding/*.py", "platform/adapters/gcp/*.sh")


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def probe(root, spec: str) -> bool:
    """A closing probe: file:<path> exists, grep:<path>::<regex> matches."""
    kind, _, rest = spec.partition(":")
    if kind == "file":
        return (Path(root) / rest).is_file()
    if kind == "grep":
        path, _, rx = rest.partition("::")
        p = Path(root) / path
        return p.is_file() and re.search(rx, p.read_text(encoding="utf-8", errors="replace")) is not None
    raise ValueError(f"unknown probe kind {kind!r}")


def verify(root=REPO) -> list[str]:
    root, bad = Path(root), []
    sh, gp, reg = _j(root, SELFHOST), _j(root, GAPS), _j(root, REGISTRY)
    adapters = {a["id"]: a for a in reg["adapters"]}
    gaps = {g["tool"]: g for g in gp["gaps"]}
    areas = {p["area"] for p in sh["processes"]}
    for a in sh["required_areas"]:
        if a not in areas:
            bad.append(f"process area '{a}' is not recorded as running in the system")
    used = set()
    for p in sh["processes"]:
        for rel in p["system_path"]:
            if not (root / rel).exists():
                bad.append(f"{p['id']}: system path {rel} does not exist")
        for t in p["tools"]:
            used.add(t)
            ad = adapters.get(t)
            if ad is None:
                bad.append(f"{p['id']}: tool '{t}' has no recorded adapter in {REGISTRY}")
                continue
            if ad["outside"] and t not in gaps:
                bad.append(f"{p['id']}: outside tool '{t}' has no entry in the gap register")
    for a in adapters.values():
        if not (root / a["runbook"]).is_file():
            bad.append(f"adapter {a['id']}: runbook {a['runbook']} missing")
    for g in gp["gaps"]:
        for k in ("what", "plan", "closing_probe", "owner_role", "status"):
            if not g.get(k):
                bad.append(f"gap {g['id']}: lacks {k}")
        if g["tool"] not in adapters or not adapters[g["tool"]]["outside"]:
            bad.append(f"gap {g['id']}: tool '{g['tool']}' is not a registered outside tool")
        if g.get("closing_probe"):
            ok = probe(root, g["closing_probe"])
            if g["status"] == "closed" and not ok:
                bad.append(f"gap {g['id']}: marked closed but its probe fails ({g['closing_probe']})")
            if g["status"] == "open" and ok:
                bad.append(f"gap {g['id']}: probe now passes, mark it closed ({g['closing_probe']})")
    for tool, g in gaps.items():
        if tool not in used:
            bad.append(f"gap {g['id']}: tool '{tool}' is used by no process; remove the gap or record the process")
    if not any(a.get("minimal") for a in adapters.values()):
        bad.append("no adapter is marked as the minimal any-tools path")
    # Scan the code: an outside tool that no process records, or one with no adapter at all, fails.
    hits = {}
    for g in SCAN:
        for f in sorted(root.glob(g)):
            text = f.read_text(encoding="utf-8", errors="replace")
            for pat in reg["unregistered_watch"]["patterns"]:
                if re.search(pat, text, re.I):
                    bad.append(f"{f.relative_to(root).as_posix()}: uses an outside tool matching /{pat}/ with no recorded adapter")
            for a in adapters.values():
                if any(re.search(w, text, re.I) for w in a.get("watch", [])):
                    hits.setdefault(a["id"], f.relative_to(root).as_posix())
    for tid, where in hits.items():
        if tid not in used:
            bad.append(f"{where}: uses '{tid}' but no process records it")
    return bad


def gaps_report(root=REPO) -> list[dict]:
    root = Path(root)
    return [dict(g, probe_passes=probe(root, g["closing_probe"])) for g in _j(root, GAPS)["gaps"]]


def _role_of(labels, roles):
    for l in labels:
        if l.startswith("role:") and l[5:] in roles:
            return l[5:]
    return "staff"


def boot(root=REPO, db_path=None, node=True) -> dict:
    """Create the organization's state from repo files only, run one tick, return the result."""
    root = Path(root)
    problems = verify(root)
    if problems:
        return {"status": "refused", "problems": problems}
    inst, seed, policy = _j(root, "instances/ultrastable/instance.json"), _j(root, "seed/ultrastable.json"), _j(root, "seed/autonomy/policy.json")
    doctrine, sh, gp = _j(root, "doctrine/positioning.json"), _j(root, SELFHOST), _j(root, GAPS)
    out = Path(db_path) if db_path else root / ".selfhost" / "ultrastable.db"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    con = sqlite3.connect(out)
    for m in sorted((root / "seed/worker/migrations").glob("*.sql")):
        con.executescript(m.read_text(encoding="utf-8"))
    cap = seed.get("capacity", {})
    org = {"name": inst["name"], "slug": inst["slug"], "positioning": inst["positioning"], "runs_on_itself": str(doctrine.get("runs_on_itself", {}).get("tagline", "")),
           "plus_share": str(cap.get("plus_share", 0.2)), "booted_from": ",".join(sh["boot_from"])}
    con.executemany("INSERT INTO org(key,value) VALUES(?,?)", org.items())
    roles = {r["id"]: r for r in seed["roles"]}
    for r in seed["roles"]:
        con.execute("INSERT INTO roles(id,role,tick_every,model) VALUES(?,?,?,?)", (f"{r['id']}-1", r["id"], r.get("tick_every", 1), "small"))
    items = 0
    for f in sorted((root / "docs/issues").glob("*.json")):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        m = re.search(r"\*\*Status:\*\*\s*([^\n]+)", d.get("body", ""))
        status = m.group(1).strip() if m else ""
        done = status.lower().startswith("done")
        con.execute("INSERT INTO items(id,title,kind,owner_role,done_check,priority,status,disposition) VALUES(?,?,?,?,?,?,?,?)",
                    (d["id"], d["title"], "plus" if "plus" in d.get("labels", []) else "work", _role_of(d.get("labels", []), roles),
                     (re.search(r"\*\*Done check:\*\*\s*([^\n]+)", d.get("body", "")) or [None, "recorded in the item"])[1].strip(),
                     10 if d.get("milestone") == "Now" else 50, "done" if done else "open", f"done: {status}" if done else None))
        items += 1
    for g in gp["gaps"]:  # the gap register is run by the system's own tracker
        closed = g["status"] == "closed"
        con.execute("INSERT INTO items(id,title,kind,owner_role,done_check,closing_probe,priority,status,disposition) VALUES(?,?,?,?,?,?,?,?,?)",
                    (g["id"], f"{g['id']}: stop depending on {g['tool']}", "plus", g["owner_role"] if g["owner_role"] in roles else "staff", g["plan"], g["closing_probe"], 20,
                     "done" if closed else "open", "done: probe passes" if closed else None))
        items += 1
    surfaces = sorted({(p["id"], "execute") for p in sh["processes"]})
    for s, a in surfaces:
        con.execute("INSERT INTO trust_ledger(surface,action_class,rung,reliability,outcomes) VALUES(?,?,?,?,0)", (s, a, "observed", policy["trust"]["baseline"]))
    con.execute("INSERT INTO doctrine_lineage(version,source) VALUES(?,?)", (f"positioning-{doctrine['version']}", "doctrine/positioning.json"))
    con.commit()
    config = {"org_slug": inst["slug"], "claim_ttl_minutes": 120, "max_wip_per_role": cap.get("max_wip_per_role", 3), "plus_share": cap.get("plus_share", 0.2), "policy": policy}
    cfg = out.with_suffix(".config.json")
    cfg.write_text(json.dumps(config), encoding="utf-8")
    tick, path = None, "python-minimal"
    if node and shutil.which("node"):
        r = subprocess.run(["node", "--no-warnings", str(root / "platform/selfhost/tick.mjs"), str(out), str(cfg)], capture_output=True, text=True, cwd=root)
        if r.stdout.strip():
            tick, path = json.loads(r.stdout.strip().splitlines()[-1]), "seed-tick-node"
        elif r.returncode:
            con.close()
            return {"status": "failed", "path": "seed-tick-node", "stderr": r.stderr[-800:]}
    if tick is None:
        open_n = con.execute("SELECT COUNT(*) FROM items WHERE status NOT IN ('done','superseded','cancelled')").fetchone()[0]
        report = "\n".join([f"Happened: booted {len(roles)} roles, {items} items, {len(surfaces)} trust rows from the repository (minimal path, tick not run).",
                            "Decided: the minimal path seeds state only; the full tick runs where Node 22 exists.",
                            "Next: run the same command with Node, or on Cloudflare or GCP, for the full tick.", f"Open: {open_n} active item(s)."])
        con.execute("INSERT INTO tick_runs(started_at,finished_at,steps_completed,steps_total,report) VALUES(datetime('now'),datetime('now'),0,7,?)", (report,))
        con.commit()
        tick = {"completed": 0, "total": 7, "report": report, "errors": []}
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("roles", "items", "trust_ledger", "org", "tick_runs")}
    con.close()
    return {"status": "ok", "path": path, "db": str(out), "counts": counts, "tick": tick}
