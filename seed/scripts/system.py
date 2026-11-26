# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""What an Ultrastable system is, how it runs, bootstraps and reaches criticality, as one checked definition (SYSTEM-SPEC-1, Rowan 2026-11-25).

"Something's missing in the core ultra-stable template that's not saying, hey, this is what an ultra-stable system is. This is how ultra-stable
runs. This is how ultra-stable bootstraps. This is how ultra-stable becomes autonomous and achieves criticality."

The definition is data (autonomy/system.json) plus the code of record, read live: the bootstrap stages from bootstrap/bootstrap.py, the tick steps
from worker/src/tick.js, the ignition ladder from worker/src/ignition.js, the criticality numbers from autonomy/criticality.json and the standing
rules from agents/AGENTS.md. Nothing in SYSTEM.md is typed by hand, so it cannot drift from what the code does.

  python3 scripts/system.py --write    render SYSTEM.md
  python3 scripts/system.py --check    SYSTEM.md is current; every clause's probe passes in this kit; every standing rule either cites
                                       enforcement that exists in this kit or is on the shrink-only not_in_kit list
  python3 scripts/system.py --gaps     list the standing rules whose enforcement is not in this kit
  python3 scripts/system.py --rule ID  the spec holds and rule ID is enforced inside this kit (closing probe of Q-KIT-<ID>)

