"""The glossary as code. `doctrine/glossary.json` is the source of truth for the owner's keywords; GLOSSARY.md and the owner-dashboard panel
are generated from it, and a term's changes of meaning are kept as lineage.

  python3 -m foundation glossary --check              fail on a term with no definition, test or implementing path, a dead path or probe, stale lineage or a stale GLOSSARY.md
  python3 -m foundation glossary --apply              regenerate GLOSSARY.md
  python3 -m foundation glossary --show [TERM_ID]     print the terms (the console reminder)
Term changes go through `python3 -m foundation writeback term`, which bumps the version and appends the lineage entry.
"""
from __future__ import annotations
import datetime as dt, json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/glossary.json"
MD = "GLOSSARY.md"
REQUIRED = ("id", "term", "version", "definition", "not", "tested_by", "implemented_by", "lineage")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _ver(v: str):
    return tuple(int(x) for x in v.split("."))


def check(root=REPO) -> list[str]:
    from . import selfhost, doctrine
    root, bad = Path(root), []
    g = load(root)
    ids = [t["id"] for t in g["terms"]]
    for dup in {i for i in ids if ids.count(i) > 1}:
        bad.append(f"term id {dup} is defined twice")
    for t in g["terms"]:
        tid = t.get("id", "?")
        for f in REQUIRED:
            if not t.get(f):
                bad.append(f"{tid}: lacks {f}")
        if not t.get("tested_by") or not t.get("implemented_by"):
            continue
        for rel in t["implemented_by"]:
            if not (root / rel).exists():
                bad.append(f"{tid}: implemented_by path {rel} does not exist")
        for spec in t["tested_by"]:
            try:
                ok = selfhost.probe(root, spec)
            except ValueError as e:
                bad.append(f"{tid}: {e}"); continue
            if not ok:
                bad.append(f"{tid}: test probe fails ({spec})")
        vs = [l["version"] for l in t["lineage"]]
        if vs != sorted(vs, key=_ver) or len(set(vs)) != len(vs):
            bad.append(f"{tid}: lineage versions are not strictly increasing")
        if vs and vs[-1] != t["version"]:
            bad.append(f"{tid}: version {t['version']} is not the last lineage entry ({vs[-1]})")
        for l in t["lineage"]:
            for f in ("version", "date", "change", "source"):
                if not l.get(f):
                    bad.append(f"{tid}: lineage entry lacks {f}")
        for r in t.get("related", []):
            if r not in ids:
                bad.append(f"{tid}: related term {r} is not defined")
    try:
        tag = doctrine.load(root)["autonomy"]["tagline"].rstrip(".")
        auto = next((t for t in g["terms"] if t["id"] == "autonomy"), None)
        if auto is None or tag.lower() not in auto["definition"].lower():
            bad.append("autonomy: definition does not carry the positioning autonomy tagline")
    except KeyError:
        bad.append("doctrine/positioning.json has no autonomy block")
    p = root / MD
    if not p.exists() or p.read_text(encoding="utf-8") != render_md(g):
        bad.append(f"{MD} is stale: run python3 -m foundation glossary --apply")
    return bad


def render_md(g: dict) -> str:
    out = ["# Glossary", "",
           "Generated from `doctrine/glossary.json` by `python3 -m foundation glossary --apply`; do not edit by hand. Each term has a definition, how it is tested, the code that implements it and its lineage (every change of meaning).", "",
           "**A system is autonomous if it has self-referential loops and the ability to close them.**", "",
           "| Term | In one line | Version |", "|---|---|---|"]
    for t in g["terms"]:
        out.append(f"| [{t['term']}](#{t['id']}) | {t['definition'].split('. ')[0].rstrip('.')}. | {t['version']} |")
    for t in g["terms"]:
        out += ["", f"## <a id=\"{t['id']}\"></a>{t['term']}", "", t["definition"], "", f"**Not:** {t['not']}", ""]
        if t.get("aliases"):
            out += [f"**Also called:** {', '.join(t['aliases'])}", ""]
        out += ["**Tested by:** " + "; ".join(f"`{x}`" for x in t["tested_by"]), "", "**Implemented by:** " + ", ".join(f"`{x}`" for x in t["implemented_by"]), ""]
        if t.get("related"):
            out += ["**Related:** " + ", ".join(f"[{r}](#{r})" for r in t["related"]), ""]
        out += ["**Lineage:**", ""] + [f"- {l['version']} ({l['date']}): {l['change']} (`{l['source']}`)" for l in t["lineage"]]
    return "\n".join(out) + "\n"


def apply(root=REPO) -> list[str]:
    root = Path(root)
    new = render_md(load(root))
    p = root / MD
    if p.exists() and p.read_text(encoding="utf-8") == new:
        return []
    p.write_text(new, encoding="utf-8")
    return [MD]


def panel(root=REPO) -> dict:
    """The dashboard panel: one row per term, so the owner is reminded of every keyword."""
    g = load(root)
    rows = [[t["term"] + " v" + t["version"], t["definition"].split(". ")[0].rstrip(".") + ".", "info"] for t in g["terms"]]
    return {"id": "glossary", "title": "Terms (doctrine/glossary.json, term lineage in GLOSSARY.md)", "rows": rows}


def term_change(root, term_id: str, definition: str, why: str, source: str, today: str | None = None, bump="major") -> dict:
    """A term's meaning changes: bump the version, append the lineage entry, regenerate GLOSSARY.md. All in the working tree, to be committed."""
    root = Path(root)
    g = load(root)
    t = next((x for x in g["terms"] if x["id"] == term_id), None)
    if t is None:
        raise ValueError(f"unknown term {term_id!r}")
    if not definition.strip() or not why.strip():
        raise ValueError("a term change needs the new definition and why it changed")
    ma, mi, pa = _ver(t["version"])
    t["version"] = f"{ma + 1}.0.0" if bump == "major" else f"{ma}.{mi + 1}.0"
    t["definition"] = definition.strip()
    t["lineage"].append({"version": t["version"], "date": today or dt.date.today().isoformat(), "change": why.strip(), "source": source})
    (root / PATH).write_text(json.dumps(g, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    apply(root)
    return t


def show(root=REPO, term_id: str | None = None) -> str:
    g = load(root)
    ts = [t for t in g["terms"] if not term_id or t["id"] == term_id]
    return "\n\n".join(f"{t['term']} (v{t['version']}): {t['definition']}\n  Not: {t['not']}" for t in ts) or f"no term {term_id}"
