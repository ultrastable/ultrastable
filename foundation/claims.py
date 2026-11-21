# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CLAIMS-1: words must match code, continuously and without a person (Rowan, 2026-11-17).

  python3 -m foundation claims [--check|--fix|--apply|--file|--live|--report]

Every factual or behavioural statement on a public surface (site pages, llms.txt, READMEs, doctrine) is one of three kinds, all in
`doctrine/claims.json`:
  claims     a literal sentence that must still appear on its surface AND whose probe (file, grep, glob count, cron, json) passes;
  generated  a number or list rewritten from code between `<!-- claim:ID -->` markers (test counts, deploy counts): the text cannot drift,
             `--fix` rewrites it, `--check` fails when it is stale;
  inventory  the reverse direction: a set read from code (routes, tools, workflows) must be mentioned on a surface or carry a written exemption.
  modules    a module written by a generator (site/*-data.js and the like): its words are copies of data the generator reads, so the module is
             bound as a whole. Its header must name the generator, the generator must exist and the module's probes (the stale check, the
             check of the data it reads) must pass. Its lines count as bound in coverage only while that holds.
`ledgers` is a counted fact read by the site (/how says how many ledgers there are, from this list, each with a probe).
`live` probes (`--live`) fetch the deployed surface and compare it with the same registry; they run daily in `.github/workflows/claims.yml`.

`--apply` writes site/claims-data.js (served at /claims and /api/claims). `--file` files one docs/issues/Q-CLAIM-*.json item per drift
(idempotent, so the executor takes it in driver order). Exit 1 on any drift. Probes that cannot run are reported as unmeasured, never as passed.
Consumers: site/worker.js, tests/foundation/test_claims.py, .github/workflows/checks.yml and claims.yml, seed (inherited by every tenant).
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG = "doctrine/claims.json"
OUT = "site/claims-data.js"
BLOCK = re.compile(r"(<!-- claim:([\w-]+) -->)(.*?)(<!-- /claim -->)", re.S)


def _read(root, rel):
    p = Path(root) / rel
    return p.read_text(encoding="utf-8") if p.is_file() else None


def probe(root, spec):
    """One probe string -> (ok, detail). file:P · grep:P::RX · glob:PATTERN>=N · cron:WORKFLOW · json:P::a.b==v"""
    root = Path(root)
    kind, _, rest = spec.partition(":")
    if kind == "file":
        return (root / rest).is_file(), rest
    if kind == "grep":
        f, _, rx = rest.partition("::")
        t = _read(root, f)
        return (t is not None and re.search(rx, t, re.M) is not None), f
    if kind == "glob":
        pat, _, n = rest.partition(">=")
        c = len([p for p in root.glob(pat) if p.is_file()])
        return c >= int(n or 1), f"{c} files match {pat}"
    if kind == "cron":
        t = _read(root, rest)
        return (t is not None and re.search(r"^\s*-\s*cron:", t, re.M) is not None), rest
    if kind == "json":
        f, _, expr = rest.partition("::")
        key, _, val = expr.partition("==")
        t = _read(root, f)
        try:
            cur = json.loads(t)
            for k in key.split("."):
                cur = cur[int(k)] if isinstance(cur, list) else cur[k]
        except (TypeError, ValueError, KeyError, IndexError):
            return False, f"{f}: {key} unreadable"
        return str(cur) == val, f"{f}: {key}={cur}"
    return False, f"unknown probe kind {kind!r}"


def measure(root, spec):
    root = Path(root)
    if "py_tests" in spec:
        return sum(len(re.findall(r"^\s*(?:async\s+)?def test_", p.read_text(encoding="utf-8"), re.M)) for d in spec["py_tests"] for p in (root / d).rglob("test_*.py") if "node_modules" not in p.parts)
    if "js_tests" in spec:
        return sum(len(re.findall(r"^\s*(?:test|it)\(", p.read_text(encoding="utf-8"), re.M)) for d in spec["js_tests"] for p in (root / d).rglob("*.test.*js") if "node_modules" not in p.parts)
    if "jsonl_count" in spec:
        c = spec["jsonl_count"]
        n = 0
        for line in (_read(root, c["file"]) or "").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if all(r.get(k) == v for k, v in c.get("where", {}).items()):
                n += 1
        return n
    if "glob_count" in spec:
        return len([p for p in root.glob(spec["glob_count"]) if p.is_file()])
    raise ValueError(f"unknown measure {spec}")


def render(root, g):
    vals = {k: measure(root, v) for k, v in g["measure"].items()}
    return g["template"].format(**vals)


def module_ok(root, m):
    """A generated module is bound when its first lines say it is generated and name its generator, the generator exists and every probe passes."""
    t = _read(root, m["surface"])
    if t is None:
        return False, "module file missing"
    head = "\n".join(t.splitlines()[:4])
    if not re.search(r"generated by", head, re.I) or m["header"] not in head:
        return False, f"the header no longer says it is generated by {m['header']!r}: a hand-edited module is not bound"
    bad = [(sp, d) for sp in ["file:" + m["generator"]] + list(m["probe"]) for ok, d in [probe(root, sp)] if not ok]
    return not bad, "; ".join(f"{sp} failed ({d})" for sp, d in bad)


def module_strings(root, m):
    """Every string a generated module serves, one per line with whitespace collapsed: what a page built from the module can show."""
    t = _read(root, m["surface"]) or ""
    i = t.find("export default")
    out = []

    def walk(o):
        if isinstance(o, str):
            out.append(re.sub(r"\s+", " ", o).strip())
        elif isinstance(o, dict):
            for k, v in o.items():
                walk(k); walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    try:
        walk(json.loads(t[i + len("export default"):].strip().rstrip(";")))
    except ValueError:
        return ""   # not plain data: nothing is taken on trust
    return "\n".join(out)


def _stitched(sent, parts, pats):
    """True when removing every module string found in the sentence leaves nothing claim-like: the page only joined served data."""
    rest = sent
    for x in parts:
        if x in rest:
            rest = rest.replace(x, " ")
    return rest != sent and not any(p.search(rest) for p in pats)


TAG = re.compile(r"</?[A-Za-z][^<>]*>")


def prose(rel, line):
    """The words a reader can see on a source line. A trailing code comment and markup attributes (width="100%") are not statements; alt text is."""
    s = line
    if rel.endswith((".js", ".mjs")):
        s = re.sub(r"/\*.*?\*/", " ", s)
        s = re.sub(r"(^|\s)//\s.*$", " ", s)
    if "<" in s:
        s = TAG.sub(lambda m: " " + " ".join(re.findall(r'\balt=\\?"([^"\\]*)', m.group(0))) + " ", s)
    return s


def claim_lines(root, reg=None):
    """Every claim-like source line: (surface, line number, line). One scanner for coverage and for the binders, so they cannot disagree."""
    root = Path(root); cov = (reg or load(root)).get("coverage", {})
    pats = [re.compile(x, re.I) for x in cov["patterns"]]
    seen = set()
    for g in cov["src_globs"]:
        for f in sorted(root.glob(g)):
            rel = f.relative_to(root).as_posix()
            if rel in seen or not f.is_file() or any(re.search(x, rel) for x in cov["skip"]):
                continue
            seen.add(rel)
            for n, line in enumerate(f.read_text("utf-8", errors="replace").splitlines(), 1):
                if re.match(r"\s*(//|\*|#)", line):
                    continue
                s = prose(rel, line)
                if len(s.strip()) < 40 or not re.search(r"[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}", s) or not any(p.search(s) for p in pats):
                    continue
                yield rel, n, line


def load(root=REPO):
    return json.loads(_read(root, REG))


def evaluate(root=REPO):
    root = Path(root)
    reg = load(root)
    rows, drift = [], []

    def add(id_, surface, claim, how, ok, detail="", kind="claim"):
        rows.append({"id": id_, "surface": surface, "claim": claim, "how": how, "pass": bool(ok), "detail": detail, "kind": kind})
        if not ok:
            drift.append({"id": id_, "surface": surface, "claim": claim, "detail": detail, "kind": kind})

    for c in reg["claims"]:
        t = _read(root, c["surface"])
        if t is None:
            add(c["id"], c["surface"], c["text"], "surface exists", False, "surface file missing")
            continue
        if c["text"] not in t:
            add(c["id"], c["surface"], c["text"], "sentence on surface", False, "the sentence is no longer on the surface: update the registry or restore the words")
            continue
        bad = [(s, d) for s in c["probe"] for ok, d in [probe(root, s)] if not ok]
        add(c["id"], c["surface"], c["text"], " + ".join(c["probe"]), not bad, "; ".join(f"{s} failed ({d})" for s, d in bad))
    for g in reg["generated"]:
        t = _read(root, g["surface"]) or ""
        m = next((b for b in BLOCK.finditer(t) if b.group(2) == g["id"]), None)
        want = render(root, g)
        have = m.group(3) if m else None
        add(g["id"], g["surface"], f"{g['id']}: {want}", "generated from code: " + json.dumps(g["measure"], sort_keys=True), have == want,
            "" if have == want else (f"marker missing" if m is None else f"surface says {have!r}, code says {want!r}; run claims --fix --apply"), "generated")
    for m in reg.get("modules", []):
        ok, d = module_ok(root, m)
        add("module-" + m["id"], m["surface"], f"module: {m['surface']} is written by {m['generator']} from {', '.join(m['source'])}",
            "header names the generator + " + " + ".join(["file:" + m["generator"]] + m["probe"]), ok, d, "module")
    for lg in reg["ledgers"]:
        ok, d = probe(root, lg["probe"])
        add("ledger-" + lg["id"], "site/worker.js (/how)", f"ledger: {lg['name']}", lg["probe"], ok, d, "ledger")
    for inv in reg["inventory"]:
        src = _read(root, inv["set"]["file"]) or ""
        if inv["set"].get("within"):
            w = re.search(inv["set"]["within"], src, re.S)
            src = w.group(1) if w else ""
        items = sorted(set(re.findall(inv["set"]["regex"], src, re.M)))
        text = "\n".join(_read(root, s) or "" for s in inv["surfaces"])
        ex = inv.get("exempt", {})
        missing = [i for i in items if inv["mention"].format(item=i) not in text and i not in ex]
        stale = [i for i in ex if i not in items]
        add(inv["id"], ", ".join(inv["surfaces"]), inv["note"], f"{len(items)} items in {inv['set']['file']} each on the surface or exempt",
            not missing and not stale, ("not described: " + ", ".join(missing) if missing else "") + (" · exemption names nothing in code: " + ", ".join(stale) if stale else ""), "inventory")
    return reg, rows, drift


def fix(root=REPO):
    """Rewrite every generated block from code. Returns the surfaces changed."""
    root = Path(root)
    reg = load(root)
    changed = []
    for g in reg["generated"]:
        t = _read(root, g["surface"])
        if t is None:
            continue
        want = render(root, g)
        new = BLOCK.sub(lambda m: m.group(1) + want + m.group(4) if m.group(2) == g["id"] else m.group(0), t)
        if new != t:
            (root / g["surface"]).write_text(new, encoding="utf-8")
            changed.append(g["surface"])
    return sorted(set(changed))


def _commit(root):
    try:
        r = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True, timeout=20)
        return r.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def data(root=REPO):
    root = Path(root)
    reg, rows, drift = evaluate(root)
    ledgers = [{"id": l["id"], "name": l["name"]} for l in reg["ledgers"]]
    return {"_note": "GENERATED by python3 -m foundation claims --apply from doctrine/claims.json. Do not edit; --check fails when stale.",
            "commit": "see /live", "summary": {"total": len(rows), "pass": sum(r["pass"] for r in rows), "drift": len(drift)},
            "ledgers": ledgers, "claims": rows}