Stdlib only. Runs from the kit root (a seeded system's repository, or seed/ in the platform).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
SPEC = "autonomy/system.json"
OUT = "SYSTEM.md"


def _read(root: Path, rel: str) -> str:
    p = root / rel
    return p.read_text(encoding="utf-8") if p.exists() else ""


def probe(root: Path, spec: str) -> tuple[bool, str]:
    """file:<path> or grep:<path>::<regex>, resolved inside the kit."""
    if spec.startswith("file:"):
        rel = spec[5:]
        return (root / rel).exists(), rel
    if spec.startswith("grep:") and "::" in spec:
        rel, rx = spec[5:].split("::", 1)
        text = _read(root, rel)
        if not text:
            return False, f"{rel} missing"
        return bool(re.search(rx, text)), f"{rel} /{rx}/"
    return False, f"unknown probe {spec}"


# ---- the code of record ----------------------------------------------------------------------------------------------------------------

def boot_stages(root: Path) -> list[tuple[str, str]]:
    src = _read(root, "bootstrap/bootstrap.py")
    m = re.search(r'for name in \(([^)]*)\):', src)
    names = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    out = []
    for n in names:
        d = re.search(rf'def {n}\(self[^)]*\):\s*\n\s*"""(.*?)(?:"""|\n\n)', src, re.S)
        out.append((n, " ".join(d.group(1).split())[:240] if d else ""))
    return out


def tick_steps(root: Path) -> list[tuple[str, str]]:
    """STEP_ORDER is the order a tick runs; each step's description is the comment above it in STEPS."""
    src = _read(root, "worker/src/tick.js")
    m = re.search(r"export const STEP_ORDER = \[([^\]]*)\]", src)
    order = re.findall(r"'([a-z_]+)'", m.group(1)) if m else []
    desc = dict(_step_comments(src))
    return [(n, desc.get(n, "")) for n in order]


def loops(root: Path) -> list[tuple[str, str]]:
    """The loops the cron runs beside the tick (worker/src/index.js `await b('<name>', ...)`), each with its rule comment."""
    out = []
    for m in re.finditer(r"await b\('([a-z0-9-]+)',[^\n]*?//\s*(.*)$", _read(root, "worker/src/index.js"), re.M):
        line = m.group(0)
        tail = line[line.find("await b("):]
        out.append((m.group(1), " ".join(tail[tail.find("// ") + 3:].split("// ")[0].split())[:200] if "// " in tail else ""))
    return out


def _step_comments(src: str) -> list[tuple[str, str]]:
    i = src.find("export const STEPS = {")
    if i < 0:
        return []
    body, depth, j = src[i:], 0, 0
    for j, ch in enumerate(body):
        depth += ch == "{"
        depth -= ch == "}"
        if depth == 0 and j > 20:
            break
    body = body[:j]
    out, comment = [], []
    for line in body.splitlines():
        s = line.strip()
        if line.startswith("  //"):
            comment.append(s.lstrip("/ ").strip())
            continue
        m = re.match(r"^  (?:async )?([a-z_]+)\s*(?:\(|:)", line)
        if m:
            out.append((m.group(1), " ".join(comment)[:240]))
        if line.startswith("  ") and not line.startswith("   ") and not line.startswith("  //"):
            comment = []
    return out


def ignition(root: Path) -> list[tuple[str, str]]:
    src = _read(root, "worker/src/ignition.js")
    m = re.search(r"export const STAGES = \[([^\]]*)\]", src)
    stages = re.findall(r"'([a-z-]+)'", m.group(1)) if m else []
    desc = dict(re.findall(r"^//\s{3}([a-z-]+)\s{2,}(.+)$", src, re.M))
    return [(s, desc.get(s, "the starting point: nothing recorded yet" if s == "unseeded" else "")) for s in stages]


def criticality(root: Path) -> dict:
    try:
        c = json.loads(_read(root, "autonomy/criticality.json"))
    except ValueError:
        return {}
    return {"window_days": c.get("window_days"), "k_min": c.get("k_min"), "self_origins": (c.get("self") or {}).get("origins")}


RULE = re.compile(r"^- \*\*(?P<title>.+?)\*\*", re.M)
RID = re.compile(r"\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d)\b")
CODE = re.compile(r"`([^`]+)`")


KIT_MAP: dict = {}


def rules(root: Path) -> list[dict]:
    """Every bullet in agents/AGENTS.md that names a rule id, with the enforcement it cites, resolved inside this kit."""
    text = _read(root, "agents/AGENTS.md")
    try:
        KIT_MAP.clear()
        KIT_MAP.update(json.loads(_read(root, SPEC)).get("kit_enforcement", {}))
    except ValueError:
        pass
    out = []
    for m in RULE.finditer(text):
        end = text.find("\n- **", m.end())
        bullet = text[m.start(): end if end > 0 else len(text)]
        ids = RID.findall(m.group("title"))
        if not ids:
            continue
        here, elsewhere = [], []
        for c in CODE.findall(bullet):
            c = c.strip()
            cmd = re.match(r"python3 (?:-m foundation(?:\.| )|scripts/|bootstrap/)([a-z_]+)", c)
            if cmd:
                name = cmd.group(1)
                hit = next((p for p in (f"scripts/{name}.py", f"bootstrap/{name}.py") if (root / p).exists()), None)
                (here if hit else elsewhere).append(hit or c)
                continue
            if "/" in c and re.match(r"^[\w./*-]+$", c) and not c.startswith(("http", "/")):
                rel = c[5:] if c.startswith("seed/") else c
                # CLEANROOM-1 finding: org/ and ops/ are written by a boot and by the running loops, so they are never kit enforcement; counting
                # them made SYSTEM.md stale in every freshly booted system (org/owner-status.json appeared and the citation list changed).
                runtime = rel.startswith(("org/", "ops/"))
                ((here if not runtime and ((root / rel).exists() or (root / rel.rstrip("/")).exists()) else elsewhere)).append(rel)
            elif c.startswith("node --test "):
                rel = c.split()[-1]
                rel = rel[5:] if rel.startswith("seed/") else rel
                (here if (root / rel).exists() else elsewhere).append(rel)
        mapped = KIT_MAP.get(ids[0], [])
        here += [x.split(":", 1)[1].split("::")[0] for x in mapped if probe(root, x)[0]]
        title = re.sub(r"\s*\([^)]*\)\.?$", "", m.group("title")).strip().rstrip(".")
        out.append({"id": ids[0], "ids": ids, "title": title, "in_kit": sorted(set(here)), "elsewhere": sorted(set(elsewhere))})
    return out


# ---- render and check ----------------------------------------------------------------------------------------------------------------

def render(root: Path = KIT) -> str:
    spec = json.loads(_read(root, SPEC))
    L = ["# What an Ultrastable system is", "",
         "<!-- Generated by scripts/system.py --write from autonomy/system.json and the code of record. Do not edit by hand. -->", "",
         "> Ultrastable is the foundation for any autonomous system.", "",
         "This is the definition every agent and every system built from this kit starts from. It is generated by `python3 scripts/system.py --write`",
         "from `autonomy/system.json` and the code of record, and `python3 scripts/system.py --check` fails when it drifts from the code, when a clause's",
         "probe fails in this kit, or when a standing rule has no enforcement here that is not on the declared list. Do not edit it by hand."]
    if (root / "doctrine/SYSTEM.md").exists():  # COLDSTART-1's prose definition and cold-start contract; this file is its code-of-record index
        L += ["The prose definition is `doctrine/SYSTEM.md` (COLDSTART-1; its contract is the platform's `doctrine/coldstart.json`); this file is",
              "the index of the code that makes them true, clause by clause, step by step and rule by rule."]
    L.append("")
    for sec in spec["sections"]:
        L += [f"## {sec['title']}", ""]
        for c in sec.get("clauses", []):
            L.append(f"- **{c['id']}.** {c['text']} (probe: {', '.join('`' + p + '`' for p in c['probe'])})")
        if sec.get("clauses"):
            L.append("")
        g = sec.get("generated")
        if g == "tick_steps":
            L += ["Tick steps, in order (from `worker/src/tick.js`):", ""]
            L += [f"{i}. `{n}`" + (f": {d}" if d else "") for i, (n, d) in enumerate(tick_steps(root), 1)]
            L += ["", "Loops the same cron runs beside the tick (from `worker/src/index.js`):", ""]
            L += [f"- `{n}`" + (f": {d}" if d else "") for n, d in loops(root)]
            L.append("")
        elif g == "boot_stages":
            L += ["Boot stages, in order (from `bootstrap/bootstrap.py`):", ""]
            L += [f"{i}. `{n}`" + (f": {d}" if d else "") for i, (n, d) in enumerate(boot_stages(root), 1)]
            L.append("")
        elif g == "ignition":
            c = criticality(root)
            L += ["The ladder from bootstrap to criticality (from `worker/src/ignition.js`; every stage is computed, never declared):", ""]
            L += [f"{i}. `{s}`" + (f": {d}" if d else "") for i, (s, d) in enumerate(ignition(root))]
            L += ["", f"Criticality numbers (from `autonomy/criticality.json`): window {c.get('window_days')} days, k_min {c.get('k_min')}, "
                  f"self-shipped origins {', '.join(c.get('self_origins') or [])}.", ""]
        elif g == "rules":
            rs = rules(root)
            gaps = set(spec.get("not_in_kit", []))
            L += [f"{len(rs)} standing rules from `agents/AGENTS.md`, each with the enforcement it cites. \"In this kit\" names code this repository runs;",
                  "a rule enforced only by the platform is marked so, and the platform checks it for every system it hosts.", ""]
            for r in rs:
                where = ", ".join(f"`{p}`" for p in r["in_kit"][:4]) if r["in_kit"] else ("checked by the platform" if r["id"] in gaps else "no enforcement found")
                L.append(f"- **{r['id']}**: {r['title']}. In this kit: {where}.")
            L.append("")
    return "\n".join(L).rstrip() + "\n"


def check(root: Path = KIT) -> list[str]:
    errs = []
    spec = json.loads(_read(root, SPEC))
    for sec in spec["sections"]:
        for c in sec.get("clauses", []):
            for p in c["probe"]:
                ok, what = probe(root, p)
                if not ok:
                    errs.append(f"{c['id']}: probe failed in this kit: {what}")
    for rid, probes in spec.get("kit_enforcement", {}).items():
        for p in probes:
            ok, what = probe(root, p)
            if not ok:
                errs.append(f"kit_enforcement {rid}: probe failed in this kit: {what}")
    if not boot_stages(root):
        errs.append("bootstrap stages could not be read from bootstrap/bootstrap.py")
    if not tick_steps(root):
        errs.append("tick steps could not be read from worker/src/tick.js")
    if len(ignition(root)) < 3:
        errs.append("ignition stages could not be read from worker/src/ignition.js")
    gaps = set(spec.get("not_in_kit", []))
    rs = rules(root)
    for r in rs:
        if not r["in_kit"] and r["id"] not in gaps:
            errs.append(f"{r['id']}: no enforcement in this kit and not on not_in_kit ({SPEC}); ship its check into the kit")
    stale = sorted(gaps - {r["id"] for r in rs if not r["in_kit"]})
    if stale:
        errs.append(f"not_in_kit lists rules that are now enforced here or gone; remove them (shrink-only): {', '.join(stale)}")
    if _read(root, OUT) != render(root):
        errs.append(f"{OUT} is stale: run python3 scripts/system.py --write")
    for f in ("CLAUDE.md", "AGENTS.md"):
        if (root / f).exists() and "SYSTEM.md" not in _read(root, f):
            errs.append(f"{f} does not load SYSTEM.md, so an agent here starts without the definition")
    return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    root = Path(a[a.index("--root") + 1]).resolve() if "--root" in a else KIT
    if "--write" in a:
        (root / OUT).write_text(render(root), encoding="utf-8")
        print(f"wrote {OUT}")
        return 0
    if "--gaps" in a:
        for r in rules(root):
            if not r["in_kit"]:
                print(r["id"], "|", r["title"][:90], "|", ", ".join(r["elsewhere"][:3]))
        return 0
    e = check(root)
    if "--rule" in a:  # closing probe of a Q-KIT-<id> item: the rule is enforced inside this kit and the spec holds
        rid = a[a.index("--rule") + 1]
        r = next((x for x in rules(root) if x["id"] == rid), None)
        if r is None or not r["in_kit"]:
            e.append(f"{rid}: not enforced in this kit yet" if r else f"{rid}: no such standing rule")
    print("system spec ok" if not e else "\n".join(e))
    return 1 if e else 0


if __name__ == "__main__":
    sys.exit(main())
