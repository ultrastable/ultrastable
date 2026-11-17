"""CLAIMS-1: words must match code, continuously and without a person (Rowan, 2026-11-17).

  python3 -m foundation claims [--check|--fix|--apply|--file|--live|--report]

Every factual or behavioural statement on a public surface (site pages, llms.txt, READMEs, doctrine) is one of three kinds, all in
`doctrine/claims.json`:
  claims     a literal sentence that must still appear on its surface AND whose probe (file, grep, glob count, cron, json) passes;
  generated  a number or list rewritten from code between `<!-- claim:ID -->` markers (test counts, deploy counts): the text cannot drift,
             `--fix` rewrites it, `--check` fails when it is stale;
  inventory  the reverse direction: a set read from code (routes, tools, workflows) must be mentioned on a surface or carry a written exemption.
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
    return "// " + d["_note"] + "\nexport default " + json.dumps(d, indent=1, sort_keys=True) + ";\n"


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
        for r in ldrift:
            print(f"LIVE DRIFT {r['id']} {r['url']}: {r['detail']}")
        drift = drift + [{"id": "live-" + r["id"], "surface": r["url"], "claim": r["url"], "detail": r["detail"], "kind": "live"} for r in ldrift]
    if "--file" in a:
        for i in file_items(root, drift):
            print("filed", i)
    print(f"claims: {sum(r['pass'] for r in rows)} verified of {len(rows)}; {len(drift)} drift")
    return 1 if (drift or stale) and ("--check" in a or "--live" in a) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
