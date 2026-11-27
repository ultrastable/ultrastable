"""ASHBY-CONCEPTS-1. Ultrastable is the foundation for any autonomous system.

Every concept in doctrine/ashby-concepts.json is bound to code that carries it. --check fails when a mechanism path is gone or lost its
marker, when a reading cannot be computed, or when a gap names no open item. interference() is the multistable reading: of the second loop's
steps, the share after which a different variable that was in bounds fell out of bounds inside the settle window.

ASHBY-KERNEL-1 (Rowan, 2026-11-27: "Implement Ashby's journal and concept index into working parts of an autonomous AI system"): the concepts
are working parts of the kernel every system runs (seed/worker/src/ashby.js, wired into goals.js and tick.js). --check also fails when an
exported function of that module is bound by no concept, when a concept cites a journal page outside 1..7189, or when an implemented concept
names no mechanism. --probe ID is the closing probe of a gap's queue item. --live reads the archive's index and reports how many of its
keywords the register binds; a register anchor the index no longer has is a failure, and an index that cannot be read is unmeasured.

  python3 -m foundation ashbymap [--check|--report|--probe ID|--live]
"""
import json
import re
import sys
import urllib.request
from urllib.parse import unquote
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAP = "doctrine/ashby-concepts.json"
PAGES = 7189  # the journal's last page (https://ashby.info/journal/index.html)
INDEX = "https://ashby.info/journal/index/index.html"


