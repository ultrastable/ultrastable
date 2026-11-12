"""SYS-2: the code-agent ladder. One place that decides which model writes a change, when to escalate, who reviews it, and what it cost.

  python3 -m foundation agent_ladder [--check|--cost]

Rungs are the `ladder` entries of the adapters in doctrine/code-agents.json (the one declaration of the code agents), cheapest first. Attempt N of a change uses rung N (a failed check or an unusable reply escalates). Once checks pass, a
different model from the author reviews the change and can veto it; a veto is a failed attempt with the reviewer's reasons fed back. Every call appends a row to
ops/agent-cost.jsonl (model, tokens, estimated cost), which the transparency snapshot publishes. Routes: `workers-ai` (the account's own models, no key beyond the
Cloudflare token), `anthropic` (used only when ANTHROPIC_API_KEY is bound), `router` (an OpenAI-compatible gateway such as qnfo-router, when ROUTER_URL and
ROUTER_KEY are bound). A rung whose route has no credential is skipped, so the ladder works on whatever the host holds.
"""
from __future__ import annotations
import json, os, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH, COST = "doctrine/code-agents.json", "ops/agent-cost.jsonl"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    d = json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))  # an instance without its own registry uses the platform default
    rungs = [{"id": a["ladder"]["id"], "route": a["route"], "model": a["model"], **{k: v for k, v in a["ladder"].items() if k not in ("id", "order")}, "_order": a["ladder"]["order"]}
             for a in d["adapters"] if a.get("ladder")]
    return {"rungs": [{k: v for k, v in r.items() if k != "_order"} for r in sorted(rungs, key=lambda r: r["_order"])]}


def available(rung: dict, env=None) -> bool:
    env = os.environ if env is None else env
    r = rung["route"]
    if r == "workers-ai":
        return bool(env.get("CLOUDFLARE_API_TOKEN") and env.get("CLOUDFLARE_ACCOUNT_ID"))
    if r == "anthropic":
        return bool(env.get("ANTHROPIC_API_KEY"))
    if r == "router":
        return bool(env.get("ROUTER_URL") and env.get("ROUTER_KEY"))
    return False


def rungs(root=REPO, env=None) -> list[dict]:
    return [r for r in load(root)["rungs"] if available(r, env)]


