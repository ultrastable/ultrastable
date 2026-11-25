# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CLEANROOM-1: a new system is born from nothing but the seed and an idea, runs a day, and tears itself down. Ultrastable is the foundation for any autonomous system.

Rowan, 2026-11-25: "all surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the
beginning ... it has to all bootstrap autonomously." This is the test of that sentence, run on a clock rather than asserted:

  1. copy seed/ (and nothing else) into a throwaway directory, write the sandbox idea from doctrine/cleanroom.json with `hosted_by` set,
  2. run the seed's own bootstrap there, as a new system would,
  3. check every capability doctrine/cleanroom.json lists (repo settings, workflows, credential path, Cloudflare plan, back end, front end,
     managers, probes, knowledge graph, discoverability, red team, improvement, year gate),
  4. run a simulated day of ticks (144 at ten minutes) of the sandbox's own tick against a fresh SQLite store,
  5. delete the sandbox and prove it is gone.

Every capability that does not come up with zero human steps is a finding. `--apply` files one Q-CLEANROOM-<id> item per finding and closes it
with evidence when the same check passes; the ledger is ops/cleanroom/latest.json plus ops/cleanroom/runs.jsonl.

  python3 -m foundation cleanroom --run [--apply] [--ticks N]
  python3 -m foundation cleanroom --probe <capability>   exit 0 when that capability passes in a fresh clean room
  python3 -m foundation cleanroom --check                the data and the wiring are sound (fast, in `checks`)
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "doctrine" / "cleanroom.json"
LEDGER = REPO / "ops" / "cleanroom"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load(root: Path = REPO) -> dict:
    return json.loads((Path(root) / "doctrine" / "cleanroom.json").read_text(encoding="utf-8"))


# ------------------------------------------------------------------ checks (each returns (ok, evidence))

def _boot_ok(ctx):
    bad = [f"{s['stage']}: {s['detail']}" for s in ctx["boot"].get("stages", []) if s["status"] == "blocked"]
    return (not bad and ctx["boot_rc"] == 0), ("; ".join(bad) or f"{len(ctx['boot'].get('stages', []))} stages, none blocked")


def _no_secret_cards(ctx):
    words = ctx["spec"]["secret_words"]
    cards = json.loads((ctx["out"] / "gate-cards.json").read_text()) if (ctx["out"] / "gate-cards.json").exists() else []
    bad = [c.get("id", "?") + ": " + str(c.get("what") or c.get("line", ""))[:90] for c in cards
           if any(w in json.dumps(c).lower() for w in words)]
    return not bad, ("; ".join(bad) or f"{len(cards)} gate card(s), none asks a person for a secret")


def _workflow_headers(ctx):
    bad = []
    for wf in sorted((ctx["sb"] / ".github" / "workflows").glob("*.yml")):
        t = wf.read_text(encoding="utf-8")
        miss = [h for h in ("# budget:", "# trigger:", "# free-alternative:", "timeout-minutes") if h not in t]
        if "HALT" not in t:
            miss.append("HALT")
        if miss:
            bad.append(f"{wf.name} lacks {', '.join(miss)}")
    return not bad, ("; ".join(bad) or "every workflow declares budget, trigger, free alternative, timeout and honours HALT")


def _provision_plan(ctx):
    plan = ctx["boot"].get("provision_plan", [])
    return bool(plan), f"{len(plan)} provision command(s) planned"


def _managers(ctx):
    p = ctx["out"] / "roles.json"
    roles = json.loads(p.read_text()) if p.exists() else []
    have = {(r.get("role") or r.get("id") or "") if isinstance(r, dict) else str(r) for r in (roles if isinstance(roles, list) else roles.get("roles", []))}
    need = {"portfolio-manager", "product-manager", "project-manager", "reviewer"}
    miss = sorted(n for n in need if not any(n in h for h in have))
    return not miss, ("missing " + ", ".join(miss)) if miss else f"{len(have)} role kind(s) staffed"


