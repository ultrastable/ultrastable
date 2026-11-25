"""new-system generator: one instance manifest in, a bootable instance repository out.
Ultrastable is the foundation for any autonomous system; this is where a new system is born.

The kernel (seed/) is copied unchanged, the manifest supplies every instance-specific value, the bootstrap case library
and the owner-step engine run, and every failed step is written to org/failures.json as a backlog item (a failure is recorded, never swallowed).
"""
from __future__ import annotations
import json, re, shutil
from pathlib import Path

from . import TAGLINE, __version__, filing, genesis, manifest as mf, minutes, ownersteps, preflight, ladder, seedadmit

REPO = Path(__file__).resolve().parent.parent
KERNEL = REPO / "seed"
KERNEL_PATHS = ["agents", "autonomy", "doctrine/constitution.json", "doctrine/schemas/constitution.schema.json", "doctrine/schemas/catalog.json", "doctrine/CONSTITUTION.md", "doctrine/SYSTEM.md", "doctrine/standing-order.json", "doctrine/claims.json", "doctrine/constitution-baseline.json", "bootstrap", "worker", "analytics", "standards", ".claude", ".github/copilot-instructions.md", "AGENTS.md", "CLAUDE.md", "scripts", "funding", "outreach", "docs/aios-lessons.md", "docs/bootstrapping.md"]
SKIP = shutil.ignore_patterns("__pycache__", "node_modules", "*.pyc", ".wrangler")


def _autonomy() -> str:
    return json.loads((REPO / "doctrine" / "positioning.json").read_text(encoding="utf-8"))["autonomy"]["line"].replace(" (`python3 -m foundation loops --verify`)", "")


def _fill(text: str, vals: dict) -> str:
    return re.sub(r"\{(org_name|slug|tagline)\}", lambda m: vals[m.group(1)], text)


def _idea_md(m: dict) -> str:
    c = m["budget"]["usd_per_month"]
    lines = ["---", f"org_name: {m['name']}", f"slug: {m['slug']}", f"owner: {m['owner']['name']}", f"owner_contact: set-in-secret-store ({m['owner']['contact_binding']})", f"owner_contact_backup: set-in-secret-store ({m['owner']['contact_binding_backup']}; a second address at a different provider, used when the first is refused)"]
    for k, v in m["facts"].items():
        if isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
    lines += ["---", "", "# Idea", "", m["idea"] or m["name"], "", "# Who it is for", "", f"- {m['kind']} programme owner and its stakeholders", "", "# First outcomes", ""]
    lines += [f"- {g}" for g in m["goals"]]
    g = m["goals"] or [m["name"]]
    lines += ["", "# System test", "", "All four are required (doctrine/VISION.md). They are written from the manifest so a generated system can bootstrap itself.", "",
              f"- Loop: {g[0]}, observed, acted on and observed again with no person in the middle",
              f"- Measure: {g[1] if len(g) > 1 else g[0]}, a named probe that can breach",
              "- Upkeep: failures, drift and new rules keep arriving, and the managers file the next improvement from the measures",
              f"- Run cost: {c} USD a month for the back end"]
    lines += ["", "# Constraints", "", f"- Budget per month: {c} USD"]
    st = m.get("system_test") or {}  # SEED-DEPLOY-2: bootstrap stage qualify reads this section; without it a generated seed never writes its worker config
    if st:
        lines += ["", "# System test", "", f"- Loop: {st['loop']}", f"- Measure: {st['measure']}", f"- Upkeep: {st['upkeep']}", f"- Run cost: {st.get('run_cost') or f'{c} USD a month for the back end'}"]
    if not m["disclosure"]["public_allowed"]:
        lines.append("- Nothing public until the owner says so")
    return "\n".join(lines) + "\n"


def _readme(m: dict) -> str:
    b = m["brand"]
    sep = "".join(f"\n{b['public_name']} is a separate brand from {s}." for s in b["separate_from"])
    return (f"# {b['public_name'] or m['name']}\n\n{b['tagline'] or m['positioning']}\n\n"
            f"Built on Ultrastable. {TAGLINE}{sep}\n\n{_autonomy()}\n\n"
            "Every decision, plan and result is in this repository (docs/PROJECT-MEMORY.md is the memory). Agents read `AGENTS.md` first.\n\n"
            "Boot: `python3 bootstrap/bootstrap.py --root . --dry-run`.\n")