def _post(url, headers, body, timeout=300):
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def transport(rung: dict, prompt: str, env=None) -> tuple[str, dict]:
    """One model call. Returns the reply text and a usage dict {in, out}. Raises on HTTP failure."""
    env, mt = os.environ if env is None else env, rung.get("max_tokens", 7000)
    if rung["route"] == "workers-ai":
        d = _post(f"https://api.cloudflare.com/client/v4/accounts/{env['CLOUDFLARE_ACCOUNT_ID']}/ai/run/{rung['model']}", {"authorization": "Bearer " + env["CLOUDFLARE_API_TOKEN"]},
                  {"messages": [{"role": "user", "content": prompt}], "max_tokens": mt})
        res = d.get("result") or {}
        u = res.get("usage") or {}
        return res.get("response") or "", {"in": u.get("prompt_tokens"), "out": u.get("completion_tokens")}
    if rung["route"] == "anthropic":
        d = _post("https://api.anthropic.com/v1/messages", {"x-api-key": env["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
                  {"model": rung["model"], "max_tokens": mt, "messages": [{"role": "user", "content": prompt}]})
        u = d.get("usage") or {}
        return d["content"][0]["text"], {"in": u.get("input_tokens"), "out": u.get("output_tokens")}
    d = _post(env["ROUTER_URL"].rstrip("/") + "/v1/chat/completions", {"authorization": "Bearer " + env["ROUTER_KEY"]},
              {"model": rung["model"], "max_tokens": mt, "messages": [{"role": "user", "content": prompt}]})
    u = d.get("usage") or {}
    return d["choices"][0]["message"]["content"], {"in": u.get("prompt_tokens"), "out": u.get("completion_tokens")}


def parse_json(text: str) -> dict:
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def cost_usd(rung: dict, usage: dict, prompt: str, text: str) -> float:
    tin = usage.get("in") or max(1, len(prompt) // 4)
    tout = usage.get("out") or max(1, len(text) // 4)
    return round((tin * rung.get("usd_per_mtok_in", 0) + tout * rung.get("usd_per_mtok_out", 0)) / 1e6, 6)


def log_cost(root, row: dict) -> None:
    p = Path(root) / COST
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **row}, separators=(",", ":")) + "\n")


def call(prompt: str, attempt: int = 0, role: str = "author", root=REPO, env=None, send=transport, avoid_model: str | None = None) -> tuple[dict, dict]:
    """The reply as JSON plus {rung, model, route, usd}. `attempt` picks the rung (clamped to the top); `avoid_model` picks the next rung with a different model
    (used by the reviewer). Raises ValueError on an unusable reply and RuntimeError when no rung is available; both are logged to the cost file."""
    rs = rungs(root, env)
    if not rs:
        raise RuntimeError("no model route is available on this host (bind CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or ANTHROPIC_API_KEY, or ROUTER_URL and ROUTER_KEY)")
    i = min(attempt, len(rs) - 1)
    if avoid_model:
        cands = [k for k, r in enumerate(rs) if r["model"] != avoid_model]
        i = min(cands, key=lambda k: abs(k - i)) if cands else i
    rung = rs[i]
    text, usage = "", {}
    try:
        text, usage = send(rung, prompt, env)
        out = parse_json(text)
    except ValueError:
        log_cost(root, {"role": role, "rung": rung["id"], "model": rung["model"], "ok": False, "why": "unusable reply", "usd": cost_usd(rung, usage, prompt, text)})
        raise
    meta = {"rung": rung["id"], "model": rung["model"], "route": rung["route"], "usd": cost_usd(rung, usage, prompt, text)}
    log_cost(root, {"role": role, "ok": True, **meta})
    return out, meta


def review_prompt(issue: dict, out: dict) -> str:
    files = "\n\n".join(f"FILE {f['path']}:\n{f['content'][:4000]}" for f in out.get("files", [])[:6])
    return ("You are an independent reviewer of a proposed change to a repository. Reject it only for a concrete defect: it does not do what the issue asks, it breaks an existing "
            "behaviour, it runs on a person's computer or listens on a port, it leaks a secret, or its tests do not test the change. Reply with ONLY JSON: "
            '{"approve":true|false,"reasons":["short concrete reason"]}.\n\n'
            f"ISSUE: {issue.get('title','')}\n{(issue.get('body') or '')[:3000]}\n\nSUMMARY: {out.get('summary','')}\n\n{files}")


def review(issue: dict, out: dict, author_model: str, root=REPO, env=None, send=transport) -> dict:
    """A different model reviews the change. A reviewer that cannot answer approves (recorded), so a flaky reviewer never blocks the loop."""
    try:
        r, meta = call(review_prompt(issue, out), attempt=1, role="reviewer", root=root, env=env, send=send, avoid_model=author_model)
    except (ValueError, RuntimeError, OSError, KeyError) as e:
        return {"approve": True, "reasons": [], "skipped": type(e).__name__ + ": " + str(e)[:120]}
    return {"approve": bool(r.get("approve", True)), "reasons": [str(x)[:300] for x in (r.get("reasons") or [])][:5], "model": meta["model"]}


def summary(root=REPO) -> dict:
    p, rows = Path(root) / COST, []
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    by: dict[str, dict] = {}
    for r in rows:
        m = by.setdefault(r.get("model", "?"), {"calls": 0, "failed": 0, "usd": 0.0})
        m["calls"] += 1; m["failed"] += 0 if r.get("ok") else 1; m["usd"] = round(m["usd"] + (r.get("usd") or 0), 6)
    return {"calls": len(rows), "usd": round(sum(m["usd"] for m in by.values()), 6), "by_model": by}


def check(root=REPO) -> list[str]:
    bad, d = [], load(root)
    if not d.get("rungs"):
        return [f"{PATH}: no rungs"]
    for r in d["rungs"]:
        for k in ("id", "route", "model"):
            if not r.get(k):
                bad.append(f"{PATH}: rung without {k}: {r}")
        if r.get("route") not in ("workers-ai", "anthropic", "router"):
            bad.append(f"{PATH}: unknown route {r.get('route')}")
    if len({r["model"] for r in d["rungs"]}) < 2:
        bad.append(f"{PATH}: the reviewer needs at least two different models")
    return bad


def main(argv) -> int:
    if "--cost" in argv:
        print(json.dumps(summary(), indent=1))
        return 0
    bad = check()
    print("\n".join(bad) if bad else "agent_ladder ok: " + ", ".join(f"{r['id']}({r['route']})" for r in load()["rungs"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
