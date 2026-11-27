# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ASHBY-ARCHIVE-1: W. Ross Ashby's journal (The W. Ross Ashby Digital Archive, https://ashby.info) as a register the system works from.
Ultrastable is the foundation for any autonomous system.

Owner, 2026-11-27: "Ashby's website is a wealth of useful information to incorporate in Ultrastable ... Incorporate all information in Ultrastable
systems code." The journal is 7,189 handwritten pages in 25 volumes with Ashby's own index (678 primary keywords) and an Other Index (subject
categories such as The Multistable System). Its text is copyright of the Ashby estate, so the register keeps what an index is (each keyword, its
page numbers and approximate years, each subject category with its page references, all linked to the archive) and states every principle the
system takes from it in our own words with the pages it comes from. Nothing of the journal's wording is copied beyond a short quoted phrase.

"All information" is held as an accounting rule, not a promise: every keyword and every category has a disposition, and the share that has one is a
measured number (`archive_triaged_share`, target 1.0):
  mapped       a principle in the register names it, with the code that carries it (status built, with a probe) or the item that will (status item)
  background   computed: it shares no page with any category the register marks as about systems, so nothing in the code follows from it
  not-applicable   a declared reason (clinical, biographical), in `not_applicable`
  pending      none of these yet: the loop files Q-ASHBY-<keyword> items, most-referenced first, at most `max_items` a pass

  python3 -m foundation ashbyarchive --build DIR [--apply]   parse fetched archive pages (keyword index, other-index categories) into the register
  python3 -m foundation ashbyarchive --report                counts, dispositions, principles and their status
  python3 -m foundation ashbyarchive --run [--apply]         file Q-ASHBY items for pending keywords and for principles that are not built
  python3 -m foundation ashbyarchive --probe ID              exit 0 when a principle's probe passes (or a keyword has a disposition)
  python3 -m foundation ashbyarchive --live                  the archive still answers (one request, robots.txt crawl delay honoured)
  python3 -m foundation ashbyarchive --check                 register valid; every principle's code exists and its probe passes when built
