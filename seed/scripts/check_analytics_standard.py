#!/usr/bin/env python3
"""Analytics standard gate (ANALYTICS-1). The rule "every system measures itself" lives here as code, not prose.

Fails (exit 1) when:
  1. a Worker (any wrangler.toml / wrangler.jsonc / wrangler.template.jsonc) neither imports analytics/analytics.js
     nor appears in scripts/analytics-exempt.json with a reason of at least 20 characters;
  2. a Worker that imports it has no D1 binding named DB (the collector writes there);
  3. a REGISTRY metric in seed/analytics/analytics.js has no trigger (min/max) and no exemption, or no kind.
Seeds copy this script; a bootstrapped org inherits the gate on day one.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP = ("node_modules", ".git", ".claude", "kit", "_bundles")
EXEMPT_FILE = Path(__file__).resolve().parent / "analytics-exempt.json"


def workers():
    for pat in ("wrangler.toml", "wrangler.jsonc", "wrangler.template.jsonc"):
        for p in ROOT.rglob(pat):
            if not any(s in p.relative_to(ROOT).parts for s in SKIP):
                yield p


def main_of(cfg: Path) -> Path | None:
    t = cfg.read_text(encoding="utf-8")
    m = re.search(r'^\s*main\s*=\s*"([^"]+)"', t, re.M) or re.search(r'"main"\s*:\s*"([^"]+)"', t)
    return (cfg.parent / m.group(1)) if m else None


def check_registry(js: Path) -> list[str]:
    errs = []
    body = js.read_text(encoding="utf-8")
    m = re.search(r"export const REGISTRY = \[(.*?)\n\];", body, re.S)
    if not m:
        return [f"{js}: REGISTRY not found"]
    for line in m.group(1).splitlines():
        n = re.search(r'name: "([^"]+)"', line)
        if not n:
            continue
        name = n.group(1)
        if not re.search(r'kind: "(target|guard)"', line):
            errs.append(f"metric {name}: missing kind")
        if not (re.search(r"\b(min|max): ", line) or re.search(r'exemption: "[^"]{10,}"', line)):
            errs.append(f"metric {name}: no trigger and no named exemption")
    return errs


def main() -> int:
    exempt = json.loads(EXEMPT_FILE.read_text(encoding="utf-8")) if EXEMPT_FILE.exists() else {}
    errs = []
    for cfg in workers():
        rel = str(cfg.relative_to(ROOT)).replace("\\", "/")
        if rel in exempt:
            if len(str(exempt[rel])) < 20:
                errs.append(f"{rel}: exemption needs a reason of 20+ characters")
            continue
        text = cfg.read_text(encoding="utf-8")
        main_js = main_of(cfg)
        src = main_js.read_text(encoding="utf-8") if main_js and main_js.exists() else ""
        if "analytics/analytics.js" not in src:
            if "template" in rel:  # seed template: its main (src/index.js) is checked through the template's sibling
                src = (cfg.parent / "src/index.js").read_text(encoding="utf-8") if (cfg.parent / "src/index.js").exists() else ""
            if "analytics/analytics.js" not in src:
                errs.append(f"{rel}: Worker does not use analytics/analytics.js (add it or list it in scripts/analytics-exempt.json with a reason)")
                continue
        if not re.search(r'binding\s*=\s*"DB"|"binding"\s*:\s*"DB"', text):
            errs.append(f"{rel}: analytics needs a D1 binding named DB")
    reg = ROOT / "seed/analytics/analytics.js"
    errs += check_registry(reg if reg.exists() else ROOT / "analytics/analytics.js")
    for e in errs:
        print("FAIL", e)
    print("analytics standard:", "FAIL" if errs else "ok", f"({len(list(workers()))} worker config(s) checked)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
