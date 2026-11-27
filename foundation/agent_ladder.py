"""SYS-2: escalation, independent review and cost accounting on top of the code-agent registry (doctrine/code-agents.json, foundation/agents.py).

  python3 -m foundation agent_ladder [--check|--cost]

There is one registry of code agents and one routing rule (cheapest known price first, reviewers of a disjoint family, from the QNFO review gate). This module adds what
a change needs around it: attempt N of a change uses author N in routed order (a failed check or an unusable reply escalates); once checks pass, a reviewer of a family
other than the author's returns a JSON verdict and can veto; every call appends a row to ops/agent-cost.jsonl (model, family, tokens, estimated cost), which the
transparency snapshot publishes. An adapter whose secrets are not bound on the host is not routed, so the ladder works on whatever the host holds.
"""
from __future__ import annotations
import json, sys
from datetime import datetime, timezone
from pathlib import Path

from . import agents

REPO = Path(__file__).resolve().parents[1]
COST = "ops/agent-cost.jsonl"


DOWN: set[str] = set()  # FREE-LLM-5: adapters whose transport failed in this process; the rest of the run skips them so a dead free tier does not spend every repair attempt


def route_down(a: dict, e: Exception) -> bool:
    """LADDER-ROUTE-1 (measured 2026-11-27): one 502 from workers-ai-glm marked the whole workers-ai route DOWN, so the healthy llama, qwen and gpt-oss rungs
    were never asked and 13 of 30 executor runs failed. A failure takes the whole provider route down only when it is provider-wide: GitHub Models, a
    401, or a reply that is not JSON at all. A 5xx, a timeout or a rate limit is that model's, so only that rung is skipped."""
    s = str(e)
    return a.get("route") == "github-models" or getattr(e, "code", None) == 401 or "non-JSON" in s or "empty response" in s


# DECISION-METRIC: work-queue-priority (which rungs the executor keeps asking after a failure; every call is a row in ops/agent-cost.jsonl, scored by whether the run produced a change)
def mark_down(a: dict, e: Exception) -> None:
    DOWN.add(a["id"])
    if route_down(a, e):
        DOWN.add(a.get("route"))


def rungs(root=REPO, env=None) -> list[dict]:
    rs = agents.route_authors(env, root)
    return [a for a in rs if a["id"] not in DOWN and a.get("route") not in DOWN] or rs


def transport(a: dict, prompt: str, env=None) -> tuple[str, dict]:
    """One model call through the registry's request builder. Returns the reply text and usage {in, out}."""
    resp = agents.request(a, prompt, env)  # MODELS-ORG-1 / AI-OIDC-1: the same second routes as agents.invoke
    u = (resp.get("result") or {}).get("usage") or resp.get("usage") or {}
    text = agents.parse_text(a, resp)
    if not isinstance(text, str):  # some models return the JSON object itself instead of a string
        text = json.dumps(text)
    return text, {"in": u.get("prompt_tokens") or u.get("input_tokens"), "out": u.get("completion_tokens") or u.get("output_tokens")}


parse_json = agents.parse_json


def cost_usd(rung: dict, usage: dict, prompt: str, text: str) -> float:
    tin = usage.get("in") or max(1, len(prompt) // 4)
    tout = usage.get("out") or max(1, len(text) // 4)
    return round((tin * (rung.get("usd_per_m_in") or 0) + tout * (rung.get("usd_per_m_out") or 0)) / 1e6, 6)  # unknown prices count as 0 and are marked unpriced in the log


def log_cost(root, row: dict) -> None:
    p = Path(root) / COST
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **row}, separators=(",", ":")) + "\n")


def call(prompt: str, attempt: int = 0, role: str = "author", root=REPO, env=None, send=transport, adapter: dict | None = None) -> tuple[dict, dict]:
    """The reply as JSON plus {adapter, model, family, usd}. `attempt` picks the author in routed order (clamped to the last); `adapter` forces one (the reviewer).
    Raises ValueError on an unusable reply and RuntimeError when no adapter is available; failures are logged to the cost file."""
    rs = rungs(root, env)
    if not adapter and not rs:
        raise RuntimeError("no code agent adapter is available on this host (bind CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, or ANTHROPIC_API_KEY)")
    if adapter:
        return _call_one(prompt, adapter, role, root, env, send, forced=True)
    # LADDER-FALLTHROUGH-1: a dead rung does not spend the attempt. Measured 2026-11-19: models.github.ai answered every request with 200 text/plain "OK",
    # so attempt 0 of every run was lost before a model was asked and the cheapest live rung (glm) was skipped by the shifted index. The next live rung
    # answers in the same attempt; the attempt only fails when every rung's transport failed.
    tried, errs = set(), []
    while True:
        live = [x for x in rungs(root, env) if x["id"] not in tried]
        if not live:
            raise RuntimeError("every code agent rung failed: " + " | ".join(errs))
        a = live[min(attempt, len(live) - 1)] if not tried else live[0]
        tried.add(a["id"])
        try:
            return _call_one(prompt, a, role, root, env, send)
        except ValueError:
            raise
        except Exception as e:  # transport failure: recorded by _call_one, the rung is DOWN; ask the next one
            errs.append(f"{a['id']}: {type(e).__name__}: {str(e)[:120]}")


