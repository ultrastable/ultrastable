# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RULE-REFS-1 (Rowan, 2026-11-25): "Make sure everything that is said about ultra stable is true in code, and vice versa."
Ultrastable is the foundation for any autonomous system. Every rule names the code that carries it: a path, a command, a test, a workflow,
an endpoint. This check extracts each backticked reference from the rule files and proves it resolves; the reverse direction lists shipped
code no rule, doc or loop names.

  python3 -m foundation rulerefs --check     every reference in the rule files resolves (file, foundation command and its flags, route), or is
                                             in doctrine/rule-refs.json with a reason; an allowlist row that is no longer needed fails too (in checks)
                                             (`corrections` there: a reference whose rule text is wrong, with the right text; shrink-only)
  python3 -m foundation rulerefs --list      one line per reference: kind, status, source, text
  python3 -m foundation rulerefs --reverse   code without words: foundation modules nothing names, workflows no loop owns, site routes nothing names
  python3 -m foundation rulerefs --seed      the seed's own rule file resolved against the seed alone: what a deployment is told exists and does not
                                             carry (closing probe of Q-RULEREFS-seed-rules; exit 1 while any is missing)
  python3 -m foundation rulerefs --exec      run every referenced `--check` command once and report its exit code (never --apply, --run, --live, --fix)
  python3 -m foundation rulerefs --live      GET every referenced endpoint on the live hosts (user-agent ultrastable-audit/1.0); exit 1 on 404 or 5xx