def out_path(root):
    return load(root).get("output", OUT)


def js(d, out=OUT):
    if out.endswith(".json"):
        return json.dumps(d, indent=1, sort_keys=True) + "\n"
    return "// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// " + d["_note"] + "\nexport default " + json.dumps(d, indent=1, sort_keys=True) + ";\n"


def live(root=REPO, fetch=None):
    """Fetch each deployed surface and compare with the registry. Returns (rows, drift). An unreachable surface is unmeasured, not passed."""
    import urllib.request
    reg = load(root)
    rows, drift = [], []
    for l in reg["live"]:
        try:
            if fetch:
                body = fetch(l["url"])
            else:
                with urllib.request.urlopen(urllib.request.Request(l["url"], headers={"user-agent": "ultrastable-claims/1"}), timeout=20) as r:
                    body = r.read().decode("utf-8", "replace")
        except Exception as e:  # logged, never swallowed: the failure is a drift row
            row = {"id": l["id"], "url": l["url"], "pass": False, "detail": f"unmeasured: {e}"}
            rows.append(row); drift.append(row)
            continue
        miss = [c for c in l["contains"] if c not in body]
        row = {"id": l["id"], "url": l["url"], "pass": not miss, "detail": ("missing: " + "; ".join(miss)) if miss else ""}
        rows.append(row)
        if miss:
            drift.append(row)
    return rows, drift


