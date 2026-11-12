#!/usr/bin/env python3
"""Writes the org description and every repo's description, homepage and topics in github/org-settings.json from brand/brand.json.

Usage: python3 brand/tools/sync_settings.py [--check]   (--check exits 1 when the file differs; run by foundation/brandcheck.py)
GitHub applies the file through scripts/apply_github_settings.sh (org-settings workflow, ORG_ADMIN_TOKEN).
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]


def desired():
    cfg = json.loads((ROOT / "brand/brand.json").read_text())
    pos = json.loads((ROOT / "doctrine/positioning.json").read_text())
    cur = json.loads((ROOT / "github/org-settings.json").read_text())
    cur["org"]["description"] = pos["tagline"] + " Runs on itself."
    cur["org"]["blog"], cur["org"]["email"] = cfg["site"], cfg["contact"]
    base = next(iter(cur["repos"].values()))
    # Repos flagged "archived" in brand.json stay rendered but are not applied (GitHub rejects writes to archived repos); repos in the
    # settings file that brand.json does not name (workers, spec, license) are kept as written.
    repos = {k: v for k, v in cur["repos"].items() if k.split("/")[1] not in {r["name"] for r in cfg["repos"]}}
    for r in cfg["repos"]:
        if r.get("archived"):
            continue
        key = f"{cfg['org']}/{r['name']}"
        old = cur["repos"].get(key, base)
        repos[key] = {**old, "description": f"{r['line']} {pos['tagline']}"[:350], "homepage": cfg["site"], "topics": r["topics"]}
    cur["repos"] = repos
    return cur


def main():
    p = ROOT / "github/org-settings.json"
    text = json.dumps(desired(), indent=2, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        sys.exit(0 if p.read_text() == text else 1)
    p.write_text(text)
    print("wrote", p.relative_to(ROOT))


if __name__ == "__main__":
    main()