Data: doctrine/rule-refs.json. Tests: tests/foundation/test_rulerefs.py."""
from __future__ import annotations
import fnmatch, json, os, re, subprocess, sys, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/rule-refs.json"
UA = "ultrastable-audit/1.0"
EXT = r"\.(py|js|mjs|cjs|json|jsonl|md|yml|yaml|sh|sql|toml|html|css|txt|atom|cff)"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".wrangler"}
UNSAFE = ("--apply", "--run", "--live", "--fix", "--gen", "--baseline", "--sync", "--told", "--learn", "--outcome", "--record")


def _pol(root) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def _files(root) -> list[str]:
    out = []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        rel = os.path.relpath(d, root)
        out += [(f if rel == "." else rel.replace(os.sep, "/") + "/" + f) for f in files]
    return out


class Tree:
    """The file set of one checkout, with the lookups the resolver needs."""
    def __init__(self, root):
        self.root = Path(root)
        self.files = set(_files(self.root))
        self.dirs = {f.rsplit("/", i)[0] for f in self.files for i in range(1, f.count("/") + 1)}
        self.base = {}
        for f in self.files:
            self.base.setdefault(f.rsplit("/", 1)[-1], []).append(f)

    def has(self, p) -> bool:
        p = p.strip("/")
        if p in self.files or p in self.dirs:
            return True
        if any(c in p for c in "*?["):
            return any(fnmatch.fnmatchcase(f, p) or fnmatch.fnmatchcase(f, p + "/*") for f in self.files) or any(fnmatch.fnmatchcase(d, p) for d in self.dirs)
        return False


def classify(tok: str):
    """-> (kind, payload) for a backticked token, or None when it is not a reference to code (an id, a field name, a formula)."""
    t = tok.strip()
    m = re.match(r"python3 -m foundation[ .]([a-z_]+)\b(.*)$", t)
    if m:
        return "command", (m.group(1), m.group(2))
    m = re.match(r"(?:python3|node --test|node|bash|sh) ((?:[\w.@-]+/)+[\w.@-]+" + EXT + r")\b", t)
    if m:
        return "script", [p for p in t.split() if re.fullmatch(r"(?:[\w.@-]+/)+[\w.@-]+" + EXT, p)]
    m = re.match(r"(GET|POST|PUT|DELETE) (https?://[^/\s]+)?(/\S*)", t)
    if m:
        return "route", (m.group(1), m.group(2) or "", m.group(3))
    m = re.match(r"https?://([^/\s]+)(/\S*)?$", t)
    if m:
        return "route", ("GET", "https://" + m.group(1), m.group(2) or "/")
    if re.fullmatch(r"/[\w.{}<>*:?=&/-]*", t) and len(t) > 1 and not re.search(EXT + "$", t.split("?")[0]) or re.fullmatch(r"/[\w./-]+\.(json|atom|md|txt)", t):
        return "route", ("GET", "", t)
    core = re.sub(r"\s*\(.*\)$", "", t)                       # `tests/x.py (ClassName)`
    core = re.sub(r"<[^>]+>", "*", core).replace("{", "*").replace("}", "*") if re.search(r"<[^>]+>|\{", core) else core
    core = re.sub(r"\*+", "*", core)
    if re.fullmatch(r"\.?[\w.@*-]+(/[\w.@*-]+)+/?", core) and not re.fullmatch(r"[\d./]+", core):
        return "path", core
    if re.fullmatch(r"[\w.@-]+" + EXT, core):
        return "file", core
    return None


def extract(root=REPO) -> list[dict]:
    root, pol, out, seen = Path(root), _pol(root), [], set()
    for g in pol["sources"]:
        for f in sorted(root.glob(g)):
            rel = f.relative_to(root).as_posix()
            for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                for tok in re.findall(r"`([^`\n]+)`", line):
                    c = classify(tok)
                    sc = None if c else _short_command(root, tok)
                    c = ("command", sc) if sc else c
                    if c and (rel, tok) not in seen:
                        seen.add((rel, tok))
                        out.append({"source": rel, "line": n, "ref": tok, "kind": c[0], "payload": c[1]})
    return out


def _module_src(root, name) -> str | None:
    f = Path(root) / "foundation" / f"{name}.py"
    if f.is_file():
        return f.read_text(encoding="utf-8")
    main = (Path(root) / "foundation/__main__.py").read_text(encoding="utf-8")
    return main if re.search(r'\["%s"\]|"%s":|\'%s\'' % (name, name, name), main) else None


def _short_command(root, tok):
    """`claimcode --list`, `temporal --settled`: a foundation module named without the `python3 -m foundation` prefix."""
    m = re.match(r"([a-z_]+) (--[\w-]+.*)$", tok.strip())
    return (m.group(1), " " + m.group(2)) if m and (Path(root) / "foundation" / f"{m.group(1)}.py").is_file() else None


def _route_sources(root, pol) -> str:
    root = Path(root)
    return "\n".join(f.read_text(encoding="utf-8", errors="replace") for g in pol["route_globs"] for f in sorted(root.glob(g)) if f.is_file() and ".test." not in f.name)


def _route_stem(path: str) -> str:
    """The literal part of a route a router must carry: up to the first placeholder, without the query string."""
    p = re.split(r"[?{<*]|:[a-z]", path)[0]
    return p if p == "/" else p.rstrip("/")


def resolve(root=REPO, siblings=None) -> list[dict]:
    """Every reference with a status: ok, external (allowlisted, with its reason), or dangling (with why)."""
    root, pol = Path(root), _pol(root)
    tree, refs = Tree(root), extract(root)
    allow = {(e.get("source", "*"), e["ref"]): e for e in pol.get("external", [])}
    corr = {e["ref"]: e for e in pol.get("corrections", [])}
    sib_root = Path(siblings) if siblings else root.parent
    sib = {}
    routes = None
    used = set()
    for r in refs:
        kind, pay, why = r["kind"], r["payload"], None
        if kind == "command" or (kind == "path" and False):
            name, rest = pay
            src = _module_src(root, name)
            if src is None:
                why = f"no foundation/{name}.py and no dispatch in foundation/__main__.py"
            else:
                main = (root / "foundation/__main__.py").read_text(encoding="utf-8")
                missing = [fl for fl in re.findall(r"(?<![\w-])--[a-z][\w-]*", rest) if fl not in src and fl not in main]
                if missing:
                    why = f"foundation {name} does not handle {' '.join(missing)}"
        elif kind == "script":
            missing = [p for p in pay if not tree.has(p) and not tree.has("seed/" + p)]
            if missing:
                why = "missing " + ", ".join(missing)
        elif kind == "route":
            method, host, path = pay
            if host and not any(h in host for h in pol["hosts"]):
                r["status"], r["why"] = "ok", "other host: not a route of this system"
                continue
            if routes is None:
                routes = _route_sources(root, pol)
            stem = _route_stem(path)
            if stem != "/" and not (re.search(re.escape(stem) + r"(?![\w-]|\.\w)", routes) or tree.has(stem.lstrip("/")) or tree.has("site/public" + stem) or tree.has("public" + stem)):
                why = f"no router source carries the route {stem}"
        else:
            p = pay
            bases = [""] + [b for b in pol["roots"] if b]
            if r["source"].startswith("seed/"):
                bases = ["seed/"] + bases
            found = any(tree.has(b + p) for b in bases)
            if not found and kind == "file":
                found = p in tree.base
            if not found and kind == "path" and re.fullmatch(r"[a-z_]+\.[a-z_]+\*?", p) is None:
                # `ultrastable/practical-solutions`: a repository of the org; `owner/repo` shapes are declared in the policy
                found = p in pol.get("repositories", [])
            if not found:
                why = "no such path in this repository"
        key = (r["source"], r["ref"]) if (r["source"], r["ref"]) in allow else ("*", r["ref"])
        if why and key in allow:
            e = allow[key]; used.add(key)
            r["status"], r["why"] = "external", e["reason"]
            repo = e.get("repo")
            if repo and (sib_root / repo).is_dir() and e.get("path"):
                if repo not in sib:
                    sib[repo] = Tree(sib_root / repo)
                if not sib[repo].has(e["path"]):
                    r["status"], r["why"] = "dangling", f"allowlisted as {repo}:{e['path']}, and that clone does not hold it"
        elif why and r["ref"] in corr:
            # the rule text is wrong and the right text is recorded: known debt that only shrinks, printed on every run
            e = corr[r["ref"]]
            r["status"], r["why"] = "wrong", f"rule text should read `{e['correct']}`: {e['reason']}"
            if e.get("repo") and (sib_root / e["repo"]).is_dir():
                if e["repo"] not in sib:
                    sib[e["repo"]] = Tree(sib_root / e["repo"])
                if not sib[e["repo"]].has(e["path"]):
                    r["status"], r["why"] = "dangling", f"correction names {e['repo']}:{e['path']}, and that clone does not hold it"
        elif why:
            r["status"], r["why"] = "dangling", why
        else:
            r["status"], r["why"] = "ok", ""
            if key in allow:
                r["stale_allow"] = True
    present = {(r["source"], r["ref"]) for r in refs} | {("*", r["ref"]) for r in refs}
    for k, e in allow.items():
        if k not in present:
            refs.append({"source": POLICY, "line": 0, "ref": e["ref"], "kind": "allowlist", "payload": None, "status": "dangling", "why": "allowlist row names a reference no rule file carries any more: remove the row"})
    for r in refs:
        if r.pop("stale_allow", False):
            r["status"], r["why"] = "dangling", "allowlisted as external, yet it resolves here: remove the allowlist row"
    return refs


def check(root=REPO, siblings=None) -> list[str]:
    errs = []
    pol = _pol(root)
    for e in pol.get("external", []):
        if len((e.get("reason") or "").strip()) < 20:
            errs.append(f"{POLICY}: {e.get('ref')}: an allowlist row needs a reason (20 characters or more)")
    for r in resolve(root, siblings):
        if r["status"] == "dangling":
            errs.append(f"{r['source']}:{r['line']}: `{r['ref']}` ({r['kind']}): {r['why']}")
    return errs


# ---- code -> words ----

def reverse(root=REPO) -> dict:
    """Shipped behaviour nothing describes. A finding here is a statement to write or code to retire, never a failure of --check by itself:
    the lists in doctrine/rule-refs.json `undescribed` are shrink-only, so new code must arrive with its words."""
    root, pol = Path(root), _pol(root)
    words = "\n".join(f.read_text(encoding="utf-8", errors="replace") for g in pol["word_globs"] for f in sorted(root.glob(g)) if f.is_file() and f.relative_to(root).as_posix() != POLICY)
    main = (root / "foundation/__main__.py").read_text(encoding="utf-8")
    imports = {}   # file -> its import lines and `-m foundation` invocations
    for g in ("foundation/*.py", "scripts/*.py", ".github/workflows/*.yml", "tests/foundation/*.py"):
        for f in sorted(root.glob(g)):
            imports[f] = "\n".join(l for l in f.read_text(encoding="utf-8", errors="replace").splitlines() if "import" in l or "foundation" in l)
    mods = []
    for f in sorted((root / "foundation").glob("*.py")):
        n = f.stem
        if n.startswith("_"):
            continue
        named = f"foundation/{n}.py" in words or re.search(r"foundation[ .]%s\b" % n, words)
        dispatched = re.search(r'\["%s"\]|import %s\b|\.%s\b' % (n, n, n), main)
        if not named and not dispatched:
            imported = any(re.search(r"\b%s\b" % n, t) for g, t in imports.items() if g != f)
            mods.append({"module": f"foundation/{n}.py", "imported_elsewhere": imported})
    reg = json.loads((root / pol["loop_registry"]).read_text(encoding="utf-8"))
    regtext = json.dumps(reg) + (root / "doctrine/flows.json").read_text(encoding="utf-8") if (root / "doctrine/flows.json").is_file() else json.dumps(reg)
    wfs = [f.name for f in sorted((root / ".github/workflows").glob("*.yml")) if f.name not in regtext and f".github/workflows/{f.name}" not in regtext]
    site = "\n".join(f.read_text(encoding="utf-8", errors="replace") for f in sorted(root.glob(pol["site_router"])) if f.is_file() and ".test." not in f.name and not f.name.endswith("-data.js"))
    pages = "\n".join(f.read_text(encoding="utf-8", errors="replace") for g in pol["route_globs"] + pol["word_globs"] + pol.get("caller_globs", []) for f in sorted(root.glob(g)) if f.is_file() and f.relative_to(root).as_posix() != POLICY)
    routes = sorted(set(re.findall(r"(?:pathname|path|\bp) ?===? ?['\"](/[\w./-]+)['\"]", site)))
    unnamed = []
    for rt in routes:
        # named when the route appears anywhere beyond its own router comparison: a link, a doc, a sitemap row, a rule
        hits = len(re.findall(r"%s(?![\w/-])" % re.escape(rt), pages))
        own = len(re.findall(r"===? ?['\"]%s['\"]" % re.escape(rt), pages))
        if hits - own <= 0:
            unnamed.append(rt)
    return {"modules": mods, "workflows": wfs, "routes": unnamed, "counts": {"modules_total": len(list((root / 'foundation').glob('*.py'))), "workflows_total": len(list((root / '.github/workflows').glob('*.yml'))), "routes_total": len(routes)}}


def reverse_check(root=REPO) -> list[str]:
    pol, rv, errs = _pol(root), reverse(root), []
    base = pol.get("undescribed", {})
    for key, label, name in (("modules", "foundation module nothing names or dispatches", lambda x: x["module"]), ("workflows", "workflow no loop in the registry owns", str), ("routes", "site route no page links and no doc names", str)):
        known = set(base.get(key, []))
        now = {name(x) for x in rv[key]}
        errs += [f"{x}: {label} (RULE-REFS-1: write the words, or add the owner, in the same change)" for x in sorted(now - known)]
        errs += [f"{POLICY}: undescribed.{key} lists {x}, which is now described: remove the row (shrink-only)" for x in sorted(known - now)]
    return errs


def seed_gap(root=REPO, rules="seed/agents/AGENTS.md", base="seed") -> dict:
    """The rule file a seeded system's agents read, resolved against the seed alone: what a deployment is told exists and does not carry."""
    root = Path(root)
    tree, missing, total = Tree(root / base), [], 0
    for r in extract(root):
        if r["source"] != rules:
            continue
        if r["kind"] == "command":
            total += 1
            if not (root / base / "foundation" / f"{r['payload'][0]}.py").is_file():
                missing.append(r)
        elif r["kind"] in ("path", "file", "script"):
            for p in (r["payload"] if isinstance(r["payload"], list) else [r["payload"]]):
                total += 1
                q = p[len(base) + 1:] if p.startswith(base + "/") else p
                if not (tree.has(q) or q in tree.base or p in _pol(root).get("repositories", [])):
                    missing.append(r)
    return {"total": total, "missing": missing}


