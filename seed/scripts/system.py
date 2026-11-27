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
  python3 scripts/system.py --run-tests  run every kit test a clause names (`test:` probes), so each clause is proven by behaviour, not names

Probe kinds: file:<path>, grep:<path>::<regex> (presence) and test:<path>::<test name> (a named test in the kit; --check reads that it exists,
--run-tests runs it). A clause off the shrink-only `presence_only` list (at most PRESENCE_BASELINE) needs at least one test: probe, in a file
a seeded system can run whole (not registered in worker/test/monorepo-only.json). The prose definition doctrine/SYSTEM.md
is read too: every path it names outside a paragraph headed "Platform:" must exist in the kit, and its criticality formula is the one in
autonomy/criticality.json.

Stdlib only. Runs from the kit root (a seeded system's repository, or seed/ in the platform).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
SPEC = "autonomy/system.json"
OUT = "SYSTEM.md"
PROSE = "doctrine/SYSTEM.md"
LIMIT = 320  # a description is cut at a sentence end at or under this many characters, never inside a sentence
# presence_only only shrinks: these are the bare definitions a name proves. A clause added to the list, or moved back onto it after its test:
# probe was dropped, fails --check; tighten this tuple when a definition is bound to a test.
PRESENCE_BASELINE = ("ID-1", "ID-2", "ID-3", "ID-4", "ID-5", "ID-6")
MONOREPO_ONLY = "worker/test/monorepo-only.json"


def _read(root: Path, rel: str) -> str:
    p = root / rel
    return p.read_text(encoding="utf-8") if p.exists() else ""


def probe(root: Path, spec: str) -> tuple[bool, str]:
    """file:<path>, grep:<path>::<regex> or test:<path>::<test name>, resolved inside the kit."""
    if spec.startswith("test:") and "::" in spec:
        rel, name = spec[5:].split("::", 1)
        text = _read(root, rel)
        if not text:
            return False, f"{rel} missing"
        if test_argv(root, rel) is None:
            return False, f"{rel} is not a kit test this checker can run"
        hit = any(name in line for line in text.splitlines() if re.match(r"\s*(?:test|it)\(|\s*def test", line))
        return hit, f"{rel} test {name!r}"
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


def test_argv(root: Path, rel: str) -> list[str] | None:
    """The one way a kit test is run: `node --test <file>` for worker tests, `python3 -m unittest <module>` for tests/*.py. Nothing else."""
    if not re.fullmatch(r"[\w./-]+", rel) or ".." in rel or not (root / rel).is_file():
        return None
    if re.fullmatch(r"worker/test/[\w.-]+\.test\.m?js", rel):
        return ["node", "--test", rel]
    if re.fullmatch(r"tests/test_\w+\.py", rel):
        return [sys.executable, "-m", "unittest", rel[:-3].replace("/", ".")]
    return None


def allowed(root: Path, argv: list[str]) -> bool:
    """argv names a kit test exactly as test_argv would run it (the shared rule for scripts/constitution.py {probe: [argv]} bindings too)."""
    if len(argv) == 3 and argv[:2] == ["node", "--test"]:
        return test_argv(root, argv[2]) == argv
    if len(argv) == 4 and argv[0] in ("python3", sys.executable) and argv[1:3] == ["-m", "unittest"]:
        return test_argv(root, argv[3].replace(".", "/") + ".py") is not None
    return False


def run_test(root: Path, argv: list[str], timeout: int = 300) -> tuple[bool, str]:
    """Run one allowed kit test: argv only, no shell, inside the kit, with a timeout. An argv off the rule is refused, never run."""
    if not allowed(root, argv):
        return False, f"refused: {' '.join(argv)} is not `node --test <kit test>` or `python3 -m unittest <kit test module>`"
    try:
        p = subprocess.run(argv, cwd=root, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"{' '.join(argv)}: {e}"
    return p.returncode == 0, f"{' '.join(argv)} exited {p.returncode}" + ("" if p.returncode == 0 else ": " + (p.stderr or p.stdout)[-300:])


def run_tests(root: Path = KIT) -> list[str]:
    """--run-tests: every test file a clause's test: probe names, run once each. A failing test fails the clause that cites it."""
    spec, files = json.loads(_read(root, SPEC)), {}
    for sec in spec["sections"]:
        for c in sec.get("clauses", []):
            for p in c["probe"]:
                if p.startswith("test:"):
                    files.setdefault(p[5:].split("::", 1)[0], []).append(c["id"])
    errs = []
    for rel, ids in files.items():
        argv = test_argv(root, rel)
        ok, why = run_test(root, argv) if argv else (False, f"{rel}: not a kit test")
        if not ok:
            errs.append(f"{', '.join(sorted(set(ids)))}: {why}")
    return errs


# ---- the code of record ----------------------------------------------------------------------------------------------------------------

def cut(text: str, limit: int = LIMIT) -> str:
    """Whole sentences up to `limit` characters; the first sentence is always kept whole. Never ends inside a word or a sentence."""
    text = " ".join(text.split())
    out = ""
    for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(`])", text):
        if out and len(out) + 1 + len(s) > limit:
            break
        out = f"{out} {s}" if out else s
    return out


def boot_stages(root: Path, guarded: bool = True) -> list[tuple[str, str]]:
    """The stages bootstrap/bootstrap.py runs, in order: the `for name in (...)` tuple, plus (guarded=True) a stage guarded right after one of
    them (`if name == "read": boot.guard("adopt", ...)`). Each with the first sentences of its docstring."""
    src = _read(root, "bootstrap/bootstrap.py")
    m = re.search(r'for name in \(([^)]*)\):', src)
    names = re.findall(r'"([a-z_]+)"', m.group(1)) if m else []
    for after, extra in re.findall(r'if name == "([a-z_]+)":\s*\n\s*boot\.guard\("([a-z_]+)"', src[m.end():] if m and guarded else ""):
        if after in names and extra not in names:
            names.insert(names.index(after) + 1, extra)
    out = []
    for n in names:
        d = re.search(rf'def {n}\(self[^)]*\):\s*\n\s*"""(.*?)(?:"""|\n\n)', src, re.S)
        out.append((n, cut(d.group(1)) if d else ""))
    return out


def step_names(root: Path) -> tuple[list[str], list[str]]:
    """(STEP_ORDER, the step functions STEPS defines) from worker/src/tick.js. A tick runs STEP_ORDER; each name must be a STEPS function."""
    src = _read(root, "worker/src/tick.js")
    m = re.search(r"export const STEP_ORDER = \[([^\]]*)\]", src)
    return (re.findall(r"'([a-z_]+)'", m.group(1)) if m else []), [n for n, _ in _step_comments(src)]


def tick_steps(root: Path) -> list[tuple[str, str]]:
    """STEP_ORDER is the order a tick runs; each step's description is the comment above it in STEPS."""
    order, _ = step_names(root)
    desc = dict(_step_comments(_read(root, "worker/src/tick.js")))
    return [(n, desc.get(n, "")) for n in order]


def loops(root: Path) -> list[tuple[str, str]]:
    """The loops the cron runs beside the tick (worker/src/index.js `await b('<name>', ...)`), each with its rule comment."""
    out = []
    for m in re.finditer(r"await b\('([a-z0-9-]+)',[^\n]*?//\s*(.*)$", _read(root, "worker/src/index.js"), re.M):
        line = m.group(0)
        tail = line[line.find("await b("):]
        out.append((m.group(1), cut(tail[tail.find("// ") + 3:].split("// ")[0]) if "// " in tail else ""))
    return out


HEAD = re.compile(r"^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-\d+\b")


def _step_comments(src: str) -> list[tuple[str, str]]:
    """Each STEPS function with the comment above it. A comment entry headed by the rule id named after another step (`UNKNOWNS-1:` for
    `unknowns`) describes that step wherever it sits, so one misplaced line never gives a step another step's text."""
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
    found, entries = [], []
    for line in body.splitlines():
        s = line.strip()
        if line.startswith("  //"):
            s = s.lstrip("/ ").strip()
            if HEAD.match(s) or not entries:
                entries.append([s])
            else:
                entries[-1].append(s)
            continue
        m = re.match(r"^  (?:async )?([a-z_]+)\s*(?:\(|:)", line)
        if m:
            found.append((m.group(1), [" ".join(e) for e in entries]))
        if line.startswith("  ") and not line.startswith("   ") and not line.startswith("  //"):
            entries = []
    names = {n for n, _ in found}
    own = {n: [] for n, _ in found}
    for n, es in found:
        for e in es:
            h = HEAD.match(e)
            stem = h.group(1).lower().replace("-", "_") if h else ""
            own[stem if stem in names and stem != n else n].append(e)
    return [(n, cut(" ".join(own[n]))) for n, _ in found]


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
    f = re.search(r"k_eff = \([^)]*\) / \([^)]*\)", c.get("doc", ""))
    return {"window_days": c.get("window_days"), "k_min": c.get("k_min"), "self_origins": (c.get("self") or {}).get("origins"),
            "formula": f.group(0) if f else None}


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
                if not rel.strip("/"):  # `seed/` names the whole kit, not code that enforces a rule; (root / "") exists and would pass for anything
                    continue
                # CLEANROOM-1 finding: org/ and ops/ are written by a boot and by the running loops, so they are never kit enforcement; counting
                # them made SYSTEM.md stale in every freshly booted system (org/owner-status.json appeared and the citation list changed).
                runtime = rel.startswith(("org/", "ops/"))
                ((here if not runtime and ((root / rel).exists() or (root / rel.rstrip("/")).exists()) else elsewhere)).append(rel)
            elif c.startswith("node --test "):
                rel = c.split()[-1]
                rel = rel[5:] if rel.startswith("seed/") else rel
                if rel.strip("/"):
                    (here if (root / rel).is_file() else elsewhere).append(rel)
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
            L += ["", f"Criticality numbers (from `autonomy/criticality.json`): `{c.get('formula')}`, window {c.get('window_days')} days, "
                  f"k_min {c.get('k_min')}, self-shipped origins {', '.join(c.get('self_origins') or [])}.", ""]
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
    presence = set(spec.get("presence_only", []))
    clauses = {c["id"]: c for sec in spec["sections"] for c in sec.get("clauses", [])}
    for cid, c in clauses.items():
        tested = any(p.startswith("test:") for p in c["probe"])
        if not tested and cid not in presence:
            errs.append(f"{cid}: only presence probes; bind it to the kit test that proves the behaviour (test:<path>::<test name>)")
        if tested and cid in presence:
            errs.append(f"{cid}: has a test: probe now; remove it from presence_only (shrink-only)")
    errs += [f"presence_only names {x}, which is no clause; remove it" for x in sorted(presence - set(clauses))]
    errs += [f"presence_only names {x}, which is not on PRESENCE_BASELINE in scripts/system.py: bind it to a kit test instead (the list only shrinks)"
             for x in sorted(presence & set(clauses) - set(PRESENCE_BASELINE))]
    errs += standalone(root, spec)
    if not boot_stages(root):
        errs.append("bootstrap stages could not be read from bootstrap/bootstrap.py")
    order, defined = step_names(root)
    if not order:
        errs.append("tick steps could not be read from worker/src/tick.js")
    errs += [f"tick step {n} is in STEP_ORDER but STEPS has no function for it" for n in order if n not in defined]
    errs += [f"tick step {n} is in STEPS but never runs: it is not in STEP_ORDER" for n in defined if n not in order]
    errs += [f"tick step {n} has no description: write its rule comment above it in worker/src/tick.js" for n, d in tick_steps(root) if not d]
    errs += prose(root)
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
        text = _read(root, f)
        # a CLAUDE.md that imports AGENTS.md (@AGENTS.md) loads whatever AGENTS.md names, so the chain counts
        for imp in re.findall(r"^@(\S+)", text, re.M):
            text += _read(root, imp)
        if (root / f).exists() and "SYSTEM.md" not in text:
            errs.append(f"{f} does not load SYSTEM.md, so an agent here starts without the definition")
    return errs


def standalone(root: Path, spec: dict) -> list[str]:
    """A clause's test file runs whole (`node --test <file>`) in a seeded system's own repository too, so it may not be a file that
    worker/test/monorepo-only.json registers, or hold a registered test that reads platform files with no existsSync or ENOENT guard of its
    own (test/run.mjs skips those by name; a whole-file run does not): there it fails and the clause would read as unproven."""
    try:
        only = json.loads(_read(root, MONOREPO_ONLY) or "{}")
    except ValueError:
        return [f"{MONOREPO_ONLY} is not JSON"]
    files, titles = set(only.get("files", [])), list(only.get("tests", []))
    errs, seen = [], set()
    for sec in spec["sections"]:
        for c in sec.get("clauses", []):
            for p in c["probe"]:
                rel = p[5:].split("::", 1)[0] if p.startswith("test:") else ""
                if not rel.startswith("worker/test/") or (c["id"], rel) in seen:
                    continue
                seen.add((c["id"], rel))
                if Path(rel).name in files:
                    errs.append(f"{c['id']}: {rel} is monorepo-only ({MONOREPO_ONLY}); a seeded system cannot run it, so bind a self-contained test")
                    continue
                for block in re.split(r"(?m)^(?=test\()", _read(root, rel)):
                    hit = next((x for x in titles if x in block.split("\n", 1)[0]), None)
                    if hit and "existsSync(" not in block and "'ENOENT'" not in block:
                        errs.append(f"{c['id']}: {rel} holds {hit!r}, a monorepo-only test with no guard of its own; a seeded system cannot run the "
                                    "file whole, so guard that test or bind a self-contained file")
    return errs


PATHLIKE = re.compile(r"^\.?[\w-]+(?:[./][\w.*-]+)*/?$")


def prose(root: Path = KIT) -> list[str]:
    """doctrine/SYSTEM.md is true of this kit: every path it names outside a paragraph headed "Platform:" exists here, and the k_eff formula it
    states is the one autonomy/criticality.json defines. (The platform copy is byte-identical; its own paths are checked by rulerefs there.)"""
    text = _read(root, PROSE)
    if not text:
        return []
    errs = []
    for para in re.split(r"\n\s*\n", text):
        if para.lstrip().startswith("Platform:"):
            continue
        for tok in CODE.findall(para):
            if tok.startswith("/") or " " in tok or not PATHLIKE.match(tok) or not ("/" in tok or tok.startswith(".") or "." in tok):
                continue
            if not (root / tok).exists():
                errs.append(f"{PROSE}: names `{tok}`, which this kit does not carry (write it from the kit root, or move it under a Platform: paragraph)")
    f = criticality(root).get("formula")
    if f and f not in " ".join(text.split()):
        errs.append(f"{PROSE}: does not state the kit's criticality formula from autonomy/criticality.json: {f}")
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
    if "--run-tests" in a:
        e = run_tests(root)
        print("every clause's tests pass" if not e else "\n".join(e))
        return 1 if e else 0
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