def _bound_texts(root):
    reg = load(root)
    cc = {}
    try:
        cc = json.loads((Path(root) / "doctrine/claim-code.json").read_text("utf-8"))
    except (OSError, ValueError):
        pass
    return [c["text"] for c in reg["claims"]] + [c["quote"] for c in cc.get("claims", [])]


def coverage(root=REPO, fetch=None):
    """COVERAGE-1: claim-like sentences found / bound, on source files and on every live page. Target 1.0; the registry floor is a ratchet."""
    root = Path(root); reg = load(root); cov = reg.get("coverage", {})
    bound_t = _bound_texts(root)
    pats = [re.compile(x, re.I) for x in cov["patterns"]]
    mods = {m["surface"]: module_ok(root, m)[0] for m in reg.get("modules", [])}
    src_found, src_unbound = 0, {}
    for rel, n, line in claim_lines(root, reg):
        src_found += 1
        if rel in mods:
            if not mods[rel]:
                src_unbound.setdefault(rel, []).append(n)
        elif not (any(q in line for q in bound_t) or "<!-- claim:" in line):
            src_unbound.setdefault(rel, []).append(n)
    live_found, live_unbound, pages = 0, {}, []
    import html as _html
    norm = lambda x: re.sub(r"\s+", " ", x).strip()
    bound_n = [norm(q) for q in bound_t]
    mod_text = "\n".join(module_strings(root, m) for m in reg.get("modules", []) if mods.get(m["surface"]))
    mod_parts = sorted({x for x in mod_text.split("\n") if len(x) >= 12}, key=len, reverse=True)
    for u in cov.get("live_pages", []):
        try:
            body = fetch(u) if fetch else _get(u)
        except Exception as e:  # unreachable is unmeasured and reported, never counted as covered
            pages.append({"url": u, "ok": False, "detail": f"unmeasured: {e}"}); continue
        pages.append({"url": u, "ok": True, "detail": ""})
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
        text = _html.unescape(re.sub(r"<[^>]+>", "\n", text))
        for sent in re.split(r"(?<=[.!?])\s+|\n+", text):
            sent = norm(sent)
            if len(sent) < 40 or not re.search(r"[A-Za-z]{3,} [A-Za-z]{2,} [A-Za-z]{2,}", sent) or not any(p.search(sent) for p in pats):
                continue
            live_found += 1
            # bound: it holds a registered sentence, it is a piece of one (a page may cut a registered sentence at a full stop or a tag),
            # or it is a piece of a string a bound generated module serves
            # or its claim-like words all sit inside module strings the page stitched into the sentence
            if not (any(q in sent for q in bound_n) or any(sent in q for q in bound_n) or sent in mod_text or _stitched(sent, mod_parts, pats)):
                live_unbound.setdefault(u, []).append(sent[:100])
    found = src_found + live_found
    unb = sum(len(v) for v in src_unbound.values()) + sum(len(v) for v in live_unbound.values())
    return {"found": found, "bound": found - unb, "ratio": round((found - unb) / found, 4) if found else 1.0, "target": cov.get("target", 1.0),
            "floor": cov.get("floor", 0.0), "src_unbound": src_unbound, "live_unbound": live_unbound, "pages": pages}