# ---- running the references ----

def exec_checks(root=REPO, timeout=300) -> list[dict]:
    root, seen, out = Path(root), set(), []
    for r in extract(root):
        if r["kind"] != "command":
            continue
        name, rest = r["payload"]
        args = rest.split()
        if "--check" not in args or any(u in args for u in UNSAFE) or any(re.search(r"[<>|]|\[", a) for a in args):
            continue
        argv = ["--check"]
        if (name, tuple(argv)) in seen:
            continue
        seen.add((name, tuple(argv)))
        sep = "." if f"foundation.{name}" in r["ref"] else " "
        cmd = [sys.executable, "-m"] + (["foundation." + name] if sep == "." else ["foundation", name]) + argv
        try:
            p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
            out.append({"command": f"foundation{sep}{name} --check", "exit": p.returncode, "tail": (p.stdout + p.stderr).strip().splitlines()[-3:]})
        except subprocess.TimeoutExpired:
            out.append({"command": f"foundation{sep}{name} --check", "exit": None, "tail": [f"no result inside {timeout} s"]})
    return out


def _get(url, timeout=20) -> int:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        print(f"rulerefs: {url}: {e}", file=sys.stderr)
        return 0


def live(root=REPO, get=_get) -> list[dict]:
    """GET each referenced endpoint. A route answers when any live host returns something other than 404 or a server error
    (401 and 403 are answers: the route exists and wants the owner). POST-only routes and routes with a placeholder are not fetched."""
    pol, out, seen = _pol(root), [], set()
    routes = _route_sources(root, pol)
    for r in resolve(root):
        if r["kind"] != "route" or r["status"] != "ok" or r["why"]:
            continue
        method, host, path = r["payload"]
        # not fetched: a placeholder or an empty query value (`?id=`), and a route its own router documents as POST
        if method != "GET" or re.search(r"[{<*]|:[a-z]|=$", path) or path in seen or f"POST {path}" in routes:
            continue
        seen.add(path)
        hosts = [host] if host else ["https://" + h for h in pol["hosts"]]
        codes = {h: get(h + path) for h in hosts}
        ok = any(c and c != 404 and c < 500 for c in codes.values())
        out.append({"path": path, "source": r["source"], "line": r["line"], "codes": codes, "ok": ok})
    return out


