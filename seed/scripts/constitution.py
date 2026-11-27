# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CONSTITUTION-1: what an ultrastable system is, how it runs, bootstraps, becomes autonomous and reaches criticality, as data the system reads.

Rowan, 2026-11-25: "something's missing in the core ultra-stable template that's not saying, hey, this is what an ultra-stable system is ...
The user should never have to provide all of this." Ultrastable is the foundation for any autonomous system.

doctrine/constitution.json is the statement. This engine ships in every seed and does four things:

  --check      every section agrees with the code it describes (tick steps, boot stages, ladder rungs, ignition stages, knobs, criticality
               conditions); every rule names a detector and a remediation that exist as code; the generated prose is current; the agent
               instructions import it; a standing rule written into the instructions with no entry here fails.
  --render     write doctrine/CONSTITUTION.md from the JSON (agents import it, so a session starts knowing the system without being told).
  --assemble   write org/constitution.json: the live configuration the boot reads (rungs, tick steps, detector list, conditions).
  --probe      run every {probe: [argv]} binding in the system root; exit 1 when one fails. A probe is a kit test only (`node --test <file>`
               or `python3 -m unittest <module>`), run by scripts/system.py run_test: argv, no shell, a timeout.

Binding forms: {file, has?}, {test: "path::name"}, {probe: [argv]}, and {platform: true} (verified only when a platform tree is given).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SEED = Path(__file__).resolve().parents[1]
PATH = "doctrine/constitution.json"
PROSE = "doctrine/CONSTITUTION.md"
BASELINE = "doctrine/constitution-baseline.json"
IMPORT_LINE = "@doctrine/CONSTITUTION.md"
RULE_ID = re.compile(r"\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b")


def load(root: Path = SEED) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _read(root: Path, rel: str) -> str | None:
    p = Path(root) / rel
    if p.is_dir():
        return ""
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else None


def resolves(root: Path, b: dict, platform: Path | None = None) -> tuple[bool, str]:
    """(ok, why). A platform binding is verified only when a platform root is given; otherwise it is reported as skipped (ok)."""
    if b.get("platform"):
        if platform is None:
            return True, "skipped"
        root = platform
    if "test" in b:
        f, _, name = b["test"].partition("::")
        t = _read(root, f)
        return (t is not None and name in t), f"test {b['test']}"
    if "probe" in b:  # only a kit test, run the one way scripts/system.py runs a test (argv, no shell, a timeout)
        return _system(root).allowed(Path(root), list(b["probe"])), f"probe {' '.join(b['probe'])} (a kit test: node --test or python3 -m unittest)"
    if "file" in b:
        t = _read(root, b["file"])
        if t is None:
            return False, f"file {b['file']} missing"
        if b.get("has") and b["has"] not in t:
            return False, f"file {b['file']} lacks {b['has']!r}"
        return True, "ok"
    return False, f"unknown binding {b}"


def _validate(v, s: dict, at: str) -> list[str]:
    """The subset of JSON Schema the constitution uses: type, const, required, properties, items, minItems, pattern."""
    types = {"object": dict, "array": list, "string": str}
    e: list[str] = []
    if "type" in s and not isinstance(v, types[s["type"]]):
        return [f"{at} should be {s['type']}"]
    if "const" in s and v != s["const"]:
        e.append(f"{at} should be {s['const']!r}")
    if "pattern" in s and not re.search(s["pattern"], v):
        e.append(f"{at} {v!r} does not match {s['pattern']}")
    if isinstance(v, dict):
        e += [f"{at} lacks {k}" for k in s.get("required", []) if k not in v]
        for k, sub in s.get("properties", {}).items():
            if k in v:
                e += _validate(v[k], sub, f"{at}.{k}")
    if isinstance(v, list):
        if len(v) < s.get("minItems", 0):
            e.append(f"{at} needs at least {s['minItems']} item(s)")
        for i, x in enumerate(v):
            if "items" in s:
                e += _validate(x, s["items"], f"{at}[{i}]")
    return e


