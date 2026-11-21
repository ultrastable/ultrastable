# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-ADMIT-1: a seed counts as launched only when it can run a year unattended, proven on its own code. Ultrastable is the foundation for any autonomous system.

  python3 scripts/seedadmit.py --audit [--root DIR]            which kit components the system holds and whether each probe passes
  python3 scripts/seedadmit.py --wire  [--root DIR]            add what is missing from the core kit (additive: an existing file is never overwritten)
  python3 scripts/seedadmit.py --admit [--root DIR] [--apply]  audit, run the year simulation on the system's own recovery code, write ops/admission.json
  python3 scripts/seedadmit.py --check                         the kit itself is well formed (every file, test and template exists in the seed)
  python3 scripts/seedadmit.py --workflow-check                the installed autonomy workflow carries the budget headers, a timeout, a concurrency group and the HALT guard

The kit is data (autonomy/kit.json). Admission needs (1) every component's files present and its probe green, (2) the declared year-simulation faults include
every required fault, each with a drill that recovers (a fault with no drill is declared, never read as a pass), (3) the seeded Monte Carlo year reaching
target_days at the 10th percentile in normal and strict mode (strict: every identity gate fails alongside). The verdict is `admitted` or `held` with its
reasons; a held seed is not launched and its repair items name the failing component. The record expires after max_age_days, so a system that stops
re-admitting itself stops counting as launched. No credential is read: every route is the repository's built-in token and the existing GitHub App."""
from __future__ import annotations
import datetime as dt, hashlib, json, re, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT_SRC = HERE.parent  # the seed (or a system that carries one): files the kit asks for are copied from here when missing
KIT = "autonomy/kit.json"
RECORD = "ops/admission.json"
sys.path.insert(0, str(HERE))


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def kit(root=KIT_SRC) -> dict:
    return json.loads((Path(root) / KIT).read_text(encoding="utf-8"))


def _probe(cmd, root, timeout=180) -> tuple[bool, str]:
    try:
        p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
        out = (p.stdout + p.stderr).strip().splitlines()
        bad = [l.strip() for l in out if l.startswith(("not ok", "# Error", "Error", "AssertionError")) or "error:" in l]  # the failing test, not the TAP footer
        return p.returncode == 0, ("; ".join(bad[:3]) or (out or ["(no output)"])[-1])[:240]
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"{type(e).__name__}: {str(e)[:120]}"


GENERATED = {"worker/src/config.js"}  # written by the bootstrap `write` stage on the system itself, never carried in the seed
IMPORT = re.compile(r"""(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}/[^'"]+)['"]""")


def escapes(root) -> list[str]:
    """SEED-SELFCONTAINED-1: every relative import in the worker resolves to a file inside the system. A module that reaches into the platform's own
    layout (../../../site, ../../../workers/core) works in the platform's checkout and fails the first time the system is generated and deployed alone."""
    root, out = Path(root).resolve(), []
    for p in sorted((root / "worker" / "src").rglob("*.js")) if (root / "worker" / "src").is_dir() else []:
        if "node_modules" in p.parts:
            continue
        for rel in IMPORT.findall(p.read_text(encoding="utf-8")):
            t = (p.parent / rel).resolve()
            if t.is_relative_to(root) and t.relative_to(root).as_posix() in GENERATED:
                continue
            if not t.is_file() and not t.with_suffix(".js").is_file():
                out.append(f"{p.relative_to(root).as_posix()} imports {rel}, which is not in the system")
    return out


def audit(root, k=None, probes=True) -> dict:
    root, k, out = Path(root), k or kit(root), {}
    for c in k["components"]:
        missing = [f for f in c["files"] if not (root / f).is_file()]
        ok, ev = (False, "missing: " + ", ".join(missing)) if missing else ((True, "files present") if not probes else _probe(c["probe"], root))
        out[c["id"]] = {"ok": ok, "evidence": ev, "missing": missing}
    esc = escapes(root)
    out["self-contained"] = {"ok": not esc, "evidence": "; ".join(esc[:3]) or "every relative import resolves inside the system", "missing": []}
    return out


def wire(root, src=KIT_SRC, k=None) -> dict:
    """Additive: copy each missing kit file from the core kit source; install workflow templates under .github/workflows. Never overwrites."""
    root, src, k = Path(root), Path(src), k or kit(src)
    added, kept, absent = [], [], []
    for rel in [KIT] + [f for c in k["components"] for f in c["files"]]:
        dst = root / rel
        if dst.is_file():
            kept.append(rel)
            continue
        tpl = next((c["template"]["from"] for c in k["components"] if rel in c["files"] and c.get("template")), None)
        origin = src / (tpl if tpl and rel.startswith(".github/") else rel)
        if origin.is_file():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, dst)
            added.append(rel)
        else:
            absent.append(rel)
    return {"added": added, "kept": len(kept), "absent": absent}


def faults_ok(root, k, drills_run: dict | None = None) -> tuple[list[str], dict]:
    import yearsim as ys
    c = ys.cfg(root)
    have = {f["id"]: f for f in c["faults"]}
    reasons = [f"required fault {x} is not declared" for x in k["required_faults"] if x not in have]
    reasons += [f"fault {fid} has no drill: declared, not exercised" for fid, f in have.items() if not f.get("drill")]
    return reasons, c