def _liveness(ctx):
    p = ctx["out"] / "objectives.json"
    ob = json.loads(p.read_text()) if p.exists() else {}
    ids = {m.get("id") for m in ob.get("metrics", [])}
    ok = "M-tick-heartbeat" in ids and len(ob.get("objectives", [])) >= 1
    return ok, f"{len(ob.get('objectives', []))} objective(s), {len(ids)} metric(s)"


def _year_gate(ctx):
    st = {s["stage"]: s for s in ctx["boot"].get("stages", [])}
    s = st.get("year_gate", {"status": "missing", "detail": "stage did not run"})
    return s["status"] == "ok", s["detail"]


def _day(ctx):
    d = ctx.get("day") or {}
    return bool(d) and d.get("error_count", 1) == 0 and d.get("completed") == d.get("ticks"), json.dumps(d)[:400]


def _definition(ctx):
    r = subprocess.run([sys.executable, "-I", str(ctx["sb"] / "scripts" / "system.py"), "--check", "--root", str(ctx["sb"])], capture_output=True, text=True, timeout=120)
    return r.returncode == 0, r.stdout.strip().splitlines()[-1] if r.returncode == 0 else " ".join(r.stdout.split("\n")[:4])[:400]


def _human_voice(ctx):
    r = subprocess.run([sys.executable, "-I", str(ctx["sb"] / "scripts" / "humanvoice.py"), "--check"], capture_output=True, text=True, timeout=60, cwd=ctx["sb"])
    return r.returncode == 0, r.stdout.strip()[-300:]


STAGES = ["unseeded", "seeded", "ticking", "looping", "closing", "instrumented", "critical", "self-sustaining"]


def _ignition(ctx):
    ig = (ctx.get("day") or {}).get("ignition") or {}
    st = ig.get("stage", "unmeasured")
    need = ctx["spec"].get("min_sandbox_stage", "ticking")
    ok = st in STAGES and STAGES.index(st) >= STAGES.index(need)
    b = ig.get("blocking") or {}
    return ok, f"stage {st} (sandbox floor {need}); next blocked: {b.get('stage')}: {str(b.get('why', ''))[:200]}"


def _teardown(ctx):
    return ctx.get("torn_down", False), "sandbox deleted" if ctx.get("torn_down") else "sandbox still on disk"


CHECKS = {"boot_ok": _boot_ok, "no_secret_cards": _no_secret_cards, "workflow_headers": _workflow_headers, "provision_plan": _provision_plan,
          "managers": _managers, "liveness": _liveness, "year_gate": _year_gate, "day": _day, "teardown": _teardown, "definition": _definition, "human_voice": _human_voice, "ignition": _ignition}


def _cap(ctx, cap) -> tuple[bool, str]:
    sb, notes = ctx["sb"], []
    miss = [p for p in cap.get("paths", []) if not (sb / p).exists()]
    miss += [g for g in cap.get("glob", []) if not list(sb.glob(g))]
    for rel, pat in cap.get("grep", {}).items():
        f = sb / rel
        if f.exists() and not re.search(pat, f.read_text(encoding="utf-8", errors="replace")):
            miss.append(f"{rel} has no '{pat}'")
    if miss:
        notes.append("missing: " + ", ".join(miss))
    ok = not miss
    if cap.get("check"):
        c_ok, ev = CHECKS[cap["check"]](ctx)
        ok = ok and c_ok
        notes.append(ev)
    return ok, "; ".join(n for n in notes if n) or "present"


# ------------------------------------------------------------------ the run

def _config(sb: Path) -> dict:
    seed = json.loads((sb / "ultrastable.json").read_text())
    pol = json.loads((sb / "autonomy" / "policy.json").read_text())
    cap = seed.get("capacity", {})
    return {"org_slug": "cleanroom-sandbox", "claim_ttl_minutes": 120, "max_wip_per_role": cap.get("max_wip_per_role", 3),
            "plus_share": cap.get("plus_share", 0.2), "policy": pol}


