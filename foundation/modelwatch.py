# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MODEL-WATCH-1: a hosted model id is an external input that expires. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation modelwatch --check              fails when source names a model the catalog measured as retired
  python3 -m foundation modelwatch --status             every referenced id: available, retired, refused or unmeasured
  python3 -m foundation modelwatch --refresh [--apply]  run each referenced id once on Workers AI (CLOUDFLARE_API_TOKEN and
                                                        CLOUDFLARE_ACCOUNT_ID), record 410 as retired with a successor and 403 as
                                                        refused; --apply also rewrites retired ids in source to their successor
Data: doctrine/models.json. Without credentials --refresh measures nothing and says so (exit 0): unmeasured is never read as healthy.
Consumers: foundation/openloops.py (--check), doctrine/rules.json rule no-open-items (runtime probe and fix), tests/foundation/test_modelwatch.py."""
from __future__ import annotations
import fnmatch, json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = "doctrine/models.json"
ID = re.compile(r"@cf/[a-z0-9_.-]+/[a-z0-9_.-]*[a-z0-9]", re.I)
PLACEHOLDER = ("@cf/example/", "@cf/openai/gpt")  # test fixtures and a prefix used in prose


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DATA).read_text(encoding="utf-8"))


def files(root, d):
    root, seen = Path(root), set()
    for g in d["scan_globs"]:
        for p in root.glob(g):
            rel = p.relative_to(root).as_posix()
            if p.is_file() and rel not in seen and "node_modules" not in rel and not any(fnmatch.fnmatch(rel, x) for x in d["exclude"]):
                seen.add(rel)
                yield rel, p


def references(root=REPO, d=None) -> dict:
    """model id -> sorted list of files naming it"""
    d, out = d or load(root), {}
    for rel, p in files(root, d):
        for m in set(ID.findall(p.read_text(encoding="utf-8", errors="replace"))):
            if m in PLACEHOLDER or m.startswith(PLACEHOLDER[0]):
                continue
            out.setdefault(m, []).append(rel)
    return {k: sorted(v) for k, v in sorted(out.items())}


def classify(model, d) -> str:
    return "retired" if model in d["retired"] else "refused" if model in d["refused"] else "available" if model in d["available"] else "unmeasured"


def check(root=REPO) -> list[str]:
    d, bad = load(root), []
    for m, s in d["retired"].items():
        if s.get("successor") not in d["available"]:
            bad.append(f"{DATA}: successor of {m} is not an available model")
    for m, where in references(root, d).items():
        c = classify(m, d)
        if c == "retired":
            bad.append(f"{m} is retired ({d['retired'][m]['evidence']}) and still named in {', '.join(where)}; successor {d['retired'][m]['successor']} (fix: modelwatch --refresh --apply)")
        elif c == "refused":
            bad.append(f"{m} is refused on the free plan and still named in {', '.join(where)}")
    return bad


def run_once(model, env=None, opener=urllib.request.urlopen):
    """(status code, detail) for one tiny run; 0 when the request could not be made"""
    env = os.environ if env is None else env
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{env['CLOUDFLARE_ACCOUNT_ID']}/ai/run/{model}", method="POST",
                                 data=json.dumps({"messages": [{"role": "user", "content": "Reply with the single word: ok"}], "max_tokens": 64}).encode(),
                                 headers={"Authorization": "Bearer " + env["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"})
    try:
        with opener(req, timeout=60) as r:
            return r.status, "ok"
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:200]
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        return 0, f"{type(e).__name__}: {e}"


def successor(model, d) -> str:
    vendor = model.split("/")[1]
    same = [a for a in d["available"] if a.split("/")[1] == vendor]
    return (same or [f for f in d["fallback_order"] if f in d["available"]] or d["available"])[0]


def refresh(root=REPO, apply=False, env=None, run=run_once, now=None) -> dict:
    env = os.environ if env is None else env
    d = load(root)
    if not (env.get("CLOUDFLARE_API_TOKEN") and env.get("CLOUDFLARE_ACCOUNT_ID")):
        return {"measured": 0, "unmeasured": "no Workers AI credential on this host", "changed": []}
    changed, measured = [], 0
    for m in sorted(set(references(root, d)) | set(d["available"])):
        code, detail = run(m, env)
        if code == 0:
            continue
        measured += 1
        was = classify(m, d)
        if code == 200 and was != "available":
            d["available"] = sorted(set(d["available"]) | {m}); d["retired"].pop(m, None); d["refused"].pop(m, None); changed.append([m, "available"])
        elif code == 410 and was != "retired":
            d["available"] = [a for a in d["available"] if a != m]
            d["retired"][m] = {"evidence": f"HTTP 410 {detail[:80]}", "successor": ""}; changed.append([m, "retired"])
        elif code == 403 and was != "refused":
            d["available"] = [a for a in d["available"] if a != m]
            d["refused"][m] = f"HTTP 403 {detail[:80]}"; changed.append([m, "refused"])
    for m, s in d["retired"].items():
        if s.get("successor") not in d["available"] and d["available"]:
            s["successor"] = successor(m, d)
    rewritten = []
    if apply:
        if changed:
            d["measured_at"] = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
            (Path(root) / DATA).write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        rewritten = rewrite(root, d)
    return {"measured": measured, "changed": changed, "rewritten": rewritten}


def rewrite(root, d) -> list[str]:
    out = []
    for rel, p in files(root, d):
        t = p.read_text(encoding="utf-8", errors="replace")
        n = t
        for m, s in d["retired"].items():
            if s.get("successor"):
                n = re.sub(re.escape(m) + r"(?![a-z0-9_.-]*[a-z0-9])", s["successor"], n)
        if n != t:
            p.write_text(n, encoding="utf-8"); out.append(rel)
    return out


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--refresh" in argv:
        print(json.dumps(refresh(apply="--apply" in argv)))
        return 0
    if "--status" in argv:
        d = load()
        for m, where in references(REPO, d).items():
            print(f"{classify(m, d):10} {m}  ({len(where)} file(s))")
        return 0
    bad = check()
    print("\n".join(bad) or "modelwatch ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