def _get(url):
    import urllib.request
    with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-claims/1"}), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def file_coverage(root, c):
    out = []
    groups = {**{k: f"{len(v)} claim-like lines (first {v[0]})" for k, v in c["src_unbound"].items()},
              **{k: f"{len(v)} claim-like sentences, e.g. {v[0]!r}" for k, v in c["live_unbound"].items()}}
    for k, what in groups.items():
        i = "Q-CLAIM-COVER-" + re.sub(r"[^A-Za-z0-9]+", "-", k).strip("-")[:70]
        p = Path(root) / "docs/issues" / f"{i}.json"
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        body = (f"**Owner:** executor\n**Trigger:** claims coverage, every PR and daily\n**Done check:** grep:{REG}::\"surface\": \"{k}\"\n**Status:** open\n\n"
                f"COVERAGE-1: {what} on `{k}` state a number, cadence or guarantee with no registered claim and probe.\n\n"
                "Bind each to a probe in `doctrine/claims.json` (or generate the sentence from code), or change the words to what the code does.\n\n"
                "size: S\n\n**Closing probe:** `python3 -m foundation claims --coverage` lists none for this surface.\n")
        p.write_text(json.dumps({"id": i, "title": f"{i}: unbound claim-like statements on {k}", "body": body, "labels": ["p2", "agent-ready"], "milestone": "Now", "workstream": "Claims"}, indent=2) + "\n", encoding="utf-8")
        out.append(i)
    return out


