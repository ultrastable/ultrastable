"""CODE-AGENTS-1: the code agents that edit this codebase, as an adapter registry with cost routing and a disjoint-family ensemble (owner directive 2026-11-12).
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation agents --list      adapters, availability on this host, price
  python3 -m foundation agents --check     registry shape, every adapter has an invoking test
  python3 -m foundation agents --probe     invoke every available adapter live with a tiny prompt and print the result (no secret is printed)
The model rules come from the QNFO fleet's review gate (platform/cloudflare-reference/scripts/review_gate.py): few, small, disjoint, never the author's family.
Transport is injected (default: urllib) so every adapter is invoked in tests with a recorded request and response. Data: doctrine/code-agents.json.
"""
from __future__ import annotations
import json, os, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/code-agents.json"
RISKY = re.compile(r"(auth|route|cache|migration|workflow|\.github/|token|secret)", re.I)


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def available(a: dict, env=None) -> bool:
    env = os.environ if env is None else env
    return a["route"] != "session" and all(env.get(s) for s in a["secrets"])


def _cost(a: dict) -> float:
    p = a.get("usd_per_m_in")
    return (p + (a.get("usd_per_m_out") or 0)) if p is not None else 1e6


def route_authors(env=None, root=REPO) -> list[dict]:
    """Authors usable on this host, cheapest known price first, unknown prices after (stable order)."""
    ads = [a for a in load(root)["adapters"] if "author" in a["roles"] and available(a, env)]
    return sorted(ads, key=_cost)


def needs_ensemble(paths) -> bool:
    return any(RISKY.search(p) for p in paths)


def ensemble(author_family: str, env=None, root=REPO) -> list[dict]:
    """Reviewers of disjoint families, never the author's family, at most the configured maximum, cheapest first."""
    cfg, seen, out = load(root)["routing"]["ensemble"], set(), []
    for a in sorted((a for a in load(root)["adapters"] if "reviewer" in a["roles"] and available(a, env)), key=_cost):
        if a["family"] == author_family or a["family"] in seen:
            continue
        seen.add(a["family"]); out.append(a)
        if len(out) >= cfg["max_models"]:
            break
    return out


def build_request(a: dict, prompt: str, env=None) -> tuple[str, dict, dict]:
    env = os.environ if env is None else env
    if a["route"] == "workers-ai":
        url = f"https://api.cloudflare.com/client/v4/accounts/{env['CLOUDFLARE_ACCOUNT_ID']}/ai/run/{a['model']}"
        body = {"messages": [{"role": "user", "content": prompt}], "max_tokens": 7000, **a.get("extra", {})}
        return url, {"authorization": "Bearer " + env["CLOUDFLARE_API_TOKEN"], "content-type": "application/json"}, body
    if a["route"] == "anthropic":
        return "https://api.anthropic.com/v1/messages", {"x-api-key": env["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"}, \
            {"model": a["model"], "max_tokens": 16000, "messages": [{"role": "user", "content": prompt}]}
    raise ValueError("route " + a["route"] + " is not invoked over HTTP")


def parse_text(a: dict, resp: dict) -> str:
    if a["route"] == "workers-ai":
        r = resp["result"]
        return r.get("response") or (r.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    return resp["content"][0]["text"]


def http(url, headers, body, timeout=300) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def invoke(a: dict, prompt: str, env=None, transport=http) -> str:
    url, headers, body = build_request(a, prompt, env)
    return parse_text(a, transport(url, headers, body))


def parse_json(text: str) -> dict:
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def complete(prompt: str, env=None, transport=http, root=REPO) -> tuple[dict, str]:
    """The executor's model call: authors in routed order; a failure moves to the next (same failure twice mutates the route). Returns (json, adapter id)."""
    errs = []
    for a in route_authors(env, root):
        try:
            return parse_json(invoke(a, prompt, env, transport)), a["id"]
        except Exception as e:  # recorded, then the next adapter
            errs.append(f"{a['id']}: {type(e).__name__}: {str(e)[:120]}")
    raise RuntimeError("no code agent produced a change: " + " | ".join(errs) if errs else "no code agent adapter is available on this host")


def review(diff: str, author_family: str, env=None, transport=http, root=REPO) -> list[dict]:
    brief = "You are a hostile independent code reviewer. Report only defects a caller can trigger, each with a concrete trigger. Diff:\n" + diff[:14000]
    return [{"adapter": a["id"], "family": a["family"], "text": invoke(a, brief, env, transport)} for a in ensemble(author_family, env, root)]


def check(root=REPO) -> list[str]:
    root, d, bad, tests = Path(root), load(root), [], ""
    tf = root / "tests/foundation/test_agents.py"
    tests = tf.read_text(encoding="utf-8") if tf.is_file() else ""
    for a in d["adapters"]:
        for k in ("id", "route", "model", "family", "roles", "secrets"):
            if k not in a:
                bad.append(f"{a.get('id', '?')}: missing {k}")
        if a.get("id") and f'"{a["id"]}"' not in tests:
            bad.append(f"{a['id']}: no test invokes it")
    if len({a["family"] for a in d["adapters"] if "reviewer" in a["roles"]}) < d["routing"]["ensemble"]["min_models"]:
        bad.append("fewer reviewer families than the ensemble minimum")
    return bad


def probe(env=None, transport=http) -> list[dict]:
    out = []
    for a in load()["adapters"]:
        if not available(a, env):
            out.append({"adapter": a["id"], "ok": False, "detail": "not available on this host (" + (",".join(a["secrets"]) or "session route") + ")"}); continue
        try:
            u, h, b = build_request(a, "Reply with the single word: pong", env)
            t = parse_text(a, transport(u, h, b, 60))
            out.append({"adapter": a["id"], "ok": bool(t.strip()), "detail": t.strip()[:40]})
        except Exception as e:
            out.append({"adapter": a["id"], "ok": False, "detail": f"{type(e).__name__}: {str(e)[:100]}"})
    return out


def main(argv) -> int:
    if "--list" in argv:
        for a in load()["adapters"]:
            print(a["id"], a["route"], a["family"], "available" if available(a) else "unavailable", a.get("usd_per_m_in"))
        return 0
    if "--probe" in argv:
        res = probe(); print(json.dumps(res, indent=1)); return 0 if any(r["ok"] for r in res) else 1
    bad = check()
    print("agents ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