def admit(root, slug=None, apply=False, today=None, src=KIT_SRC, runs=None) -> dict:
    import yearsim as ys
    root = Path(root)
    k = kit(root) if (root / KIT).is_file() else kit(src)
    comps = audit(root, k)
    reasons = [f"{cid}: {v['evidence']}" for cid, v in comps.items() if not v["ok"]]
    pre, _ = faults_ok(root, k)
    reasons += pre
    try:
        rec = ys.run(root, apply=False, today=today, runs=runs)
    except (OSError, ValueError, KeyError) as e:
        rec = None
        reasons.append(f"year simulation could not run: {type(e).__name__}: {str(e)[:120]}")
    year = {}
    if rec:
        year = {"target_days": rec["target_days"], "p10": rec["horizon"]["p10"], "p50": rec["horizon"]["p50"], "survive_year": rec["horizon"]["survive_year"],
                "strict_p10": rec["strict"]["p10"], "strict_survive_year": rec["strict"]["survive_year"], "killers": rec["horizon"]["killers"] or rec["strict"]["killers"]}
        reasons += [f"drill {fid} did not recover: {d['evidence']}" for fid, d in rec["drills"].items() if d["exercised"] and not d["recover"]]
        if rec["target_days"] < k["target_days"]:
            reasons.append(f"target_days {rec['target_days']} is below the kit minimum {k['target_days']}")
        if (year["p10"] or 0) < k["target_days"]:
            reasons.append(f"year simulation p10 {year['p10']} days is below {k['target_days']}")
        if (year["strict_p10"] or 0) < k["target_days"]:
            reasons.append(f"strict year simulation p10 {year['strict_p10']} days is below {k['target_days']}")
    now = _now()
    cfgsha = hashlib.sha256((root / ys.CONF).read_bytes()).hexdigest()[:16] if (root / ys.CONF).is_file() else None
    if not slug and (root / "instance.json").is_file():
        slug = json.loads((root / "instance.json").read_text(encoding="utf-8")).get("slug")
    out = {"slug": slug,
           "status": "held" if reasons else "admitted", "at": now.isoformat().replace("+00:00", "Z"),
           "expires": (now + dt.timedelta(days=k["max_age_days"])).isoformat().replace("+00:00", "Z"), "kit_version": k["version"],
           "reasons": reasons, "components": {cid: v["ok"] for cid, v in comps.items()}, "year": year, "yearsim_config_sha": cfgsha}
    if apply:
        p = root / RECORD
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return out


def fresh(rec: dict, now=None) -> bool:
    now = now or _now()
    try:
        return rec.get("status") == "admitted" and dt.datetime.fromisoformat(rec["expires"].replace("Z", "+00:00")) > now
    except (KeyError, ValueError):
        return False


def check(src=KIT_SRC) -> list[str]:
    src, errs = Path(src), []
    try:
        k = kit(src)
    except (OSError, ValueError) as e:
        return [f"kit unreadable: {e}"]
    if k.get("target_days", 0) < 365:
        errs.append("target_days is never below 365")
    ids = [c["id"] for c in k["components"]]
    if len(ids) != len(set(ids)):
        errs.append("duplicate component id")
    covered = {x for c in k["components"] for x in c.get("covers", [])}
    errs += [f"required fault {f} is covered by no component" for f in k["required_faults"] if f not in covered]
    for c in k["components"]:
        for f in c["files"]:
            tpl = c.get("template", {}).get("from") if f.startswith(".github/") else None
            if not (src / (tpl or f)).is_file():
                errs.append(f"{c['id']}: {tpl or f} does not exist in the seed")
        for a in c["probe"]:
            if re.match(r"worker/test/.+\.test\.js$", a) and not (src / a).is_file():
                errs.append(f"{c['id']}: probe test {a} does not exist")
    return errs


def workflow_check(root=KIT_SRC) -> list[str]:
    p = Path(root) / ".github/workflows/autonomy.yml"
    p = p if p.is_file() else Path(root) / "autonomy-kit/autonomy.workflow.yml"
    t = p.read_text(encoding="utf-8")
    need = {"# budget:": "budget header", "# trigger:": "trigger header", "# free-alternative:": "free-alternative header", "timeout-minutes": "timeout", "concurrency:": "concurrency group", "vars.HALT": "HALT guard"}
    errs = [f"autonomy workflow lacks {w}" for k, w in need.items() if k not in t]
    errs += [f"autonomy workflow uses {m} (only the built-in token is allowed)" for m in re.findall(r"secrets\.(?!GITHUB_TOKEN)\w+", t)]
    return errs


def _arg(a, name, default=None):
    return a[a.index(name) + 1] if name in a else default


if __name__ == "__main__":
    a = sys.argv[1:]
    root = Path(_arg(a, "--root", Path.cwd()))
    if "--check" in a:
        e = check(root if (root / KIT).is_file() else KIT_SRC)
    elif "--workflow-check" in a:
        e = workflow_check(root)
    elif "--wire" in a:
        r = wire(root)
        print(json.dumps(r))
        e = [f"not in the kit source: {x}" for x in r["absent"]]
    elif "--audit" in a:
        r = audit(root)
        print(json.dumps(r, indent=1))
        e = [f"{k}: {v['evidence']}" for k, v in r.items() if not v["ok"]]
    elif "--admit" in a:
        r = admit(root, apply="--apply" in a)
        print(json.dumps({k: r[k] for k in ("status", "reasons", "year")}, indent=1))
        sys.exit(0 if r["status"] == "admitted" else 1)
    else:
        print(__doc__)
        sys.exit(2)
    print("seedadmit ok" if not e else "\n".join(e))
    sys.exit(1 if e else 0)
