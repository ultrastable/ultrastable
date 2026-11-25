# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Open standards on the platform (OPEN-STANDARDS-1, Rowan 2026-11-25). Shim over seed/scripts/openstd.py, the one engine every
system carries.

  python3 -m foundation openstd --check         every catalogued file valid against its JSON Schema 2020-12, every doctrine and
                                                instance manifest catalogued, catalog-info.yaml current, CloudEvents and PROV
                                                adapters conform (in `checks`)
  python3 -m foundation openstd --apply         write a schema for every uncatalogued doctrine file (inferred, then tightened by
                                                hand) and regenerate catalog-info.yaml from doctrine/topology.json
  python3 -m foundation openstd --infer FILE    print an inferred schema for one data file
  python3 -m foundation openstd --report        coverage and the Conventional Commits share of recent history
  python3 -m foundation openstd --probe ID      exit 0 when standard ID is `supported` in seed/standards/standards.json (the closing
                                                probe of every Q-STD-* item: an item closes only when the register, with its how
                                                paths and named tests, proves the standard)

Ultrastable is the foundation for any autonomous system."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_p = REPO / "seed/scripts/openstd.py"
_s = importlib.util.spec_from_file_location("seed_openstd", _p)
core = importlib.util.module_from_spec(_s)
_s.loader.exec_module(core)

CATALOG = "schemas/catalog.json"
SEED_CATALOG = "seed/schemas/catalog.json"
CATALOG_INFO = "catalog-info.yaml"
# Every file matching these globs must be matched by a catalog entry: a new data file arrives with its schema.
MUST_COVER = ["doctrine/*.json", "instances/*/instance.json"]
SEED_MUST_COVER = ["seed/ultrastable.json", "seed/autonomy/*.json", "seed/standards/*.json"]
INFER_DEPTH = 4


def _covered_by(cat: dict, rel: str) -> bool:
    return bool(core.match(cat, rel))


def uncovered(root=REPO) -> list[str]:
    root = Path(root)
    out = []
    for cat_rel, globs, prefix in ((CATALOG, MUST_COVER, ""), (SEED_CATALOG, SEED_MUST_COVER, "seed/")):
        cat = core.load_catalog(root, cat_rel)
        for g in globs:
            for f in sorted(root.glob(g)):
                rel = f.relative_to(root).as_posix()
                local = rel[len(prefix):] if prefix and rel.startswith(prefix) else rel
                if f.name.startswith("_") or f.name.endswith(".schema.json"):
                    continue
                if not _covered_by(cat, local):
                    out.append(rel)
    return out


def components(root=REPO) -> list[dict]:
    """Backstage Components from the declared topology (doctrine/topology.json workers) plus every tenant repository
    (doctrine/tenant-repos.json) that has no worker of its own here."""
    root = Path(root)
    topo = json.loads((root / "doctrine/topology.json").read_text(encoding="utf-8"))
    comps = []
    for w in topo.get("workers", []):
        name = w.get("id") or w.get("name")
        src = w.get("source") or {}
        routes = [r for r in (w.get("routes") or []) if isinstance(r, str) and "*" not in r]
        comps.append({"name": name, "type": "website" if routes else "service",
                      "lifecycle": "production" if w.get("state", "live") == "live" else "experimental",
                      "description": (w.get("role") or w.get("what") or "")[:200],
                      "url": ("https://" + routes[0]) if routes else "",
                      "source": (src.get("repo") if isinstance(src, dict) else src) or "ultrastable/ultrastable"})
    tr = json.loads((root / "doctrine/tenant-repos.json").read_text(encoding="utf-8")).get("tenants", {})
    repos = {c["source"] for c in comps}
    for slug, t in sorted(tr.items()):
        if not isinstance(t, dict) or t.get("repo") in repos or t.get("state") == "retired":
            continue
        comps.append({"name": f"tenant-{slug}", "type": "website",
                      "lifecycle": "production" if t.get("state") in ("own-repo", "moved") else "experimental",
                      "description": (t.get("why") or slug)[:200], "url": t.get("frontend") or "", "source": t.get("repo") or ""})
    return comps


def render_catalog_info(root=REPO) -> str:
    return core.catalog_info("ultrastable", "group:ultrastable", components(root),
                             "Ultrastable is the foundation for any autonomous system.")