def run(root: Path = REPO, ticks: int | None = None, keep: bool = False) -> dict:
    root = Path(root)
    spec = load(root)
    ticks = spec["ticks"] if ticks is None else ticks
    tmp = Path(tempfile.mkdtemp(prefix="ultrastable-cleanroom-"))
    sb = tmp / "sandbox"
    shutil.copytree(root / "seed", sb, ignore=shutil.ignore_patterns("org", "node_modules", "__pycache__", ".selfhost"))
    (sb / "IDEA.md").write_text(spec["idea"], encoding="utf-8")
    out = sb / "org"
    ctx = {"spec": spec, "sb": sb, "out": out, "boot": {}, "boot_rc": None, "day": None, "torn_down": False}
    try:
        b = subprocess.run([sys.executable, "-I", str(sb / "bootstrap" / "bootstrap.py"), "--dry-run", "--root", str(sb)],
                           capture_output=True, text=True, timeout=900, cwd=sb)
        ctx["boot_rc"] = b.returncode
        log = out / "boot-log.json"
        ctx["boot"] = json.loads(log.read_text()) if log.exists() else {"stages": [{"stage": "bootstrap", "status": "blocked", "detail": (b.stderr or b.stdout)[-400:]}]}
        if shutil.which("node"):
            import sqlite3
            db = tmp / "day.db"
            con = sqlite3.connect(db)
            for m in sorted((sb / "worker" / "migrations").glob("*.sql")):
                con.executescript(m.read_text(encoding="utf-8"))
            if (out / "seed.sql").exists():
                con.executescript((out / "seed.sql").read_text(encoding="utf-8"))
            con.commit()
            con.close()
            cfg = tmp / "config.json"
            cfg.write_text(json.dumps(_config(sb)))
            d = subprocess.run(["node", "--no-warnings", str(root / "platform" / "selfhost" / "day.mjs"), str(sb), str(db), str(cfg), str(ticks)],
                               capture_output=True, text=True, timeout=1800, cwd=root)
            line = (d.stdout.strip().splitlines() or [""])[-1]
            try:
                ctx["day"] = json.loads(line)
            except ValueError:
                ctx["day"] = {"ticks": ticks, "completed": 0, "error_count": 1, "errors": [{"tick": -1, "error": (d.stderr or line)[-400:]}]}
        else:
            ctx["day"] = {"ticks": ticks, "completed": 0, "error_count": 1, "errors": [{"tick": -1, "error": "node not installed: no day was run"}]}
        results = []
        for cap in spec["capabilities"]:
            if cap["id"] == "teardown":
                continue
            ok, ev = _cap(ctx, cap)
            results.append({"id": cap["id"], "what": cap["what"], "ok": ok, "evidence": ev})
    finally:
        if not keep:
            shutil.rmtree(tmp, ignore_errors=False)
            ctx["torn_down"] = not tmp.exists()
    tc = next(c for c in spec["capabilities"] if c["id"] == "teardown")
    ok, ev = CHECKS["teardown"](ctx) if not keep else (True, "kept on request")
    results.append({"id": "teardown", "what": tc["what"], "ok": ok, "evidence": ev})
    return {"at": _now(), "ticks": ticks, "passed": all(r["ok"] for r in results), "results": results,
            "findings": [r["id"] for r in results if not r["ok"]]}


def _item_path(root: Path, cid: str) -> Path:
    return Path(root) / "docs" / "issues" / f"Q-CLEANROOM-{cid}.json"


