# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MANAGERS-1 (Rowan, 2026-11-25): every manager role is a running loop that owns code, for the platform and for every system made from the
seed. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation managers --check     every role file has a register row, a loop it owns besides role-<id>, code that exists, a clock, a
                                             closing probe that is not its own role file and code that settles what it files; every loop is owned
                                             by a role; the seed register carries every platform manager (or a recorded reason) with safe defaults
  python3 -m foundation managers --report    the role, loop, code, clock, probe matrix as JSON, with each owner's filed, fixed, shelved and open items
  python3 -m foundation managers --sync      rewrite the generated `What you own` block of every role file from the register and the loop registry
  python3 -m foundation managers --clocks    scheduled manager workflows that are not clocks in doctrine/clocks.json (exit 1 while any is left)
  python3 -m foundation managers --closure   per manager, how its ended items ended; exit 1 when one mostly ends shelved (files more than it closes)
  python3 -m foundation managers --roles     ROLE-ALIGN-1: each role with the human software-organization title it stands in for, what it decides and whom it
                                             hands to, then every software function with the roles and code that cover it, or its gap item (JSON with --json)
  python3 -m foundation managers --live      read the runtime (public GET, no credential): every switched-on manager is hired and its dispatch beat
                                             is inside its cadence; exit 1 names the missing, late and stopped ones (detector managers-live)