def main(argv) -> int:
    root = REPO
    if argv[:1] == ["--list"]:
        for r in resolve(root):
            print(f"{r['status']:8} {r['kind']:8} {r['source']}:{r['line']}: {r['ref']}" + (f"  [{r['why']}]" if r["why"] else ""))
        return 0
    if argv[:1] == ["--reverse"]:
        rv = reverse(root)
        if "--json" in argv:
            print(json.dumps(rv, indent=1)); return 0
        c = rv["counts"]
        print(f"foundation modules nothing names or dispatches: {len(rv['modules'])} of {c['modules_total']}")
        for m in rv["modules"]: print("  ", m["module"], "(imported by other code)" if m["imported_elsewhere"] else "(no importer found: dead unless run by path)")
        print(f"workflows no loop owns: {len(rv['workflows'])} of {c['workflows_total']}")
        for w in rv["workflows"]: print("  ", w)
        print(f"site routes nothing links or names: {len(rv['routes'])} of {c['routes_total']}")
        for x in rv["routes"]: print("  ", x)
        return 0
    if argv[:1] == ["--seed"]:
        g = seed_gap(root)
        for r in g["missing"]: print(f"{r['kind']:8} seed/agents/AGENTS.md:{r['line']}: {r['ref']}")
        print(f"rulerefs --seed: {len(g['missing'])} of {g['total']} files and commands the seed's rule file names are not in the seed")
        return 1 if g["missing"] else 0
    if argv[:1] == ["--exec"]:
        res = exec_checks(root)
        bad = [x for x in res if x["exit"] != 0]
        for x in res: print(f"exit {x['exit']}: {x['command']}" + ("" if x["exit"] == 0 else "  | " + " | ".join(x["tail"])[:300]))
        print(f"rulerefs --exec: {len(res)} commands, {len(bad)} not passing")
        return 1 if bad else 0
    if argv[:1] == ["--live"]:
        res = live(root)
        bad = [x for x in res if not x["ok"]]
        for x in bad: print(f"FAIL {x['source']}:{x['line']}: {x['path']} {x['codes']}")
        print(f"rulerefs --live: {len(res)} endpoints, {len(bad)} not answering")
        return 1 if bad else 0
    refs = resolve(root)
    errs = check(root) + reverse_check(root)
    for e in errs: print("FAIL", e)
    n = {s: sum(1 for r in refs if r["status"] == s) for s in ("ok", "external", "wrong", "dangling")}
    for r in refs:
        if r["status"] == "wrong": print(f"WRONG {r['source']}:{r['line']}: `{r['ref']}`: {r['why']}")
    print(f"rulerefs: {len(refs)} references, {n['ok']} resolve, {n['external']} external with a reason, {n['wrong']} with wrong rule text on record, {n['dangling']} dangling" + ("" if errs else "; ok"))
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