def _prov_sample(root: Path) -> list[str]:
    """The provenance ledger exports as PROV-JSON and CloudEvents without loss of its required fields."""
    p = root / "ops/provenance.jsonl"
    if not p.exists():
        return []
    rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()[-50:] if l.strip()]
    bad = []
    doc = core.prov_document(rows)
    if rows and len(doc.get("activity", {})) != len({r["id"] for r in rows}):
        bad.append("ops/provenance.jsonl: PROV export lost activities")
    from . import provenance
    for r in rows:
        bad += [f"provenance {r.get('id')}: CloudEvent {e}" for e in core.cloudevent_errors(provenance.to_cloudevent(r))]
    return bad[:10]


def check(root=REPO) -> list[str]:
    root = Path(root)
    bad = []
    for cat in (CATALOG, SEED_CATALOG):
        errs, _ = core.validate_catalog(root, cat)
        bad += errs
    for rel in uncovered(root):
        bad.append(f"{rel}: no JSON Schema in {CATALOG if not rel.startswith('seed/') else SEED_CATALOG}; run `python3 -m foundation openstd --apply` and tighten the schema")
    ci = root / CATALOG_INFO
    if not ci.exists() or ci.read_text(encoding="utf-8") != render_catalog_info(root):
        bad.append(f"{CATALOG_INFO}: out of date with doctrine/topology.json; run `python3 -m foundation openstd --apply`")
    bad += _prov_sample(root)
    return bad


def apply(root=REPO) -> list[str]:
    root = Path(root)
    done = []
    for rel in uncovered(root):
        seed = rel.startswith("seed/")
        cat_rel = SEED_CATALOG if seed else CATALOG
        cat = core.load_catalog(root, cat_rel)
        local = rel[len("seed/"):] if seed else rel
        stem = Path(rel).stem if not rel.startswith("instances/") else "instance"
        url = f"{stem}.schema.json"
        sp = (root / cat_rel).parent / url
        data = core.load_data(root / rel)
        if not sp.exists():
            base = "https://ultrastable.io/schemas/" + ("seed/" if seed else "")
            schema = core.infer_schema(data, base + url, Path(rel).name)
            body = core.infer([data], max_depth=INFER_DEPTH)
            schema.update(body)
            sp.write_text(json.dumps(schema, indent=1, sort_keys=False) + "\n", encoding="utf-8")
        cat["schemas"].append({"name": Path(rel).name, "description": f"JSON Schema for {rel}", "fileMatch": [local], "url": url})
        cat["schemas"].sort(key=lambda s: s["name"])
        (root / cat_rel).write_text(json.dumps(cat, indent=1) + "\n", encoding="utf-8")
        done.append(rel)
    text = render_catalog_info(root)
    ci = root / CATALOG_INFO
    if not ci.exists() or ci.read_text(encoding="utf-8") != text:
        ci.write_text(text, encoding="utf-8")
        done.append(CATALOG_INFO)
    return done


def report(root=REPO) -> dict:
    root = Path(root)
    _, cov = core.validate_catalog(root, CATALOG)
    _, scov = core.validate_catalog(root, SEED_CATALOG)
    subjects = subprocess.run(["git", "log", "-300", "--format=%s"], cwd=root, capture_output=True, text=True).stdout.splitlines()
    return {"files_with_schema": len(cov) + len(scov), "uncovered": uncovered(root), "conventional_commit_share_300": core.conventional_share(subjects)}


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--infer" in argv:
        f = Path(argv[argv.index("--infer") + 1])
        print(json.dumps(core.infer_schema(core.load_data(f), f"https://ultrastable.io/schemas/{f.stem}.schema.json", f.name), indent=1))
        return 0
    if "--probe" in argv:
        sid = argv[argv.index("--probe") + 1]
        reg = json.loads((REPO / "seed/standards/standards.json").read_text(encoding="utf-8"))
        e = next((x for x in reg["entries"] if x["id"] == sid), None)
        ok = bool(e) and e["support"] == "supported" and not __import__("foundation.standards", fromlist=["check"]).check()
        print(f"{sid}: {e['support'] if e else 'not in the register'}")
        return 0 if ok else 1
    if "--apply" in argv:
        done = apply()
        print("\n".join(done) or "openstd: nothing to apply")
    if "--report" in argv:
        print(json.dumps(report(), indent=1))
        return 0
    bad = check()
    print("\n".join(bad) or "openstd ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