def file_items(root, drift):
    out = []
    for d in drift:
        i = "Q-CLAIM-" + re.sub(r"[^A-Za-z0-9]+", "-", d["id"]).strip("-")
        p = Path(root) / "docs/issues" / f"{i}.json"
        if p.exists():
            continue
        body = (f"**Owner:** executor\n**Trigger:** claims check, every PR and daily\n**Done check:** grep:{REG}::\"id\": \"{d['id']}\"\n**Status:** open\n\n"
                f"Drift (CLAIMS-1): {d.get('claim', d.get('url', ''))}\n\nSurface: {d.get('surface', d.get('url', ''))}\n\n{d['detail']}\n\n"
                "Fix the words or the code in the same change (prefer generating the words from code), then `python3 -m foundation claims --fix --apply`.\n\n"
                "size: S\n\n**Closing probe:** `python3 -m foundation claims --check` exits 0.\n")
        p.write_text(json.dumps({"id": i, "title": f"{i}: words no longer match code ({d['id']})", "body": body, "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Claims"}, indent=2) + "\n", encoding="utf-8")
        out.append(i)
    return out


def main(argv):
    a = set(argv)
    root = REPO if "--root" not in argv else Path(argv[argv.index("--root") + 1])
    if "--fix" in a:
        for s in fix(root):
            print("rewrote generated claims in", s)
    reg, rows, drift = evaluate(root)
    d = data(root)
    d["commit"] = _commit(root)
    out = out_path(root)
    if "--apply" in a:
        (root / out).parent.mkdir(parents=True, exist_ok=True)
        (root / out).write_text(js({**d, "commit": "generated"}, out), encoding="utf-8")
    stale = False
    cur = _read(root, out)
    if "--check" in a and cur != js({**d, "commit": "generated"}, out):
        stale = True
        print(f"{out} is stale: run claims --fix --apply")
    for r in drift:
        print(f"DRIFT {r['id']} [{r['kind']}] {r['surface']}: {r['detail']}")
    if "--live" in a:
        lrows, ldrift = live(root)
        print(f"live: {len(lrows) - len(ldrift)} of {len(lrows)} deployed surfaces match the registry: " + ", ".join(r["id"] + ("=ok" if r["pass"] else "=DRIFT") for r in lrows))
        for r in ldrift:
            print(f"LIVE DRIFT {r['id']} {r['url']}: {r['detail']}")
        drift = drift + [{"id": "live-" + r["id"], "surface": r["url"], "claim": r["url"], "detail": r["detail"], "kind": "live"} for r in ldrift]
    if "--coverage" in a or "--live" in a:
        c = coverage(root)
        print(f"coverage: {c['bound']} of {c['found']} claim-like statements bound ({c['ratio']*100:.1f}%, target {c['target']*100:.0f}%, floor {c['floor']*100:.1f}%)")
        for pg in c["pages"]:
            if not pg["ok"]:
                print(f"COVERAGE UNMEASURED {pg['url']}: {pg['detail']}")
                if "--live" in a:
                    drift.append({"id": "coverage-" + pg["url"], "surface": pg["url"], "claim": pg["url"], "detail": pg["detail"], "kind": "live"})
        if c["ratio"] < c["floor"]:
            print("COVERAGE DRIFT: ratio fell below the registry floor")
            drift.append({"id": "coverage-floor", "surface": "coverage", "claim": "coverage floor", "detail": f"{c['ratio']} < {c['floor']}", "kind": "coverage"})
        if "--file" in a:
            for i in file_coverage(root, c):
                print("filed", i)
    if "--file" in a:
        for i in file_items(root, drift):
            print("filed", i)
    print(f"claims: {sum(r['pass'] for r in rows)} verified of {len(rows)}; {len(drift)} drift")
    return 1 if (drift or stale) and ("--check" in a or "--live" in a or "--coverage" in a) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