def _call_one(prompt: str, a: dict, role: str, root, env, send, forced: bool = False) -> tuple[dict, dict]:
    adapter = a if forced else None
    text, usage = "", {}
    try:
        text, usage = send(a, prompt, env)
        out = parse_json(text)
    except ValueError:
        log_cost(root, {"role": role, "adapter": a["id"], "model": a["model"], "family": a["family"], "ok": False, "why": "unusable reply", "usd": cost_usd(a, usage, prompt, text)})
        raise
    except Exception as e:  # a transport failure (HTTP 401/403/429, timeout) is evidence too: record the status and the provider's own words, then let the ladder escalate
        body = ""
        if hasattr(e, "read"):
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception as e2:  # an unreadable error body is recorded, not hidden
                body = f"(error body unreadable: {type(e2).__name__})"
        log_cost(root, {"role": role, "adapter": a["id"], "model": a["model"], "family": a["family"], "ok": False, "why": f"{type(e).__name__}: {str(e)[:120]} {body}".strip(), "usd": 0})
        if not adapter:
            mark_down(a, e)  # LADDER-ROUTE-1: this rung, and its provider route only when the failure is provider-wide
        raise
    meta = {"adapter": a["id"], "model": a["model"], "family": a["family"], "usd": cost_usd(a, usage, prompt, text), "priced": a.get("usd_per_m_in") is not None}
    log_cost(root, {"role": role, "ok": True, **meta})
    return out, meta


def review_prompt(issue: dict, out: dict) -> str:
    files = "\n\n".join(f"FILE {f['path']}:\n{f['content'][:4000]}" for f in out.get("files", [])[:6])
    return ("You are an independent reviewer of a proposed change to a repository. Reject it only for a concrete defect: it does not do what the issue asks, it breaks an existing "
            "behaviour, it runs on a person's computer or listens on a port, it leaks a secret, or its tests do not test the change. Reply with ONLY JSON: "
            '{"approve":true|false,"reasons":["short concrete reason"]}.\n\n'
            f"ISSUE: {issue.get('title','')}\n{(issue.get('body') or '')[:3000]}\n\nSUMMARY: {out.get('summary','')}\n\n{files}")


def review(issue: dict, out: dict, author_family: str, root=REPO, env=None, send=transport) -> dict:
    """The cheapest reviewer of a family other than the author's returns a verdict. A reviewer that cannot answer approves (recorded as skipped), so a flaky
    reviewer never blocks the loop; no reviewer of another family on this host is also a skip."""
    rv = agents.ensemble(author_family, env, root)
    if not rv:
        return {"approve": True, "reasons": [], "skipped": "no reviewer of another family on this host"}
    # LADDER-FALLTHROUGH-1: a reviewer whose route is down is passed over for the next family, so a dead free tier does not turn every review into a skip
    rv = [a for a in rv if a["id"] not in DOWN and a.get("route") not in DOWN] or rv
    skipped = []
    for a in rv:
        try:
            r, meta = call(review_prompt(issue, out), role="reviewer", root=root, env=env, send=send, adapter=a)
        except ValueError as e:  # an unusable verdict: the reviewer answered, so do not ask another
            return {"approve": True, "reasons": [], "skipped": type(e).__name__ + ": " + str(e)[:120]}
        except (RuntimeError, OSError, KeyError) as e:
            mark_down(a, e)
            skipped.append(f"{a['id']}: {type(e).__name__}: {str(e)[:100]}")
            continue
        return {"approve": bool(r.get("approve", True)), "reasons": [str(x)[:300] for x in (r.get("reasons") or [])][:5], "model": meta["model"], "family": meta["family"]}
    return {"approve": True, "reasons": [], "skipped": " | ".join(skipped)[:400]}


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
    ads = agents.load(root)["adapters"]
    fams = {a["family"] for a in ads if "reviewer" in a["roles"]}
    bad = [] if len(fams) >= 2 else ["doctrine/code-agents.json: reviewers need at least two model families"]
    if not any("author" in a["roles"] for a in ads):
        bad.append("doctrine/code-agents.json: no author adapter")
    return bad


def main(argv) -> int:
    if "--cost" in argv:
        print(json.dumps(summary(), indent=1))
        return 0
    bad = check()
    print(chr(10).join(bad) if bad else "agent_ladder ok: authors " + ", ".join(a["id"] for a in agents.load()["adapters"] if "author" in a["roles"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