Tests: tests/foundation/test_ashbyarchive.py.
"""
from __future__ import annotations
import html, json, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG = "doctrine/ashby-archive.json"
BASE = "https://ashby.info/journal/"
UA = "ultrastable-research/1 (+https://ultrastable.io)"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / REG).read_text(encoding="utf-8"))


def dump(reg: dict) -> str:
    """The register as JSON with one index entry per line, so a refresh changes one line per changed entry (SMALL-CHANGE-1)."""
    head = {k: v for k, v in reg.items() if k not in ("keywords", "categories")}
    body = json.dumps(head, indent=1, ensure_ascii=False)[:-2]
    for key in ("categories", "keywords"):
        rows = ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in reg.get(key, []))
        body += f',\n "{key}": [\n{rows}\n ]'
    return body + "\n}\n"


def _text(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_keywords(page: str) -> list[dict]:
    """The alphabetical index: one entry per primary keyword, with its page numbers and approximate years. Secondary terms are counted, not copied."""
    cloud = re.findall(r'<a href="#([^"]+)" title="\d+ references?"[^>]*nrefs="(\d+)" id="\d+">([^<]+)</a>', page)
    out = []
    for anchor, n, term in cloud:
        m = re.search(r'id="%s" title="View the original card' % re.escape(anchor), page)
        sec = ""
        if m:
            end = page.find('<font class="k1">', m.end())
            sec = page[m.end(): end if end > 0 else len(page)]
        pages = sorted({int(p) for p in re.findall(r'class="(?:page|range)" href="\.\./page/\d+\.html" title="[^"]*">(\d+)</a>', sec)})
        years = sorted({int(y) for y in re.findall(r'title="~(\d{4})"', sec)})
        body = re.sub(r"<a [^>]*>.*?</a>|<small>|</small>|[{}]", " ", sec.split("<br>", 1)[-1] if "<br>" in sec else sec)
        subterms = [x for x in (t.strip() for t in _text(body).split("  ")) if x]
        out.append({"id": anchor, "term": html.unescape(term).strip(), "refs": int(n), "pages": pages,
                    "years": [years[0], years[-1]] if years else None, "subterms": len(re.findall(r"\n\s+[^<\s][^<\n]*\n\s+<a", sec)) or len(subterms),
                    "url": f"{BASE}index/index.html#{anchor}"})
    return out


def parse_category(page: str, slug: str) -> dict:
    """An Other Index category: its title and, per entry, the journal pages it cites (Ashby's own page numbers). Entry wording is not copied."""
    items = re.findall(r'<li id="\d+">(.*?)</li>', page, flags=re.S)
    title, num, entries = slug, "", []
    for it in items:
        t = _text(re.sub(r'<a class="nav"[^>]*>.*?</a>', " ", it, flags=re.S))
        if t.startswith("Divider:"):
            num = t.split(":", 1)[1].strip()
            continue
        if t.startswith("Section Title:"):
            title = t.split(":", 1)[1].strip()
            continue
        pages = [int(x) for x in re.findall(r'class="(?:page|range)" href="[^"]*page/\d+\.html" title="[^"]*">(\d+)</a>', it)]
        years = [int(y) for y in re.findall(r'title="~(\d{4})"', it)]
        entries.append({"pages": pages, "year": min(years) if years else None})
    allp = sorted({p for e in entries for p in e["pages"]})
    return {"id": slug, "number": num, "title": title, "entries": len(entries), "pages": allp, "entry_pages": [e["pages"] for e in entries],
            "url": f"{BASE}index/other/{slug}.html"}


def build(src: Path, root=REPO, apply=False) -> dict:
    """Refresh the index part of the register from fetched pages; the principles, dispositions and settings are kept as they are."""
    src, root = Path(src), Path(root)
    reg = load(root) if (root / REG).is_file() else {"$schema": "./schemas/ashby-archive.schema.json"}
    kw = src / "journal_index_index.html"
    if kw.is_file():
        reg["keywords"] = parse_keywords(kw.read_text(encoding="utf-8", errors="replace"))
    cats = []
    for f in sorted((src / "other").glob("*.html")):
        if f.stem != "index":
            cats.append(parse_category(f.read_text(encoding="utf-8", errors="replace"), f.stem))
    if cats:
        reg["categories"] = sorted(cats, key=lambda c: (float(re.sub(r"[^0-9.]", "", c["number"].replace("½", ".5")) or 99), c["id"]))
        reg["source"] = {**reg.get("source", {}), "category_entries": sum(c["entries"] for c in cats)}
    if apply:
        (root / REG).write_text(dump(reg), encoding="utf-8")
    return {"keywords": len(reg.get("keywords", [])), "categories": len(reg.get("categories", []))}


def _probe(root, spec: str) -> bool:
    if spec.startswith("file:"):
        return (Path(root) / spec[5:]).exists()
    if spec.startswith("grep:"):
        path, _, rx = spec[5:].partition("::")
        p = Path(root) / path
        return p.is_file() and re.search(rx, p.read_text(encoding="utf-8", errors="replace")) is not None
    return False


CONCEPTS = "doctrine/ashby-concepts.json"


def concept_keywords(root=REPO) -> dict:
    """keyword anchor -> concept id, for every concept in the ASHBY-CONCEPTS-1 map whose source is a keyword of Ashby's index."""
    p = Path(root) / CONCEPTS
    if not p.is_file():
        return {}
    out = {}
    for c in json.loads(p.read_text(encoding="utf-8")).get("concepts", []):
        m = re.search(r"journal/index/index\.html#([^\s\"]+)$", c.get("url", ""))
        if m:
            out[m.group(1)] = c["id"]
    return out


def dispositions(reg: dict, concepts: dict | None = None) -> dict:
    """keyword id -> (disposition, why). Computed every time from the principles, the concept map and the categories, never stored."""
    systems_pages = {p for c in reg.get("categories", []) if c["id"] in set(reg.get("systems_categories", [])) for p in c["pages"]}
    mapped = {k: "concept:" + c for k, c in (concepts or {}).items()}  # ASHBY-CONCEPTS-1 (doctrine/ashby-concepts.json) maps these to code already
    mapped.update({k: pr["id"] for pr in reg.get("principles", []) for k in pr.get("keywords", [])})
    na = reg.get("not_applicable", {})
    out = {}
    for k in reg.get("keywords", []):
        if k["id"] in mapped:
            out[k["id"]] = ("mapped", mapped[k["id"]])
        elif k["id"] in na:
            out[k["id"]] = ("not-applicable", na[k["id"]])
        elif not k["pages"] or not (set(k["pages"]) & systems_pages):
            out[k["id"]] = ("background", "no page shared with a systems category")
        else:
            out[k["id"]] = ("pending", f"{len(set(k['pages']) & systems_pages)} pages shared with systems categories")
    for c in reg.get("categories", []):
        cid = "category:" + c["id"]
        if any(cid in pr.get("keywords", []) or c["id"] == pr.get("category") for pr in reg.get("principles", [])):
            out[cid] = ("mapped", next(pr["id"] for pr in reg["principles"] if cid in pr.get("keywords", []) or c["id"] == pr.get("category")))
        elif c["id"] in na:
            out[cid] = ("not-applicable", na[c["id"]])
        elif c["id"] not in set(reg.get("systems_categories", [])):
            out[cid] = ("background", "not a systems category")
        else:
            out[cid] = ("pending", "systems category with no principle yet")
    return out


def report(root=REPO) -> dict:
    reg = load(root)
    d = dispositions(reg, concept_keywords(root))
    counts = {}
    for kind, _ in d.values():
        counts[kind] = counts.get(kind, 0) + 1
    pr = [{"id": p["id"], "status": p["status"], "probe_ok": all(_probe(root, s) for s in p.get("probes", [])) if p.get("probes") else None,
           "metric": p.get("metric")} for p in reg.get("principles", [])]
    triaged = sum(v for k, v in counts.items() if k != "pending")
    return {"keywords": len(reg.get("keywords", [])), "references": sum(k["refs"] for k in reg.get("keywords", [])), "categories": len(reg.get("categories", [])),
            "category_entries": sum(c["entries"] for c in reg.get("categories", [])), "dispositions": counts,
            "archive_triaged_share": round(triaged / len(d), 3) if d else None, "n": len(d),
            "principles": pr, "principles_built_share": round(sum(1 for p in pr if p["status"] == "built" and p["probe_ok"]) / len(pr), 3) if pr else None}


def _item(iid, title, body, labels):
    return {"id": iid, "title": f"{iid}: {title}", "body": body, "labels": labels, "milestone": "Next", "workstream": "Research"}


def run(root=REPO, apply=False) -> dict:
    root, reg = Path(root), load(root)
    d = dispositions(reg, concept_keywords(root))
    by = {k["id"]: k for k in reg.get("keywords", [])}
    pend = sorted((k for k, (kind, _) in d.items() if kind == "pending" and k in by), key=lambda k: (-by[k]["refs"], k))
    filed = []
    for k in pend[: reg.get("max_items", 5)]:
        kw = by[k]
        iid = f"Q-ASHBY-{re.sub(r'[^A-Za-z0-9]+', '-', k).strip('-')}"
        if (root / "docs/issues" / f"{iid}.json").exists():
            continue
        body = (f"**Owner:** product-manager\n**Trigger:** ashbyarchive pass: Ashby's keyword \"{kw['term']}\" ({kw['refs']} references, pages {', '.join(map(str, kw['pages'][:12]))}"
                f"{' ...' if len(kw['pages']) > 12 else ''}) shares pages with the systems categories and has no disposition\n"
                f"**Done check:** cmd:python3 -m foundation ashbyarchive --probe {k}\n"
                "**Prediction:** archive_triaged_share >= 1.0 within 720 h\n"
                "**Out of scope:** copying the journal's wording into the repository; marking a keyword not-applicable without a reason a reader can check\n"
                "**Status:** open\n\n"
                f"Read the cited pages ({kw['url']}; page images at {BASE}page/NNNN.html, transcribed summaries at {BASE}summaries) and dispose of the keyword in "
                f"{REG}: add it to a principle (our own statement, the pages, the code that carries it, a probe), or to `not_applicable` with the reason. "
                "A principle whose code does not exist yet is status item, with its own item.\n\nsize: S\n\n"
                f"**Closing probe:** `python3 -m foundation ashbyarchive --probe {k}`\n")
        filed.append(iid)
        if apply:
            (root / "docs/issues" / f"{iid}.json").write_text(json.dumps(_item(iid, f"dispose of Ashby keyword {kw['term']}", body, ["research", "plus", "role:product-manager"]), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for p in reg.get("principles", []):
        if p["status"] == "built":
            continue
        iid = f"Q-ASHBY-{p['id']}"
        if (root / "docs/issues" / f"{iid}.json").exists():
            continue
        body = (f"**Owner:** executor\n**Trigger:** ashbyarchive pass: principle {p['id']} is status {p['status']}\n"
                f"**Done check:** cmd:python3 -m foundation ashbyarchive --probe {p['id']}\n"
                f"**Prediction:** {p.get('prediction') or 'archive_principles_built_share >= 1.0 within 720 h'}\n"
                "**Out of scope:** restating the principle in a document; the change is code a loop runs\n**Status:** open\n\n"
                f"{p['statement']} (Ashby's journal, pages {', '.join(map(str, p['pages']))}). Build: {p.get('build', 'the mechanism named in ' + REG)}. "
                f"When it is code, set status built and give the probes that find it.\n\nsize: M\n\n**Closing probe:** `python3 -m foundation ashbyarchive --probe {p['id']}`\n")
        filed.append(iid)
        if apply:
            (root / "docs/issues" / f"{iid}.json").write_text(json.dumps(_item(iid, f"build Ashby principle {p['id']}", body, ["p1", "agent-ready", "raises-self"]), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"filed": filed, "pending": len(pend)}


def probe(root, ident) -> tuple[bool, str]:
    reg = load(root)
    for p in reg.get("principles", []):
        if p["id"] == ident:
            ok = p["status"] == "built" and bool(p.get("probes")) and all(_probe(root, s) for s in p["probes"])
            return ok, f"{ident}: status {p['status']}, probes {'pass' if ok else 'do not all pass'}"
    kind, why = dispositions(reg, concept_keywords(root)).get(ident, ("unknown", "no such keyword or principle"))
    return kind not in ("pending", "unknown"), f"{ident}: {kind} ({why})"


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        reg = load(root)
    except (OSError, ValueError) as e:
        return [f"{REG}: unreadable: {e}"]
    pages = {p for k in reg.get("keywords", []) for p in k["pages"]} | {p for c in reg.get("categories", []) for p in c["pages"]}
    ids = {k["id"] for k in reg.get("keywords", [])} | {"category:" + c["id"] for c in reg.get("categories", [])}
    from . import research
    for p in reg.get("principles", []):
        for k in ("id", "statement", "pages", "status", "mechanisms"):
            if not p.get(k):
                bad.append(f"principle {p.get('id')}: missing {k}")
        if p.get("status") not in ("built", "item"):
            bad.append(f"principle {p.get('id')}: status must be built or item")
        for m in p.get("mechanisms", []):
            if not (root / m).exists():
                bad.append(f"principle {p['id']}: mechanism {m} does not exist")
        if p.get("status") == "built" and not (p.get("probes") and all(_probe(root, s) for s in p["probes"])):
            bad.append(f"principle {p['id']}: built but its probes do not all pass")
        for pg in p.get("pages", []):
            if pages and pg not in pages:
                bad.append(f"principle {p['id']}: page {pg} is in no index entry of the register")
        for k in p.get("keywords", []):
            if ids and k not in ids:
                bad.append(f"principle {p['id']}: keyword {k} is not in the register")
        if p.get("metric") and p["metric"] not in research.METRICS:
            bad.append(f"principle {p['id']}: metric {p['metric']} is not measured by foundation/research.py")
    for k in reg.get("not_applicable", {}):
        if k not in {x["id"] for x in reg.get("keywords", [])} | {c["id"] for c in reg.get("categories", [])}:
            bad.append(f"not_applicable: {k} is not in the register")
    for c in reg.get("systems_categories", []):
        if c not in {x["id"] for x in reg.get("categories", [])}:
            bad.append(f"systems_categories: {c} is not a fetched category")
    return bad


def live(fetch=None) -> tuple[bool, str]:
    def get(u):
        req = urllib.request.Request(u, headers={"user-agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    try:
        st = (fetch or get)(BASE + "index.html")
    except OSError as e:
        return False, f"archive unreachable: {e}"
    return st == 200, f"archive answered {st}"


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "ashbyarchive ok: every principle's code exists and every built principle's probe passes")
        return 1 if bad else 0
    if "--build" in a:
        print(json.dumps(build(Path(a[a.index("--build") + 1]), REPO, "--apply" in a)))
        return 0
    if "--run" in a:
        print(json.dumps(run(REPO, "--apply" in a), indent=1))
        return 0
    if "--probe" in a:
        ok, msg = probe(REPO, a[a.index("--probe") + 1])
        print(msg)
        return 0 if ok else 1
    if "--live" in a:
        ok, msg = live()
        print(msg)
        return 0 if ok else 1
    print(json.dumps(report(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