A role with a file and no loop is a title, not a manager. Data: doctrine/managers.json (platform evidence per role), seed/autonomy/managers.json
(the one register every system carries: which managers run, switched by data), instances/ultrastable/loop-registry.json, doctrine/clocks.json.
Runtime: seed/worker/src/managers.js hires every switched-on manager inside the tick's reconcile step. Tests: tests/foundation/test_managers.py,
seed/worker/test/managers.test.js."""
from __future__ import annotations
import datetime as dt, json, re, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/managers.json"
ALIGN = ("human_role", "decides", "inputs", "hands_to", "cadence")  # ROLE-ALIGN-1: what a role stands in for, decides, reads and hands on
SEED_ALIGN = ("human_role", "decides", "hands_to")  # the part a seeded system carries; `inputs` are platform paths
FUNCTIONS = ("product-management", "program-delivery-management", "engineering-management", "software-engineering", "code-review", "qa-test", "release-management",
             "sre-operations", "platform-infrastructure", "security", "data-analytics", "ux-research", "ui-design", "technical-writing", "developer-relations",
             "marketing", "sales-partnerships", "customer-support-success", "finance-finops", "legal-compliance", "people-org-design", "research")
TREES = {"platform": "agents/roles", "seed": "seed/agents/roles"}
CLOCK_KINDS = ("runtime", "clock", "workflow")


def _j(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def role_files(root, tree) -> list[str]:
    d = Path(root) / TREES[tree]
    return sorted(p.stem for p in d.glob("*.md")) if d.is_dir() else []


def loops_of(root) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for l in _j(root, "instances/ultrastable/loop-registry.json").get("loops", []):
        out.setdefault(l.get("owner") or "", []).append(l)
    return out


def _spec_ok(root, spec: str) -> tuple[bool, str]:
    """file:PATH, grep:PATH::NEEDLE or cmd:... (python3 -m foundation X needs foundation/X.py; python3 PATH needs PATH). Nothing is executed."""
    kind, _, rest = str(spec).partition(":")
    root = Path(root)
    if kind == "file":
        return (root / rest).is_file(), f"{rest} does not exist"
    if kind == "grep":
        path, _, needle = rest.partition("::")
        f = root / path
        return f.is_file() and bool(needle) and needle in f.read_text(encoding="utf-8", errors="replace"), f"{path} does not contain {needle!r}"
    if kind == "cmd":
        a = rest.split()
        if a[:3] == ["python3", "-m", "foundation"] and len(a) > 3:
            return (root / "foundation" / (a[3].split(".")[-1] + ".py")).is_file(), f"foundation/{a[3]}.py does not exist"
        if a[:1] == ["python3"] and len(a) > 1:
            return (root / a[1]).is_file(), f"{a[1]} does not exist"
        return False, "a cmd probe must be python3 -m foundation <module> or python3 <script>"
    return False, f"unknown probe kind {kind!r}"


def _clock_ok(root, spec: str, clocks: set, seeded: set, rid: str) -> str:
    kind, _, rest = str(spec).partition(":")
    if kind == "runtime":
        return "" if rid in seeded else "clock runtime needs the role in the seed register (the tick hires and beats only registered managers)"
    if kind == "clock":
        return "" if rest in clocks else f"clock {rest} is not in doctrine/clocks.json"
    if kind == "workflow":
        f = Path(root) / ".github/workflows" / rest
        return "" if f.is_file() and re.search(r"^\s*schedule:", f.read_text(encoding="utf-8"), re.M) else f"workflow {rest} does not exist or has no schedule"
    return f"unknown clock kind {kind!r} (use {', '.join(CLOCK_KINDS)})"


def _texts(v) -> bool:
    return isinstance(v, list) and bool(v) and all(isinstance(x, str) and x.strip() for x in v)


def align_problems(root, rid: str, r: dict, known: set) -> list[str]:
    """ROLE-ALIGN-1: a role says which human role it stands in for, what it decides alone, what it reads and whom it hands to; all of it resolves."""
    root, bad = Path(root), []
    if not str(r.get("human_role", "")).strip():
        bad.append(f"{rid}: no human_role: nothing says which software-organization role it stands in for")
    if not _texts(r.get("decides")):
        bad.append(f"{rid}: decides is missing or empty: a role that decides nothing is a title")
    if not str(r.get("cadence", "")).strip():
        bad.append(f"{rid}: no cadence")
    if not _texts(r.get("inputs")):
        bad.append(f"{rid}: inputs is missing or empty: it decides from no measurement or ledger")
    for p in r.get("inputs") or []:
        if not (root / str(p)).exists():
            bad.append(f"{rid}: input {p} does not exist")
    if not _texts(r.get("hands_to")):
        bad.append(f"{rid}: hands_to is missing or empty: its work reaches nobody")
    for h in r.get("hands_to") or []:
        if h not in known:
            bad.append(f"{rid}: hands_to {h}, which is not a role")
        elif h == rid:
            bad.append(f"{rid}: hands_to itself")
    return bad


def owned_paths(root, pol=None) -> dict[str, set]:
    """Per role, the code it owns: its `runs` and the system_path of every loop it owns."""
    pol = pol or _j(root, POLICY)
    out = {rid: set(r.get("runs", [])) for rid, r in pol.get("roles", {}).items()}
    for owner, ls in loops_of(root).items():
        for l in ls:
            out.setdefault(owner, set()).update(l.get("system_path") or [])
    return out


def item_state(root, iid: str) -> str:
    """missing, open, fixed, or the recorded disposition (shelved, gate: its closing probe still runs on every fleet pass)."""
    f = Path(root) / "docs/issues" / f"{iid}.json"
    try:
        body = json.loads(f.read_text(encoding="utf-8")).get("body") or ""
    except (OSError, ValueError, AttributeError):
        return "missing"
    st, d = re.search(r"\*\*Status:\*\*\s*(\w+)", body), re.search(r"\*\*Disposition:\*\*\s*([a-z]+)", body)
    return "open" if st and st.group(1) == "open" else (d.group(1) if d else "closed")


def coverage_problems(root, pol: dict, known: set) -> list[str]:
    """ROLE-ALIGN-1: every standard function of a software organization is covered by roles and by code one of them owns, or is a gap with a
    filed Q-ROLE-* item. An item that ended fixed no longer stands for a gap: the function is then recorded as covered, with its code."""
    root, bad = Path(root), []
    rows = pol.get("software_roles") or []
    ids = [f.get("id") for f in rows]
    for m in FUNCTIONS:
        if m not in ids:
            bad.append(f"software_roles: the function {m} is not in the coverage map: nothing says who does it")
    if len(ids) != len(set(ids)):
        bad.append("software_roles: duplicate function id")
    owned = owned_paths(root, pol)
    try:
        planned = set(_j(root, "doctrine/team.json").get("roles", {}))
    except (OSError, ValueError):
        planned = set()
    for f in rows:
        fid, roles, code, st = f.get("id"), f.get("roles") or [], f.get("code") or [], f.get("status")
        for r in roles:
            if r not in known:
                bad.append(f"software_roles {fid}: {r} is not a role")
        if st == "covered":
            if not roles or not code:
                bad.append(f"software_roles {fid}: covered needs at least one role and one code path that does the work")
            for p in code:
                if not (root / p).exists():
                    bad.append(f"software_roles {fid}: code {p} does not exist")
                elif not any(p in owned.get(r, ()) for r in roles):
                    bad.append(f"software_roles {fid}: {p} is owned by none of {', '.join(roles)} (not in a role's runs or in the system_path of a loop it owns)")
            for r in roles:
                if r in known and not any(p in owned.get(r, ()) for p in code):
                    bad.append(f"software_roles {fid}: {r} is named and owns none of the listed code")
        elif st == "gap":
            if not f.get("item") or not str(f.get("missing", "")).strip():
                bad.append(f"software_roles {fid}: a gap needs `missing` (what no code does) and a filed Q-ROLE-* item")
        else:
            bad.append(f"software_roles {fid}: status must be covered or gap")
        if f.get("missing") and not f.get("item"):
            bad.append(f"software_roles {fid}: `missing` with no item: a known hole nobody is asked to close")
        if f.get("item"):
            iid = str(f["item"])
            state = item_state(root, iid)
            if not iid.startswith("Q-ROLE-"):
                bad.append(f"software_roles {fid}: item {iid} is not a Q-ROLE-* item")
            elif state == "missing":
                bad.append(f"software_roles {fid}: item {iid} is not filed in docs/issues")
            elif state == "fixed":
                bad.append(f"software_roles {fid}: item {iid} ended fixed: record the function as covered with the code that does it and drop `missing` and `item`")
        if f.get("dedicated") and f["dedicated"] not in planned | known:
            bad.append(f"software_roles {fid}: dedicated role {f['dedicated']} is in neither doctrine/team.json nor agents/roles")
    return bad


def alignment(root=REPO) -> dict:
    """The role alignment and the coverage map, as one reading (`managers --roles`)."""
    root = Path(root)
    pol = _j(root, POLICY)
    roles = [{"role": rid, **{k: r.get(k) for k in ALIGN}} for rid, r in pol.get("roles", {}).items()]
    fns = [{**f, **({"item_state": item_state(root, f["item"])} if f.get("item") else {})} for f in pol.get("software_roles") or []]
    return {"roles": roles, "functions": fns, "covered": sum(f.get("status") == "covered" for f in fns), "gaps": [f["id"] for f in fns if f.get("status") == "gap"],
            "partial": [f["id"] for f in fns if f.get("status") == "covered" and f.get("missing")]}


def seed_roster(reg: dict) -> list[dict]:
    """The same reading as roster() in seed/worker/src/managers.js: on by default, off only by a reasoned switch, never for a core manager."""
    out = []
    for m in reg.get("managers", []):
        s = (reg.get("switch") or {}).get(m["id"])
        s = {"state": s, "reason": ""} if isinstance(s, str) else s
        wants_off = (s.get("state") == "off") if s else m.get("default") == "off"
        refused = ("core manager cannot be switched off" if m.get("core") else "" if not s or str(s.get("reason", "")).strip() else "off switch has no reason") if wants_off else ""
        out.append({**m, "on": (not wants_off) or bool(refused), "refused": refused})
    return out


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    pol, reg = _j(root, POLICY), None
    try:
        reg = _j(root, pol["seed_register"])
    except (OSError, ValueError, KeyError) as e:
        return [f"the seed register is unreadable: {e}"]
    rows, owned = pol.get("roles", {}), loops_of(root)
    platform, seed = role_files(root, "platform"), role_files(root, "seed")
    clocks = {c["id"] for c in _j(root, "doctrine/clocks.json").get("clocks", [])}
    seeded = {m["id"] for m in reg.get("managers", [])}
    for rid in platform:
        r = rows.get(rid)
        if not r:
            bad.append(f"{rid}: role file with no row in {POLICY}: a title, not a manager (give it runs, clock, probe and settles, or remove the role file)")
            continue
        real = [l for l in owned.get(rid, []) if l["id"] != f"role-{rid}" and l.get("closing_probe") != f"file:agents/roles/{rid}.md"]
        if not real:
            bad.append(f"{rid}: owns no loop in the loop registry besides role-{rid}: nothing it runs is declared, clocked or probed")
        if not r.get("runs"):
            bad.append(f"{rid}: no code (runs is empty)")
        for p in r.get("runs", []):
            if not (root / p).is_file():
                bad.append(f"{rid}: runs {p}, which does not exist")
        if not r.get("clock"):
            bad.append(f"{rid}: no clock")
        for c in r.get("clock", []):
            why = _clock_ok(root, c, clocks, seeded, rid)
            if why:
                bad.append(f"{rid}: {why}")
        probe = r.get("probe", "")
        if not probe or probe == f"file:agents/roles/{rid}.md":
            bad.append(f"{rid}: its closing probe is missing or is its own role file: a file that exists proves nothing ran")
        else:
            ok, why = _spec_ok(root, probe)
            if not ok:
                bad.append(f"{rid}: probe {probe}: {why}")
        ok, why = _spec_ok(root, r.get("settles", "")) if r.get("settles") else (False, "no code settles what it files: a manager that only files items never closes a loop")
        if not ok:
            bad.append(f"{rid}: settles: {why}")
        bad += align_problems(root, rid, r, set(platform))
    for rid in sorted(set(rows) - set(platform)):
        bad.append(f"{rid}: row in {POLICY} with no role file in {TREES['platform']}")
    known = set(platform)
    bad += coverage_problems(root, pol, known)
    for owner, ls in sorted(owned.items()):
        if owner not in known:
            bad.append(f"loop(s) {', '.join(l['id'] for l in ls)}: owner {owner or '(none)'} is not a manager role: an ownerless loop is closed by nobody")
    # the seed carries every platform manager, as role file and as register row, or a recorded reason says why not (and the reverse)
    sa, pa = pol.get("seed_absent") or {}, pol.get("platform_absent") or {}
    for rid in platform:
        if (rid not in seed or rid not in seeded) and not str(sa.get(rid, "")).strip():
            bad.append(f"{rid}: a platform manager the seed lacks ({'no role file' if rid not in seed else 'no register row'}) with no reason in seed_absent: a new system would not get it")
    for rid in sorted(set(seed) | seeded):
        if rid not in platform and not str(pa.get(rid, "")).strip():
            bad.append(f"{rid}: a seed manager the platform lacks with no reason in platform_absent")
    for rid in sorted(seeded - set(seed)):
        bad.append(f"{rid}: in the seed register with no role file in {TREES['seed']}")
    # the register is one truth with the seed roster the bootstrap hires from, and its defaults are safe
    try:
        cfg = {x["id"]: x for x in _j(root, "seed/ultrastable.json").get("roles", [])}
    except (OSError, ValueError) as e:
        cfg = {}; bad.append(f"seed/ultrastable.json is unreadable: {e}")
    for m in reg.get("managers", []):
        c = cfg.get(m["id"])
        if not c:
            bad.append(f"{m['id']}: in the seed register and not in seed/ultrastable.json roles: the bootstrap would not hire it")
        elif (c.get("tick_every"), c.get("count")) != (m.get("tick_every"), m.get("count")):
            bad.append(f"{m['id']}: tick_every/count differ between the seed register and seed/ultrastable.json")
        if m.get("default") not in ("on", "off") or not str(m.get("for", "")).strip():
            bad.append(f"{m['id']}: seed register row needs default on|off and `for` (what it serves, when to switch it off)")
        if m.get("core") and m.get("default") != "on":
            bad.append(f"{m['id']}: a core manager must default on")
        for k in SEED_ALIGN:  # one truth: a seeded system is told the same alignment the platform checks
            if m["id"] in rows and m.get(k) != rows[m["id"]].get(k):
                bad.append(f"{m['id']}: {k} differs between the seed register and {POLICY}")
    for rid in sorted(set(cfg) - seeded):
        bad.append(f"{rid}: in seed/ultrastable.json roles and not in the seed register")
    for m in seed_roster(reg):
        if m["refused"]:
            bad.append(f"{m['id']}: switch refused: {m['refused']}")
    for k in sorted(set(reg.get("switch") or {}) - seeded):
        bad.append(f"switch names {k}, which is not a manager in the register")
    beat = reg.get("beat") or {}
    if not (beat.get("tick_s", 0) > 0 and 1 <= beat.get("late_factor", 0) < beat.get("stopped_factor", 0)):
        bad.append("seed register beat needs tick_s > 0 and 1 <= late_factor < stopped_factor")
    for f in sync_roles(root, write=False):
        bad.append(f"{f}: its `What you own` block is missing or stale: the agent taking the role is not told its loops and code (run managers --sync)")
    src = root / "seed/worker/src/tick.js"
    if not src.is_file() or "hireStep(db, ctx)" not in src.read_text(encoding="utf-8"):
        bad.append("seed/worker/src/tick.js does not call hireStep: a switched-on manager with no runtime row would never tick")
    return bad


BEGIN, END = "<!-- managers:begin (generated by python3 -m foundation managers --sync; do not edit) -->", "<!-- managers:end -->"


def role_block(root, rid: str, tree: str) -> str:
    """What the role file tells the agent that takes the role: the loops and code it owns. The seed copy names only what a seeded system holds."""
    root = Path(root)

    def stands(r: dict, seed: bool) -> str:
        if not r.get("human_role"):
            return ""
        lines = [f"- **Stands in for:** {r['human_role']}", f"- **Decides on its own:** {'; '.join(r.get('decides') or [])}"]
        if not seed:
            lines.append(f"- **Reads:** {', '.join(f'`{x}`' for x in r.get('inputs') or [])}")
        lines.append(f"- **Hands work to:** {', '.join(f'`{x}`' for x in r.get('hands_to') or [])}")
        if not seed and r.get("cadence"):
            lines.append(f"- **Cadence:** {r['cadence']}")
        return "\n".join(lines) + "\n"
    if tree == "seed":
        row = next((m for m in _j(root, _j(root, POLICY)["seed_register"]).get("managers", []) if m["id"] == rid), {})
        body = ("## What you own (MANAGERS-1)\nYou are a manager in this system's register, `autonomy/managers.json`: the tick hires you while you are switched on there and dispatches "
                "you the ready items whose owner is your role. You own those items and the code they change until each closing probe passes. A manager that only files items closes "
                "no loop: every item you file carries a closing probe, and you settle it (fixed, superseded with evidence, or a gate with its default in effect).\n" + stands(row, True).rstrip("\n"))
    else:
        r = _j(root, POLICY)["roles"][rid]
        loops = [l["id"] for l in loops_of(root).get(rid, []) if l["id"] != f"role-{rid}"]
        body = ("## What you own (MANAGERS-1)\nYou are a running loop, not a title. You own this code and close what it opens.\n" + stands(r, False) +
                f"- **Loops** (`instances/ultrastable/loop-registry.json`): {', '.join(f'`{x}`' for x in loops)}\n"
                f"- **Code:** {', '.join(f'`{x}`' for x in r['runs'])}\n"
                f"- **Clock:** {', '.join(f'`{x}`' for x in r['clock'])} (`runtime` is your dispatch beat on the tick; `python3 -m foundation managers --live` reads it)\n"
                f"- **Closing probe:** `{r['probe'].partition(':')[2] if r['probe'].startswith('cmd:') else r['probe']}`\n"
                f"- **Settles what you file:** `{r['settles'].partition(':')[2]}`\n"
                "Every item you file carries a closing probe and ends fixed, superseded with evidence, or as a gate with its default in effect; `python3 -m foundation managers --closure` "
                "reads how yours ended.")
    return f"{BEGIN}\n{body}\n{END}"


def _with_block(text: str, block: str) -> str:
    if BEGIN in text and END in text:
        return text[:text.index(BEGIN)] + block + text[text.index(END) + len(END):]
    return text.rstrip("\n") + "\n\n" + block + "\n"


def sync_roles(root=REPO, write=True) -> list[str]:
    """Role files whose generated block is missing or stale; with write, rewritten."""
    root, stale = Path(root), []
    rows = _j(root, POLICY).get("roles", {})
    for tree, rel in TREES.items():
        for rid in role_files(root, tree):
            if tree == "platform" and rid not in rows:
                continue
            f = root / rel / f"{rid}.md"
            old = f.read_text(encoding="utf-8")
            new = _with_block(old, role_block(root, rid, tree))
            if new != old:
                stale.append(f"{rel}/{rid}.md")
                if write:
                    f.write_text(new, encoding="utf-8")
    return stale


def items_by_owner(root=REPO) -> dict[str, dict]:
    """What each owner filed and how it ended, from docs/issues: fixed (a probe passed), shelved (the limit closed it with no fix), gate, open."""
    out: dict[str, dict] = {}
    for f in sorted((Path(root) / "docs/issues").glob("*.json")):
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(doc, dict):  # an index file, not an item
            continue
        body = doc.get("body") or ""
        o = re.search(r"\*\*Owner:\*\*\s*([^\n]+)", body)
        owner = re.sub(r"[*`]", "", o.group(1)).strip().lower() if o else "?"
        st, d = re.search(r"\*\*Status:\*\*\s*(\w+)", body), re.search(r"\*\*Disposition:\*\*\s*([a-z]+)", body)
        kind = "open" if st and st.group(1) == "open" else (d.group(1) if d else "closed")
        c = out.setdefault(owner, {})
        c[kind] = c.get(kind, 0) + 1
    return out


def matrix(root=REPO, live_rows=None) -> list[dict]:
    root = Path(root)
    pol, reg, owned, items = _j(root, POLICY), _j(root, _j(root, POLICY)["seed_register"]), loops_of(root), items_by_owner(root)
    roster = {m["id"]: m for m in seed_roster(reg)}
    seed = set(role_files(root, "seed"))
    live_by = {r["id"]: r for r in (live_rows or [])}
    out = []
    for rid in role_files(root, "platform"):
        r, it = pol.get("roles", {}).get(rid, {}), items.get(rid, {})
        row = {"role": rid, "loops": [l["id"] for l in owned.get(rid, []) if l["id"] != f"role-{rid}"], "runs": r.get("runs", []), "clock": r.get("clock", []),
               "probe": r.get("probe"), "settles": r.get("settles"), "in_seed": rid in seed and rid in roster, "seed_on": bool(roster.get(rid, {}).get("on")),
               "core": bool(roster.get(rid, {}).get("core")), "items": it,
               "closes_items": (it.get("fixed", 0) + it.get("closed", 0)) > 0 if it else None}
        if rid in live_by:
            row["live"] = {k: live_by[rid].get(k) for k in ("state", "instances", "last_tick_at", "age_s", "dispatches", "settled", "last_24h")}
        out.append(row)
    return out


def unclocked(root=REPO) -> list[dict]:
    """Scheduled workflows a manager runs on that are not clocks in doctrine/clocks.json: their silence is seen by nobody (CLOCKWORK-1)."""
    root = Path(root)
    have = {c.get("workflow") for c in _j(root, "doctrine/clocks.json").get("clocks", []) if c.get("workflow")}
    out = []
    for rid, r in sorted(_j(root, POLICY).get("roles", {}).items()):
        for c in r.get("clock", []):
            if c.startswith("workflow:") and c[9:].removesuffix(".yml") not in have:
                out.append({"role": rid, "workflow": c[9:]})
    return out


def closure(root=REPO) -> list[dict]:
    """Per manager: how its ended items ended. over is true when most ended shelved: it files more than it closes."""
    root = Path(root)
    pol = _j(root, POLICY)
    c, items = pol.get("closure") or {"min_ended": 5, "max_shelved_share": 0.5}, items_by_owner(root)
    out = []
    for rid in sorted(pol.get("roles", {})):
        it = items.get(rid, {})
        ended = sum(v for k, v in it.items() if k not in ("open", "gate"))
        share = round(it.get("shelved", 0) / ended, 3) if ended else None
        out.append({"role": rid, "ended": ended, "open": it.get("open", 0), "fixed_or_closed": it.get("fixed", 0) + it.get("closed", 0), "shelved": it.get("shelved", 0),
                    "shelved_share": share, "over": bool(ended >= c["min_ended"] and share is not None and share > c["max_shelved_share"])})
    return out


def fetch_agents(url, ua, timeout):
    req = urllib.request.Request(url, headers={"user-agent": ua, "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def live(root=REPO, payload=None, fetch=fetch_agents) -> list[dict]:
    """One row per switched-on manager from the runtime's own record of its roles: missing (no runtime row: nothing dispatches its items), stopped,
    late, or ticking. A manager that is off is reported off and is never a failure. An unreadable runtime is unmeasured, never ticking."""
    root = Path(root)
    pol = _j(root, POLICY)
    reg, lv = _j(root, pol["seed_register"]), pol["live"]
    beat = reg["beat"]
    if payload is None:
        try:
            payload = fetch(lv["agents_url"], lv["user_agent"], lv["timeout_s"])
        except (OSError, ValueError, urllib.error.URLError) as e:
            return [{"id": m["id"], "state": "unmeasured", "why": f"runtime unreadable: {type(e).__name__}: {e}"[:200]} for m in seed_roster(reg) if m["on"]]
    by: dict[str, list[dict]] = {}
    for a in payload.get("agents", []):
        by.setdefault(a.get("role"), []).append(a)
    out = []
    for m in seed_roster(reg):
        if not m["on"]:
            out.append({"id": m["id"], "state": "off", "why": "switched off in the register"}); continue
        inst = by.get(m["id"], [])
        if not inst:
            out.append({"id": m["id"], "state": "missing", "instances": 0, "why": "no runtime row: its items are never dispatched"}); continue
        ages = [a.get("last_tick_age_s") for a in inst if a.get("last_tick_age_s") is not None]
        age, every = (min(ages) if ages else None), m["tick_every"] * beat["tick_s"]
        state = "stopped" if age is None or age > every * beat["stopped_factor"] else "late" if age > every * beat["late_factor"] else "ticking"
        d = [a.get("dispatches") or {} for a in inst]
        out.append({"id": m["id"], "state": state, "instances": len(inst), "age_s": age, "expected_s": every,
                    "last_tick_at": max((a.get("last_tick_at") or "") for a in inst) or None,
                    "dispatches": sum(x.get("total", 0) for x in d), "settled": sum(x.get("settled", 0) for x in d), "last_24h": sum(x.get("last_24h", 0) for x in d),
                    "why": "" if state == "ticking" else (f"last dispatch beat {round(age / 3600, 1)} h ago, due every {round(every / 60)} min" if age is not None else "never ticked")})
    return out


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--live" in argv:
        rows = live()
        for r in rows:
            print(f"{r['state']:<10} {r['id']}" + (f": {r['why']}" if r.get("why") else ""))
        n = {s: sum(r["state"] == s for r in rows) for s in ("ticking", "late", "stopped", "missing", "unmeasured", "off")}
        print(json.dumps({"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **n}))
        return 0 if not (n["missing"] or n["stopped"] or n["unmeasured"]) else 1
    if "--sync" in argv:
        for f in sync_roles():
            print("wrote " + f)
        return 0
    if "--roles" in argv:
        a = alignment()
        if "--json" in argv:
            print(json.dumps(a, indent=1)); return 0
        for r in a["roles"]:
            print(f"{r['role']}: {r['human_role']}\n    decides: {'; '.join(r['decides'] or [])}\n    hands to: {', '.join(r['hands_to'] or [])}; {r['cadence']}")
        for f in a["functions"]:
            print(f"{f['status']:<8} {f['function']}: " + (", ".join(f["roles"]) + " (" + ", ".join(f["code"]) + ")" if f["status"] == "covered" else f.get("missing", "")) + (f" [{f['item']}: {f['item_state']}]" if f.get("item") else ""))
        print(json.dumps({"roles": len(a["roles"]), "functions": len(a["functions"]), "covered": a["covered"], "gaps": a["gaps"], "partial": a["partial"]}))
        return 0
    if "--clocks" in argv:
        rows = unclocked()
        for r in rows:
            print(f"unclocked  {r['role']}: {r['workflow']} is scheduled and is not a clock in doctrine/clocks.json")
        print(json.dumps({"unclocked": len(rows)}))
        return 1 if rows else 0
    if "--closure" in argv:
        rows = closure()
        for r in rows:
            print(("OVER " if r["over"] else "ok   ") + f"{r['role']}: {r['ended']} ended, {r['fixed_or_closed']} fixed or closed by probe, {r['shelved']} shelved" + (f" ({round(r['shelved_share'] * 100)}%)" if r["shelved_share"] is not None else "") + f", {r['open']} open")
        return 1 if any(r["over"] for r in rows) else 0
    if "--report" in argv:
        print(json.dumps(matrix(live_rows=live() if "--with-live" in argv else None), indent=1))
        return 0
    bad = check()
    for b in bad:
        print("FAIL " + b)
    print("managers ok: every role is a loop with code, a clock, a probe and a settler, and names its human counterpart, decisions, inputs and hand-offs; every loop has a manager; every software function is covered or has a Q-ROLE item; the seed carries every manager" if not bad else f"managers: {len(bad)} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