def _system(root: Path | None = None):
    """scripts/system.py reads the code of record (tick order, boot stages) and owns the one test runner; this engine reuses it, never a copy.

    It is loaded from the root being checked, so a boot that imported this module once (bootstrap.py `constitute`, cached in sys.modules)
    still reads the system it is booting and never a tree an earlier boot used and then removed. A root with no scripts/system.py falls back to
    the copy beside this file."""
    import importlib.util
    p = Path(root) / "scripts" / "system.py" if root is not None else None
    if p is None or not p.is_file():
        p = Path(__file__).resolve().parent / "system.py"
    spec = importlib.util.spec_from_file_location("ultrastable_system", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _steps(root: Path) -> list[str]:
    """The order a tick runs (STEP_ORDER in worker/src/tick.js) over the step functions STEPS defines: a name in one and not the other shows up."""
    order, defined = _system(root).step_names(Path(root))
    return [n for n in order if n in defined] + [n for n in defined if n not in order]


def _boot_stages(root: Path) -> list[str]:
    return [n for n, _ in _system(root).boot_stages(Path(root), guarded=False)]


def _ignition_stages(root: Path) -> list[str]:
    t = _read(root, "worker/src/ignition.js") or ""
    m = re.search(r"export const STAGES = \[([^\]]*)\]", t)
    return re.findall(r"'([a-z-]+)'", m.group(1)) if m else []


def _same(label: str, declared: list[str], actual: list[str], errs: list[str]) -> None:
    if list(declared) != list(actual):
        errs.append(f"{label}: constitution says {list(declared)} but the code has {list(actual)}")


def instruction_ids(root: Path, files: list[str]) -> set[str]:
    """Standing-rule ids written into agent instructions: the ids in the bold head of a bullet."""
    out: set[str] = set()
    for f in files:
        for line in (_read(root, f) or "").splitlines():
            m = re.match(r"\s*[-*]\s+\*\*(.+?)\*\*", line)
            if m:
                out |= set(RULE_ID.findall(m.group(1)))
    return out


def check(root: Path = SEED, platform: Path | None = None, instruction_files: list[str] | None = None,
          baseline: set[str] | None = None) -> list[str]:
    root = Path(root)
    errs: list[str] = []
    try:
        c = load(root)
    except (OSError, ValueError) as e:
        return [f"{PATH} unreadable: {e}"]

    def bind(where: str, b: dict) -> None:
        ok, why = resolves(root, b, platform)
        if not ok:
            errs.append(f"{where}: {why}")

    # shape: the JSON Schema 2020-12 file named by `$schema` (checked here without a validator dependency: required keys, types, minItems)
    sp = c.get("$schema")
    sj = json.loads(_read(root, "doctrine/" + sp) or "null") if sp else None
    if not sj:
        errs.append(f"{PATH} names no readable $schema (JSON Schema 2020-12 file beside it)")
    else:
        errs += [f"schema: {e}" for e in _validate(c, sj, "constitution")]

    # identity
    ident = c["identity"]
    goals = json.loads(_read(root, "autonomy/goals.json") or "{}")
    knob_ids = {k["id"] for k in goals.get("knobs", [])}
    for k in ident["step_function"]["knobs"]:
        if k not in knob_ids:
            errs.append(f"identity.step_function: knob {k} is not in autonomy/goals.json")
    for k in ("code", "bounds"):
        bind(f"identity.step_function.{k}", ident["step_function"][k])
    for v in ident["essential_variables"]:
        bind(f"identity.essential_variables.{v['id']}", v["measured_by"])

    # run loop
    rl = c["run_loop"]
    _same("run_loop.tick_steps", list(rl["tick_steps"]), _steps(root), errs)
    for k in ("cron", "tick_code"):
        bind(f"run_loop.{k}", rl[k])
    for k in ("register", "runner"):
        bind(f"run_loop.detectors.{k}", rl["detectors"][k])
    for k in ("executor", "release_cadence", "changes_feed"):
        bind(f"run_loop.{k}", rl[k]["code"])
    modes = json.loads(_read(root, "autonomy/failure-modes.json") or "{}").get("modes", [])
    if not modes or any(not m.get("probe") for m in modes):
        errs.append("run_loop.detectors: autonomy/failure-modes.json must list modes and every mode needs a probe")

    # bootstrap
    bs = c["bootstrap"]
    _same("bootstrap.stages", bs["stages"], _boot_stages(root), errs)
    bind("bootstrap.code", bs["code"])
    bind("bootstrap.from_zero", bs["from_zero"])
    for i, b in enumerate(bs["proof"]):
        bind(f"bootstrap.proof[{i}]", b)

    # ladder
    al = c["autonomy_ladder"]
    pol = json.loads(_read(root, "autonomy/policy.json") or "{}")
    _same("autonomy_ladder.rungs", al["rungs"], pol.get("ladder", {}).get("rungs", []), errs)
    _same("autonomy_ladder.ignition_stages", al["ignition_stages"], _ignition_stages(root), errs)
    if al["bootstrapped_at"] not in al["ignition_stages"]:
        errs.append("autonomy_ladder.bootstrapped_at is not an ignition stage")
    for k in ("code", "ignition_code"):
        bind(f"autonomy_ladder.{k}", al[k])

    # criticality
    seen = set()
    for cond in c["criticality"]["conditions"]:
        if cond["id"] in seen:
            errs.append(f"criticality.{cond['id']} declared twice")
        seen.add(cond["id"])
        bind(f"criticality.{cond['id']}.measured_by", cond["measured_by"])
        bind(f"criticality.{cond['id']}.config", cond["config"])

    # rules: each names a detector and a remediation, as code that exists
    ids = set()
    for r in c["rules"]:
        if r["id"] in ids:
            errs.append(f"rule {r['id']} declared twice")
        ids.add(r["id"])
        for role in ("detector", "remediation"):
            bs_ = r.get(role) or []
            if not bs_:
                errs.append(f"rule {r['id']}: no {role}. A rule with no code is not a rule")
                continue
            for i, b in enumerate(bs_):
                bind(f"rule {r['id']} {role}[{i}]", b)
            if not any(not b.get("platform") for b in bs_):
                errs.append(f"rule {r['id']}: {role} has no binding that exists in a system's own tree (a seed must hold the code that enforces its rules)")

    # generated prose is current and imported
    if _read(root, PROSE) != render(c):
        errs.append(f"{PROSE} is stale: run python3 scripts/constitution.py --render")
    claude = _read(root, "CLAUDE.md")
    # a CLAUDE.md that is only an @AGENTS.md pointer loads the constitution through the file it imports
    named = claude is not None and any(
        "doctrine/CONSTITUTION.md" in (_read(root, i) or "") for i in re.findall(r"^@(\S+)", claude, re.M)
    )
    if claude is not None and IMPORT_LINE not in claude.splitlines() and not named:
        errs.append(f"CLAUDE.md does not import {IMPORT_LINE}: a session would start without the constitution")

    # a standing rule written into the instructions needs an entry here (the shrink-only baseline lists those not yet mapped)
    if baseline is None:
        bj = _read(root, BASELINE)
        baseline = set(json.loads(bj)["unmapped"]) if bj else set()
    if instruction_files:
        mapped = ids | {i for r in c["rules"] for i in r.get("covers", [])}
        for rid in sorted(baseline & mapped):
            errs.append(f"{BASELINE} lists {rid}, which the constitution now covers: remove it (the baseline only shrinks)")
        covered = mapped | baseline
        for rid in sorted(instruction_ids(root, instruction_files) - covered):
            errs.append(f"standing rule {rid} is in the agent instructions but has no entry in {PATH} (add a rule with its detector and remediation, or list it under `covers`)")
    return errs


def render(c: dict) -> str:
    o = ["<!-- generated by scripts/constitution.py --render from doctrine/constitution.json (generated-by: scripts/constitution.py). Do not edit; --check fails when stale. -->",
         "# The constitution: what an ultrastable system is", "", f"> {c['statement']}", "",
         "Read this first. It is generated from `doctrine/constitution.json`, which the system reads at boot and checks against its own code, so nothing here "
         "has to be told to the system by a person.", "", "## Identity", "", c["identity"]["what"], "", "Essential variables (kept inside limits):", ""]
    o += [f"- `{v['id']}`: {v['limit']}" for v in c["identity"]["essential_variables"]]
    o += ["", c["identity"]["step_function"]["what"], "", "## How it runs", "", c["run_loop"]["what"], "", "Tick steps, in order:", ""]
    o += [f"{i}. `{k}`: {v}" for i, (k, v) in enumerate(c["run_loop"]["tick_steps"].items(), 1)]
    rl = c["run_loop"]
    o += ["", f"Detectors: {rl['detectors']['rule']}.", f"Executor: {rl['executor']['rule']}.", f"Release cadence: {rl['release_cadence']['rule']}.",
          f"Changes feed: {rl['changes_feed']['rule']}.", "", "## How it bootstraps", "", c["bootstrap"]["what"], "",
          "Stages: " + " > ".join(f"`{s}`" for s in c["bootstrap"]["stages"]) + ".", "", "## How it becomes autonomous", "", c["autonomy_ladder"]["what"], "",
          "Rungs: " + " > ".join(c["autonomy_ladder"]["rungs"]) + ".", "",
          "Ignition stages (read by the system from its own tables): " + " > ".join(c["autonomy_ladder"]["ignition_stages"]) +
          f". Bootstrapped from `{c['autonomy_ladder']['bootstrapped_at']}`; criticality is the two stages above that.", "",
          "## Criticality", "", c["criticality"]["what"], ""]
    o += [f"- `{x['metric']}` {x['op']} {x['value']}" for x in c["criticality"]["conditions"]]
    o += ["", f"When below: {c['criticality']['when_below']}.", "", "## Standing rules", "",
          "Each rule has a detector that sees it break and a remediation that repairs it, both code. A rule with none fails CI.", ""]
    for r in c["rules"]:
        det = ", ".join(_name(b) for b in r["detector"])
        rem = ", ".join(_name(b) for b in r["remediation"])
        o += [f"- **{r['id']}** ({r['source']}): {r['rule']}", f"  - detector: {det}", f"  - remediation: {rem}"]
    return "\n".join(o) + "\n"


def _name(b: dict) -> str:
    return f"`{b.get('test') or b.get('file') or ' '.join(b.get('probe', []))}`" + (" (platform)" if b.get("platform") else "")


def assemble(root: Path = SEED) -> dict:
    """The configuration the boot reads: what the system is made of, as it is now, not as it was described."""
    c = load(root)
    return {"constitution": c["id"], "version": c["version"], "rungs": c["autonomy_ladder"]["rungs"],
            "ignition_stages": c["autonomy_ladder"]["ignition_stages"], "bootstrapped_at": c["autonomy_ladder"]["bootstrapped_at"],
            "tick_steps": list(c["run_loop"]["tick_steps"]), "boot_stages": c["bootstrap"]["stages"],
            "failure_modes": [m["id"] for m in json.loads(_read(root, "autonomy/failure-modes.json") or "{}").get("modes", [])],
            "criticality": [{k: x[k] for k in ("id", "metric", "op", "value")} for x in c["criticality"]["conditions"]],
            "rules": [{"id": r["id"], "detector": r["detector"], "remediation": r["remediation"]} for r in c["rules"]]}


def probes(root: Path = SEED) -> list[str]:
    errs, system = [], _system(root)
    for r in load(root)["rules"]:
        for b in r["detector"] + r["remediation"]:
            if "probe" in b:
                ok, why = system.run_test(Path(root), list(b["probe"]))
                if not ok:
                    errs.append(f"rule {r['id']}: {why}")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    root = SEED
    if "--render" in a:
        (root / PROSE).write_text(render(load(root)), encoding="utf-8")
        print(f"wrote {PROSE}")
        return 0
    if "--assemble" in a:
        out = Path(a[a.index("--assemble") + 1]) if len(a) > a.index("--assemble") + 1 else root / "org" / "constitution.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(assemble(root), indent=1) + "\n", encoding="utf-8")
        print(f"wrote {out}")
        return 0
    e = probes(root) if "--probe" in a else check(root, instruction_files=["AGENTS.md", "agents/AGENTS.md"])
    print("constitution ok" if not e else "\n".join(e))
    return 1 if e else 0


if __name__ == "__main__":
    sys.exit(main())