def apply(rec: dict, root: Path = REPO) -> list[str]:
    """File one item per finding; close an open item with evidence when its capability now passes. Nothing is deleted."""
    root = Path(root)
    touched = []
    for r in rec["results"]:
        p = _item_path(root, r["id"])
        have = json.loads(p.read_text()) if p.exists() else None
        open_ = have is not None and "**Status:** open" in have.get("body", "")
        if not r["ok"] and not open_:
            body = (f"**Owner:** executor\n**Trigger:** cleanroom run, daily\n**Done check:** cmd:python3 -m foundation cleanroom --probe {r['id']}\n**Status:** open\n\n"
                    f"CLEANROOM-1: a sandbox built from nothing but seed/ and an idea did not bring up `{r['id']}` ({r['what']}) with zero human steps.\n\n"
                    f"Evidence ({rec['at']}): {r['evidence']}\n\nPaths: seed/, doctrine/cleanroom.json, foundation/cleanroom.py.\n\nsize: M\n\n"
                    f"**Closing probe:** python3 -m foundation cleanroom --probe {r['id']} passes")
            p.write_text(json.dumps({"id": f"Q-CLEANROOM-{r['id']}", "title": f"Q-CLEANROOM-{r['id']}: a new system does not bring up {r['id']} on its own",
                                     "body": body, "labels": ["p1", "agent-ready", "raises-self"], "milestone": "Now", "workstream": "Executor queue"}, indent=2) + "\n")
            touched.append(p.name)
        elif r["ok"] and open_:
            have["body"] = have["body"].replace("**Status:** open", "**Status:** closed", 1) + f"\n\n**Disposition:** fixed ({rec['at']}, CLEANROOM-1)\n\n**Evidence:** {r['evidence']}\n"
            p.write_text(json.dumps(have, indent=2) + "\n")
            touched.append(p.name)
    LEDGER.mkdir(parents=True, exist_ok=True) if root == REPO else (root / "ops/cleanroom").mkdir(parents=True, exist_ok=True)
    led = root / "ops" / "cleanroom"
    (led / "latest.json").write_text(json.dumps(rec, indent=1) + "\n")
    with (led / "runs.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": rec["at"], "passed": rec["passed"], "findings": rec["findings"]}) + "\n")
    return touched


def check(root: Path = REPO) -> list[str]:
    """Fast wiring check for `checks`: the data is sound and every named check and the runner exist."""
    root = Path(root)
    bad = []
    spec = load(root)
    ids = [c["id"] for c in spec["capabilities"]]
    if len(ids) != len(set(ids)):
        bad.append("doctrine/cleanroom.json: duplicate capability id")
    for c in spec["capabilities"]:
        if c.get("check") and c["check"] not in CHECKS:
            bad.append(f"capability {c['id']}: unknown check {c['check']}")
    for need in ("boot", "day", "teardown", "no-human-steps"):
        if need not in ids:
            bad.append(f"doctrine/cleanroom.json: capability {need} is required")
    if "hosted_by:" not in spec["idea"]:
        bad.append("doctrine/cleanroom.json: the sandbox idea must be hosted (hosted_by) so no secret is asked of anyone")
    if not (root / "platform/selfhost/day.mjs").exists():
        bad.append("platform/selfhost/day.mjs missing")
    wf = root / ".github/workflows/cleanroom.yml"
    if not wf.exists() or "cleanroom --run --apply" not in wf.read_text():
        bad.append(".github/workflows/cleanroom.yml must run `python3 -m foundation cleanroom --run --apply` on a schedule")
    return bad


def main(argv: list[str]) -> int:
    if "--check" in argv:
        bad = check()
        for b in bad:
            print("FAIL", b)
        print(f"cleanroom: {'ok' if not bad else str(len(bad)) + ' problem(s)'}")
        return 1 if bad else 0
    ticks = int(argv[argv.index("--ticks") + 1]) if "--ticks" in argv else None
    if "--probe" in argv:
        cid = argv[argv.index("--probe") + 1]
        rec = run(ticks=ticks)
        r = next((x for x in rec["results"] if x["id"] == cid), None)
        if r is None:
            print(f"no capability {cid}")
            return 2
        print(("PASS " if r["ok"] else "FAIL ") + cid + ": " + r["evidence"])
        return 0 if r["ok"] else 1
    if "--run" in argv:
        rec = run(ticks=ticks, keep="--keep" in argv)
        for r in rec["results"]:
            print(("PASS " if r["ok"] else "FAIL ") + f"{r['id']}: {r['evidence']}")
        if "--apply" in argv:
            t = apply(rec)
            print(f"filed or closed: {', '.join(t) or 'nothing'}")
        print(f"cleanroom: {'passed' if rec['passed'] else 'findings: ' + ', '.join(rec['findings'])}")
        return 0 if rec["passed"] else 1
    print(__doc__)
    return 2