def _memory(m: dict, date: str) -> str:
    return ("# Project memory (canonical)\n\n"
            f"Last updated: {date}\n\n"
            f"{TAGLINE} {_autonomy()} This file is the single source of truth for this system's memory; chat and tool memory only point here. Nothing lives only outside the repository.\n\n"
            "## Standing rules\n- If it is not in code, it does not exist.\n- Never handle secret values.\n- Agents act, verify and report; only identity-bound steps become one card with a default and a closing probe.\n"
            f"- Disclosure: public_allowed={m['disclosure']['public_allowed']}, gate={m['disclosure']['gate']}.\n\n"
            f"## Facts from the owner\n- Name: {m['name']}; kind: {m['kind']}; goals: {'; '.join(m['goals'])}\n\n"
            "## Current status\nBooted from the instance manifest; see org/boot-log.json and org/owner-steps.json.\n\n"
            "## Owner-only items\nSee org/owner-steps.json; at most one card per blocker.\n\n"
            "## Workstream map\nOne project per goal in org/charter.md.\n\n"
            "## Update protocol\nEvery session starts by reading this file and ends by updating it, with a new Last updated date.\n")


def generate(raw: dict, out, date: str, ctx: ownersteps.StepCtx | None = None, apply: bool = False) -> dict:
    """Scaffold an instance into `out`. Returns the summary also written to org/foundation-report.json."""
    problems = mf.validate(raw)
    if problems:
        raise ValueError("invalid manifest: " + "; ".join(problems))
    m = mf.resolve(raw)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    failures: list[dict] = []
    vals = {"org_name": m["name"], "slug": m["slug"], "tagline": TAGLINE}

    def step(name, fn):
        try:
            return fn()
        except Exception as e:  # recorded below as a backlog item
            failures.append({"id": f"FAIL-{name.upper()}", "title": f"Generator step '{name}' failed: {type(e).__name__}: {e}"[:300],
                             "owner_role": "operations", "closing_probe": f"generate again; org/foundation-report.json shows step {name} ok"})

    def copy_kernel():
        for rel in KERNEL_PATHS:
            src, dst = KERNEL / rel, out / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True, ignore=SKIP)
            elif src.exists():
                shutil.copy2(src, dst)
        for p in list(out.rglob("*.md")):
            p.write_text(_fill(p.read_text(encoding="utf-8"), vals), encoding="utf-8")

    def write_instance():
        (out / "instance.json").write_text(json.dumps(raw, indent=2) + "\n")
        (out / "IDEA.md").write_text(_idea_md(m))
        (out / "facts.json").write_text(json.dumps(mf.facts_for(m), indent=2) + "\n")
        (out / "README.md").write_text(_readme(m))
        (out / "docs").mkdir(exist_ok=True)
        (out / "docs" / "PROJECT-MEMORY.md").write_text(_memory(m, date))
        cfg = json.loads((KERNEL / "ultrastable.json").read_text())
        cfg["runtime"]["provider"] = m["runtime"]["provider"]
        cfg["org"] = {"name": m["repos"]["org"], "repos": m["repos"]["names"]}
        ids = {r["id"] for r in cfg["roles"]}
        if not m["funding"]["routes"]:  # a system with no funding routes carries no funding or outreach roles
            cfg["roles"] = [r for r in cfg["roles"] if r["id"] not in {"funding-manager", "outreach-manager", "outreach-coordinator"}]
        cfg["capacity"]["plus_share"] = cfg["capacity"]["plus_share"]
        (out / "ultrastable.json").write_text(json.dumps(cfg, indent=2) + "\n")
        (out / "actions-budget.json").write_text(json.dumps({"paused": False, "paused_workflows": [], "essential": ["checks"], "monthly_free_minutes": m["budget"]["actions_minutes_monthly"], "warn_at_pct": 60, "pause_at_pct": 85}, indent=2) + "\n")
        (out / "doctrine").mkdir(exist_ok=True)
        shutil.copy2(REPO / "doctrine" / "positioning.json", out / "doctrine" / "positioning.json")  # every instance carries the doctrine
        (out / "gaplint.json").write_text(json.dumps({"rules": ["GL001", "GL002", "GL003", "GL004", "GL006", "GL007", "GL008", "GL009"], "agent_rules": {"files": ["agents/AGENTS.md"]}, "tagline": {"doctrine": "doctrine/positioning.json"}}, indent=2) + "\n")
        wf = out / ".github" / "workflows"
        wf.mkdir(parents=True, exist_ok=True)
        (wf / "checks.yml").write_text(
            "name: checks\n# budget: about 2 min per ready PR update\n# trigger: pull requests only; no schedule\n# free-alternative: run the same commands in the cloud-hosted agent session\n"
            "on:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\nconcurrency:\n  group: checks-${{ github.ref }}\n  cancel-in-progress: true\npermissions:\n  contents: read\n"
            "jobs:\n  checks:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - uses: actions/checkout@v4\n      - run: python3 bootstrap/bootstrap.py --root . --dry-run\n")

    def cases_and_plans():
        sys_path = str(KERNEL / "bootstrap")
        import sys
        sys.path.insert(0, sys_path)
        try:
            import cases as case_library
        finally:
            sys.path.remove(sys_path)
        plan = case_library.plan_cases(mf.facts_for(m))
        (out / "org").mkdir(exist_ok=True)
        (out / "org" / "bootstrap-cases.json").write_text(json.dumps(plan, indent=2) + "\n")
        return plan

    def autonomy():
        """SEED-ADMIT-1: the system builds and deploys the seed and makes it autonomous. Wire the kit (deploy loop, year simulation, failure audit, SLA sweeper,
        merge monitor, site liveness, temporal drift, weekly re-admission), then admit it: the year simulation runs on the new system's own recovery code."""
        e = seedadmit._engine()
        wired = e.wire(out, KERNEL)
        rec = e.admit(out, slug=m["slug"], apply=True, src=KERNEL)
        (out / "org").mkdir(exist_ok=True)
        (out / "org" / "launch.json").write_text(json.dumps({"slug": m["slug"], "launched": rec["status"] == "admitted", "admission": rec["status"], "wired": wired["added"],
                                                            "reasons": rec["reasons"], "expires": rec["expires"]}, indent=2) + "\n")
        if rec["status"] != "admitted":
            raise RuntimeError("seed held at admission: " + "; ".join(rec["reasons"])[:240])

    step("kernel", copy_kernel)
    step("instance", write_instance)
    step("autonomy", autonomy)
    step("genesis", lambda: genesis.write(m, out))
    cases_plan = step("cases", cases_and_plans) or {"applicable": [], "cards": []}
    c = ctx or ownersteps.StepCtx()
    c.facts = {**mf.facts_for(m), **{k: v for k, v in c.facts.items()}}
    pre = step("preflight", lambda: preflight.run(c, str(out))) or {}
    steps_res = step("owner_steps", lambda: ownersteps.evaluate_all(m, c, out, apply)) or {"results": [], "cards": [], "summary": {}}
    for k, doc in (("preflight", pre), ("owner-steps", steps_res)):
        (out / "org").mkdir(exist_ok=True)
        (out / "org" / f"{k}.json").write_text(json.dumps(doc, indent=2) + "\n")
    cards = steps_res["cards"]
    (out / "org" / "OWNER-CARD.md").write_text(
        "# Owner card (identity-bound steps only)\n\n" + TAGLINE + " Everything else is done by the fleet. Each item states its default in effect and a closing probe.\n\n"
        + ("".join(f"## {x['id']}\n- {x['line']}\n- Why gated: {x['why']}\n- Default in effect: {x['default_in_effect']}\n- Closing probe: {x['closing_probe']}\n\n" for x in cards) or "No open cards.\n"))
    wf_problems = minutes.check_dir(out / ".github" / "workflows")
    if wf_problems:
        failures.append({"id": "FAIL-MINUTES", "title": "; ".join(wf_problems)[:300], "owner_role": "operations", "closing_probe": "minutes.check_dir returns []"})
    (out / "org" / "failures.json").write_text(json.dumps(failures, indent=2) + "\n")
    report = {"foundation_version": __version__, "slug": m["slug"], "generated": date, "cases_matched": len(cases_plan["applicable"]),
              "owner_steps": steps_res["summary"], "cards": [x["id"] for x in steps_res["cards"]], "failures": [f["id"] for f in failures],
              "status": "ok" if not failures else "degraded"}
    (out / "org" / "foundation-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report