def _t(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")


def interference(rows, window=timedelta(minutes=30)) -> dict:
    """Steps after which another variable went from ok to not ok (measured readings only) within the window."""
    rows = sorted((r for r in rows if r.get("at")), key=lambda r: r["at"])
    last = {}
    steps, hit = 0, 0
    pending = []
    for r in rows:
        at = _t(r["at"])
        if r.get("ev") == "step":
            ok_now = {v for v, ok in last.items() if ok and v != r.get("var")}
            pending.append((at, r.get("var"), ok_now, [False]))
            steps += 1
        elif r.get("ev") == "reading" and not r.get("unmeasured"):
            v, ok = r.get("var"), bool(r.get("ok"))
            for p in pending:
                if not p[3][0] and at - p[0] <= window and v in p[2] and not ok:
                    p[3][0] = True
                    hit += 1
            last[v] = ok
            pending = [p for p in pending if at - p[0] <= window and not p[3][0]]
    return {"steps": steps, "disturbed": hit, "interference_share": round(hit / steps, 3) if steps else None}


def readings(root=REPO) -> dict:
    from foundation import ultrastability
    out = dict(ultrastability.ashby(root))
    led = Path(root) / ultrastability.load(root)["ledger"]
    rows = [json.loads(l) for l in led.read_text(encoding="utf-8").splitlines() if l.strip()] if led.exists() else []
    out.update(interference(rows))
    out.update(coverage(root))
    return out


def anchors(c) -> list[str]:
    """The index anchors a concept binds: its own and the further keywords the same mechanism answers."""
    own = [unquote(c["url"].split("#", 1)[1])] if "#" in c.get("url", "") and "/index/index.html#" in c["url"] else []
    return own + list(c.get("keywords", []))


def exports(root=REPO, kernel=None) -> list[str]:
    """Every name the kernel module exports."""
    kernel = kernel or json.loads((Path(root) / MAP).read_text(encoding="utf-8")).get("kernel")
    src = (Path(root) / kernel).read_text(encoding="utf-8") if kernel and (Path(root) / kernel).exists() else ""
    return re.findall(r"^export (?:async )?(?:function|const) (\w+)", src, flags=re.M)


def unbound(root=REPO) -> list[str]:
    """Kernel exports no concept's mechanism names: code that claims a source it is not registered against."""
    m = json.loads((Path(root) / MAP).read_text(encoding="utf-8"))
    marks = " ".join(spec for c in m["concepts"] for spec in c["mechanisms"] if spec.startswith(m.get("kernel", "\0")))
    return [e for e in exports(root, m.get("kernel")) if not re.search(rf"\b{re.escape(e)}\b", marks)]


def coverage(root=REPO) -> dict:
    m = json.loads((Path(root) / MAP).read_text(encoding="utf-8"))
    cs = m["concepts"]
    kernel = [c for c in cs if c["status"] == "implemented" and any(s.startswith("seed/") for s in c["mechanisms"])]
    return {"concepts": len(cs), "implemented": sum(c["status"] == "implemented" for c in cs), "ashby_gaps": sum(c["status"] == "gap" for c in cs),
            "in_kernel": len(kernel), "keywords_bound": len({a for c in cs for a in anchors(c)}), "kernel_exports_unbound": len(unbound(root))}


def probe(cid, root=REPO) -> list[str]:
    """Closing probe of a gap item: the concept is implemented and its mechanisms hold."""
    m = json.loads((Path(root) / MAP).read_text(encoding="utf-8"))
    c = next((x for x in m["concepts"] if x["id"] == cid), None)
    if not c:
        return [f"{cid}: no such concept"]
    if c["status"] != "implemented" or not c["mechanisms"]:
        return [f"{cid}: still a gap"]
    return [e for e in check(root) if e.startswith(cid + ":")]


def _fetch(url, timeout=30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-ashbymap/1"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def live(root=REPO, fetch=_fetch) -> dict:
    """Read the archive's keyword index. Coverage is a count of anchors; none of the index's text is kept."""
    m = json.loads((Path(root) / MAP).read_text(encoding="utf-8"))
    try:
        html = fetch(INDEX)
    except Exception as e:  # noqa: BLE001 - any failure to read is the same reading: unmeasured
        return {"measured": False, "error": str(e)[:160], "keywords": None, "bound": None, "share": None, "dead": []}
    ids = set(re.findall(r'<a class="nav" href="\.\./index/[^"]+" id="([^"]+)"', html))
    if not ids:
        return {"measured": False, "error": "no keyword anchors found in the index", "keywords": None, "bound": None, "share": None, "dead": []}
    mine = {a for c in m["concepts"] for a in anchors(c)}
    return {"measured": True, "keywords": len(ids), "bound": len(mine & ids), "share": round(len(mine & ids) / len(ids), 3), "dead": sorted(mine - ids)}


def check(root=REPO) -> list[str]:
    root = Path(root)
    m = json.loads((root / MAP).read_text(encoding="utf-8"))
    errs, have = [], None
    seen = set()
    for c in m["concepts"]:
        if c["id"] in seen:
            errs.append(f"{c['id']}: listed twice")
        seen.add(c["id"])
        if not c.get("url", "").startswith("https://ashby.info/"):
            errs.append(f"{c['id']}: source is not an ashby.info page")
        if any(not isinstance(n, int) or not 1 <= n <= PAGES for n in c.get("pages", [])):
            errs.append(f"{c['id']}: a cited journal page is outside 1..{PAGES}")
        if any(not re.fullmatch(r"[a-z0-9_()'-]+", k) for k in c.get("keywords", [])):
            errs.append(f"{c['id']}: a keyword is not an index anchor")
        if c["status"] == "implemented" and not c["mechanisms"]:
            errs.append(f"{c['id']}: implemented with no mechanism")
        for spec in c["mechanisms"]:
            path, _, mark = spec.partition("::")
            f = root / path
            if not f.exists():
                errs.append(f"{c['id']}: {path} is missing")
            elif mark and mark not in f.read_text(encoding="utf-8"):
                errs.append(f"{c['id']}: {path} no longer holds {mark!r}")
        if c.get("reading"):
            have = have if have is not None else readings(root)
            if c["reading"] not in have:
                errs.append(f"{c['id']}: reading {c['reading']} is not computed")
        if c["status"] == "gap" and not (root / "docs/issues" / f"{c.get('item', '')}.json").exists():
            errs.append(f"{c['id']}: gap with no open item")
    if m.get("kernel"):
        if not (root / m["kernel"]).exists():
            errs.append(f"kernel module {m['kernel']} is missing")
        errs += [f"{m['kernel']}: export {e} is bound by no concept" for e in unbound(root)]
    for n in m.get("not_applied", []):
        if not n.get("url", "").startswith("https://ashby.info/") or not n.get("reason"):
            errs.append(f"not_applied {n.get('category')}: needs an ashby.info page and a reason")
    return errs


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if "--report" in argv:
        print(json.dumps(readings(), indent=2))
        return 0
    if "--probe" in argv:
        errs = probe(argv[argv.index("--probe") + 1])
        for e in errs:
            print("ashbymap:", e)
        print(f"ashbymap: probe {'FAIL' if errs else 'ok'}")
        return 1 if errs else 0
    if "--live" in argv:
        r = live()
        print(json.dumps(r, indent=2))
        return 1 if r["measured"] and r["dead"] else 0
    errs = check()
    for e in errs:
        print("ashbymap:", e)
    print(f"ashbymap: {'FAIL' if errs else 'ok'} ({len(json.loads((REPO / MAP).read_text())['concepts'])} concepts)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
