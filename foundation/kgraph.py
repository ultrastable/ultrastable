# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KGRAPH-1 (Rowan, 2026-11-25): every Ultrastable system keeps a knowledge graph of all its data and mines it for connections nobody made.

The tick Worker builds the live graph from its D1 records (seed/worker/src/graph.js). This is the repository half, run daily inside the temporal
workflow for the core and for every tenant it clones: the work items (docs/issues), research studies, standing rules (agents/AGENTS.md) and each
system's declared data globs (doctrine/kgraph.json) become nodes; ids, rule tags and file paths they mention become edges. The same insight rule as
the Worker runs here: two records that read alike, have no edge and share no neighbour are a lead. At most `max_filed_per_day` leads in the core
become Q-KG-<hash> queue items whose closing probe (`kgraph --settled ID`) passes when the pair is linked for real or the lead is declined in
ops/kgraph/declined.json. Every lead and its outcome is kept in ops/kgraph/leads.jsonl, so insight yield (kept / filed) is measured, not claimed.
Outputs: ops/kgraph/<system>.json (counts, kinds, newest leads), ops/kgraph/series.jsonl (one row per system per run). No model, no network.
"""
from __future__ import annotations
import datetime as dt, fnmatch, hashlib, json, re, sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
POLICY = "doctrine/kgraph.json"
STOP = set("the a an and or of to in on for with by from is are be was it this that as at not no into its their when then than each per every one two after "
           "before over under has have had will must can may only also any all new old item items owner trigger done check closing probe status open closed "
           "evidence passed rowan".split())
TAG = re.compile(r"(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b")
PATH = re.compile(r"\b[\w-]+(?:/[\w.-]+)+\.(?:js|mjs|py|json|md|sql|yml)\b")
NOW = lambda: dt.datetime.now(dt.timezone.utc)
ISO = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")


def terms(text: str, n: int = 24) -> list[str]:
    c = Counter(w for w in re.findall(r"[a-z][a-z0-9]{2,}", str(text).lower()) if w not in STOP)
    return [w for w, _ in sorted(c.items(), key=lambda x: (-x[1], x[0]))[:n]]


def mentions(text: str) -> list[str]:
    return sorted({"tag:" + m for m in TAG.findall(str(text))} | {"file:" + m for m in PATH.findall(str(text))})


def similarity(a: list[str], b: list[str]) -> float:
    A, B = set(a), set(b)
    return len(A & B) / (len(A) * len(B)) ** 0.5 if A and B else 0.0


def load(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def records(root: Path, pol: dict) -> list[dict]:
    """Every record a system holds, as {id, kind, label, text}. Unreadable files are reported, never dropped silently."""
    out = []
    for src in pol["sources"]:
        for p in sorted(root.glob(src["glob"])):
            try:
                if p.suffix == ".json":
                    d = json.loads(p.read_text(encoding="utf-8"))
                    rows = d if isinstance(d, list) else d.get(src["list"], []) if src.get("list") else [d]
                    for r in rows:
                        if not isinstance(r, dict):
                            continue
                        rid = str(r.get(src.get("id", "id")) or p.stem)
                        text = " ".join(str(r.get(f, "")) for f in src.get("text", ["title", "body"]))
                        out.append({"id": f"{src.get('prefix', 'tag:')}{rid}", "kind": src["kind"], "label": str(r.get(src.get("label", "title")) or rid)[:160], "text": text})
                        for f in r.get(src["sub"], []) if src.get("sub") else []:
                            out.append({"id": f"{src.get('prefix', 'tag:')}{rid}:{f.get('id')}", "kind": src["kind"] + "-finding", "label": str(f.get("concern", ""))[:160],
                                        "text": f"{f.get('concern', '')} {f.get('claim', '')}", "parent": f"{src.get('prefix', 'tag:')}{rid}"})
                else:
                    t = p.read_text(encoding="utf-8")
                    if src.get("rule_bullets"):
                        for line in t.splitlines():
                            mt = re.match(r"^- \*\*(.+?)\((?P<id>[A-Z][A-Z0-9-]+-\d+)[,)]", line)
                            if mt:
                                out.append({"id": "tag:" + mt["id"], "kind": "rule", "label": mt.group(1).strip()[:160], "text": line[:1500]})
                    else:
                        out.append({"id": "file:" + str(p.relative_to(root)), "kind": src["kind"], "label": p.stem, "text": t[:4000]})
            except (OSError, ValueError) as e:
                print(f"kgraph: {p}: unreadable ({e})", file=sys.stderr)
    return out


def build(root: Path, pol: dict) -> dict:
    nodes, edges = {}, set()
    for r in records(root, pol):
        n = nodes.setdefault(r["id"], {"id": r["id"], "kind": r["kind"], "label": r["label"], "terms": []})
        n["kind"], n["label"] = r["kind"], r["label"]
        n["terms"] = terms(f"{r['label']} {r['text']}")
        if r.get("parent"):
            edges.add((r["parent"], "has", r["id"]))
        for m in mentions(f"{r['label']} {r['text']}"):
            if m != r["id"]:
                nodes.setdefault(m, {"id": m, "kind": m.split(":")[0], "label": m.split(":", 1)[1], "terms": []})
                edges.add((r["id"], "mentions", m))
    for al in pol.get("aliases", []):  # structural links a template implies (a Q-RES item and the finding it tests): known, so never a lead
        rx = re.compile(al["pattern"])
        for nid in list(nodes):
            mt = rx.match(nid)
            if mt and mt.expand(al["to"]) in nodes:
                edges.add((nid, al.get("rel", "alias"), mt.expand(al["to"])))
    return {"nodes": nodes, "edges": edges}


def family(nid: str) -> str:
    """Records filed by one template share their first two id segments (Q-ULTRA-x-spend, Q-ULTRA-x-value). Siblings are known, never a lead."""
    return "-".join(nid.split(":", 1)[-1].split("-")[:2])


def find_leads(g: dict, pol: dict, known: set) -> list[dict]:
    """Similar, unlinked and sharing no neighbour (hubs excluded). An inverted index keeps it far below all pairs."""
    nodes, k = g["nodes"], pol["insight"]
    adj = defaultdict(set)
    for s, _, d in g["edges"]:
        adj[s].add(d); adj[d].add(s)
    hub = {n for n, v in adj.items() if len(v) > k["hub_degree"]}
    content = [n for n in nodes.values() if n["kind"] in k["kinds"] and len(n["terms"]) >= 3]
    df = Counter(t for n in content for t in set(n["terms"]))
    idx = defaultdict(list)
    for n in content:
        for t in n["terms"]:
            if df[t] <= k["max_term_df"]:
                idx[t].append(n["id"])
    pairs = Counter()
    for ids in idx.values():
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                pairs[(min(a, b), max(a, b))] += 1
    out = []
    for (a, b), shared in pairs.items():
        if shared < k["min_shared"] or family(a) == family(b):
            continue
        s = similarity(nodes[a]["terms"], nodes[b]["terms"])
        if s < k["threshold"] or b in adj[a] or (adj[a] & adj[b]) - hub:
            continue
        lid = "Q-KG-" + hashlib.sha1(f"{a}|{b}".encode()).hexdigest()[:10]
        if lid in known:
            continue
        common = [t for t in nodes[a]["terms"] if t in set(nodes[b]["terms"])][:5]
        out.append({"id": lid, "a": a, "b": b, "score": round(s, 3), "la": nodes[a]["label"], "lb": nodes[b]["label"], "why": f"read alike ({', '.join(common)}) but nothing links them"})
    return sorted(out, key=lambda x: (-x["score"], x["id"]))


def _jsonl(p: Path) -> list[dict]:
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []


def linked(g: dict, a: str, b: str) -> bool:
    return any((s, d) in ((a, b), (b, a)) for s, _, d in g["edges"])


def run(root=REPO, system="core", out=None, apply=False, pol=None) -> dict:
    root, out = Path(root), Path(out or REPO)
    pol = pol or load(out)
    g = build(root, pol)
    state = out / "ops/kgraph"
    ledger = _jsonl(state / "leads.jsonl")
    mine = [x for x in ledger if x.get("system") == system]
    declined = set(json.loads((state / "declined.json").read_text(encoding="utf-8"))) if (state / "declined.json").is_file() else set()
    last = {}
    for x in mine:
        last[x["id"]] = x
    now = ISO(NOW())
    settle = [{**x, "ev": "settled", "outcome": "kept" if linked(g, x["a"], x["b"]) else "declined", "at": now}
              for x in last.values() if x.get("ev") == "lead" and (linked(g, x["a"], x["b"]) or x["id"] in declined)]
    new = find_leads(g, pol, set(last))[: pol["insight"]["max_leads_per_run"]]
    today = now[:10]
    filed_today = sum(1 for x in mine if x.get("filed") and str(x.get("at", "")).startswith(today))
    to_file = new[: max(0, pol["insight"]["max_filed_per_day"] - filed_today)] if system == "core" else []
    rows = settle + [{**x, "ev": "lead", "system": system, "at": now, "filed": x in to_file} for x in new]
    all_rows = mine + rows
    fin = {}
    for x in all_rows:
        fin[x["id"]] = x
    filed = [x for x in fin.values() if x.get("filed") or (x.get("ev") == "settled" and x.get("filed"))]
    kept = [x for x in fin.values() if x.get("outcome") == "kept"]
    kinds = Counter(n["kind"] for n in g["nodes"].values())
    summary = {"system": system, "at": now, "nodes": len(g["nodes"]), "edges": len(g["edges"]), "kinds": dict(kinds.most_common()),
               "leads": len(fin), "filed": len(filed), "kept": len(kept), "yield": round(len(kept) / len(filed), 3) if filed else None,
               "newest_leads": [{k: x[k] for k in ("id", "a", "b", "score", "why")} for x in new[:10]]}
    if apply:
        state.mkdir(parents=True, exist_ok=True)
        with (state / "leads.jsonl").open("a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, sort_keys=True) + "\n")
        with (state / "series.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({k: summary[k] for k in ("system", "at", "nodes", "edges", "leads", "filed", "kept")}) + "\n")
        (state / f"{system}.json").write_text(json.dumps(summary, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        for x in to_file:
            p = out / "docs/issues" / f"{x['id']}.json"
            if p.exists():
                continue
            body = (f"**Owner:** product-manager\n**Trigger:** knowledge graph insight pass (KGRAPH-1)\n**Done check:** cmd:python3 -m foundation kgraph --settled {x['id']}\n"
                    f"**Status:** open\n\n`{x['a']}` ({x['la'][:80]}) and `{x['b']}` ({x['lb'][:80]}) {x['why']} (score {x['score']}).\n\n"
                    f"Read both. If one should build on, replace or reuse the other, make the change and reference one from the other. If they only look alike, "
                    f"add {x['id']} to ops/kgraph/declined.json with a one-line reason.\n\nPrediction: kg_leads_kept_share >= 0.2 within 336 h\n\nsize: S\n\n"
                    f"**Closing probe:** cmd:python3 -m foundation kgraph --settled {x['id']}\n")
            p.write_text(json.dumps({"id": x["id"], "title": f"{x['id']}: connect {x['la'][:50]} and {x['lb'][:50]}", "body": body,
                                     "labels": ["p2", "agent-ready", "kgraph", "plus"], "milestone": "Now", "workstream": "Product"}, indent=2) + "\n", encoding="utf-8")
    return summary


def settled(lid: str, root=REPO) -> bool:
    for x in reversed(_jsonl(Path(root) / "ops/kgraph/leads.jsonl")):
        if x.get("id") == lid:
            if x.get("ev") == "settled":
                return True
            g = build(Path(root), load(root))
            declined = set(json.loads((Path(root) / "ops/kgraph/declined.json").read_text(encoding="utf-8"))) if (Path(root) / "ops/kgraph/declined.json").is_file() else set()
            return linked(g, x["a"], x["b"]) or lid in declined
    return False


def probe(root=REPO, max_age_h=36) -> list[str]:
    """Freshness and growth: the core graph was rebuilt inside max_age_h and did not shrink by half against its previous run."""
    s = [x for x in _jsonl(Path(root) / "ops/kgraph/series.jsonl") if x.get("system") == "core"]
    if not s:
        return ["kgraph: the core graph has never been built (ops/kgraph/series.jsonl)"]
    bad, age = [], (NOW() - dt.datetime.fromisoformat(s[-1]["at"].replace("Z", "+00:00"))).total_seconds() / 3600
    if age > max_age_h:
        bad.append(f"kgraph: core graph is {age:.0f} h old (limit {max_age_h})")
    if len(s) > 1 and s[-1]["nodes"] < 0.5 * s[-2]["nodes"]:
        bad.append(f"kgraph: core graph shrank from {s[-2]['nodes']} to {s[-1]['nodes']} nodes")
    return bad


def check(root=REPO) -> list[str]:
    pol, bad = load(root), []
    for k in ("sources", "insight", "tenants"):
        if k not in pol:
            bad.append(f"{POLICY}: missing {k}")
    for f in ("seed/worker/src/graph.js", "seed/worker/migrations/0031_graph.sql", "seed/worker/test/graph.test.js"):
        if not (Path(root) / f).is_file():
            bad.append(f"kgraph: {f} missing: every seeded system must carry the graph")
    idx = Path(root) / "seed/worker/src/index.js"
    if idx.is_file() and "graphStep(" not in idx.read_text(encoding="utf-8"):
        bad.append("kgraph: the tick Worker does not run graphStep")
    return bad


def main(av: list[str]) -> int:
    get = lambda f, d=None: av[av.index(f) + 1] if f in av and av.index(f) + 1 < len(av) else d
    if "--check" in av:
        bad = check()
        print("\n".join(bad) or "kgraph: ok")
        return 1 if bad else 0
    if "--probe" in av:
        bad = probe()
        print("\n".join(bad) or "kgraph: fresh")
        return 1 if bad else 0
    if "--settled" in av:
        ok = settled(get("--settled"))
        print("settled" if ok else "open")
        return 0 if ok else 1
    if "--run" in av:
        s = run(root=get("--root", REPO), system=get("--tenant", "core"), out=get("--out", REPO), apply="--apply" in av)
        print(json.dumps({k: v for k, v in s.items() if k != "newest_leads"}, sort_keys=True))
        return 0
    print("usage: python3 -m foundation kgraph --run [--apply] [--tenant ID --root DIR --out DIR] | --settled ID | --probe | --check", file=sys.stderr)
    return 2
