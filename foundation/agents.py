"""CODE-AGENTS-1: the code agents that edit this codebase, as an adapter registry with cost routing and a disjoint-family ensemble (owner directive 2026-11-12).
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation agents --list      adapters, availability on this host, price
  python3 -m foundation agents --check     registry shape, every adapter has an invoking test
  python3 -m foundation agents --probe     invoke every available adapter live with a tiny prompt and print the result (no secret is printed)
The model rules come from the QNFO fleet's review gate (platform/cloudflare-reference/scripts/review_gate.py): few, small, disjoint, never the author's family.
Transport is injected (default: urllib) so every adapter is invoked in tests with a recorded request and response. Data: doctrine/code-agents.json.
"""
from __future__ import annotations
import json, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/code-agents.json"
RISKY = re.compile(r"(auth|route|cache|migration|workflow|\.github/|token|secret)", re.I)


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))  # a root without its own registry (a temp copy, a new org) uses the platform default


UA = "ultrastable-executor/1"  # MODELS-UA-1: Cloudflare and GitHub edges answer the default Python-urllib agent with a refusal or a stub ("OK", text/plain)
SITE = "https://ultrastable-site.ultrastable.workers.dev"


def oidc_route(env) -> bool:
    """AI-OIDC-1: Workers AI with no Cloudflare credential in GitHub. The repo secrets name the retired account (SINGLE-ACCOUNT-2, cfaccount strips them),
    so every workers-ai rung was unavailable and the executor had only GitHub Models, which answered 200 "OK" for days. A run with id-token: write sends
    the call to the site Worker's /__internal/cf route (site/deployer.js, allow-list `ai/run/@cf/...`), which adds the credential only it holds."""
    return bool(env.get("ACTIONS_ID_TOKEN_REQUEST_URL") and env.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN"))


def available(a: dict, env=None) -> bool:
    env = os.environ if env is None else env
    if a.get("retired"):  # ROUTE-RETIRED-1: a provider that shut down is never asked, whatever it still answers
        return False
    if a["route"] == "workers-ai" and not all(env.get(s) for s in a["secrets"]):
        return oidc_route(env)
    return a["route"] != "session" and all(env.get(s) for s in a["secrets"])


def _oidc_token(env, opener=None) -> str:
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(env["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=ultrastable-deploy", headers={"authorization": "Bearer " + env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"], "user-agent": UA})
    with opener(req, timeout=20) as r:
        return json.loads(r.read())["value"]


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


def fit(a: dict, prompt: str) -> str:
    """FREE-LLM-1: a rung with a request cap gets the head (instructions, issue) and the tail (repair feedback) of the prompt, never an over-limit request."""
    cap = a.get("max_prompt_chars")
    if not cap or len(prompt) <= cap:
        return prompt
    head = cap * 2 // 3
    return prompt[:head] + "\n[... trimmed to fit this model's request limit ...]\n" + prompt[-(cap - head - 60):]


def build_request(a: dict, prompt: str, env=None) -> tuple[str, dict, dict]:
    env = os.environ if env is None else env
    prompt = fit(a, prompt)
    if a["route"] == "workers-ai":
        body = {"messages": [{"role": "user", "content": prompt}], "max_tokens": 7000, **a.get("extra", {})}
        if not (env.get("CLOUDFLARE_API_TOKEN") and env.get("CLOUDFLARE_ACCOUNT_ID")):  # AI-OIDC-1
            return (env.get("TARGET_SITE") or SITE).rstrip("/") + "/__internal/cf", {"authorization": "Bearer " + _oidc_token(env), "x-cf-method": "POST",
                    "x-cf-path": "ai/run/" + a["model"], "content-type": "application/json"}, body
        url = f"https://api.cloudflare.com/client/v4/accounts/{env['CLOUDFLARE_ACCOUNT_ID']}/ai/run/{a['model']}"
        return url, {"authorization": "Bearer " + env["CLOUDFLARE_API_TOKEN"], "content-type": "application/json"}, body
    if a["route"] == "anthropic":
        return "https://api.anthropic.com/v1/messages", {"x-api-key": env["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json"}, \
            {"model": a["model"], "max_tokens": 16000, "messages": [{"role": "user", "content": prompt}]}
    if a["route"] == "github-models":  # FREE-LLM-1: OpenAI-compatible chat endpoint, authenticated by the Actions token itself
        return "https://models.github.ai/inference/chat/completions", {"authorization": "Bearer " + env["GITHUB_TOKEN"], "content-type": "application/json", "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"}, \
            {"model": a["model"], "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]}
    raise ValueError("route " + a["route"] + " is not invoked over HTTP")


def parse_text(a: dict, resp: dict) -> str:
    if a["route"] == "workers-ai":
        r = resp["result"]
        return r.get("response") or (r.get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if a["route"] == "github-models":
        return resp["choices"][0]["message"]["content"]
    return resp["content"][0]["text"]


def http(url, headers, body, timeout=300) -> dict:
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode(), headers={"user-agent": UA, **headers})  # MODELS-UA-1
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if not raw.strip():  # seen live from the free tier: HTTP 200 with an empty body; say so instead of a bare JSONDecodeError
            raise RuntimeError(f"empty response body (HTTP {r.status}) from {url}")
        try:
            return json.loads(raw)
        except ValueError:  # a provider answering 200 with text or HTML (rate-limit page, gateway notice): say what came back, not a bare JSONDecodeError
            raise RuntimeError(f"non-JSON response (HTTP {r.status}, {r.headers.get('content-type')}) from {url}: {raw[:200].decode('utf-8', 'replace')}") from None


GH_MODELS_ORG = "https://models.github.ai/orgs/{org}/inference/chat/completions"


def request(a: dict, prompt: str, env=None, transport=None) -> dict:
    """The provider's JSON reply for one call, with every second route this adapter has. Both invoke() and the executor's ladder
    (foundation/agent_ladder.py transport) go through here; MODELS-ORG-1 was first written only in invoke(), which the executor never calls."""
    transport = transport or http  # looked up at call time, so a test (or a host) that replaces agents.http is honoured
    url, headers, body = build_request(a, prompt, env)
    try:
        return transport(url, headers, body)
    except RuntimeError as e:
        # MODELS-ORG-1 (2026-11-25): the user endpoint answered HTTP 200 "OK" text/plain to the Actions token for days, so every code agent failed.
        # The org-attributed endpoint is the second route on the same token; a different failure there is raised as usual.
        if a["route"] != "github-models" or "non-JSON" not in str(e) and "empty response" not in str(e):
            raise
        env = os.environ if env is None else env
        org = (env.get("GITHUB_REPOSITORY_OWNER") or "ultrastable")
        return transport(GH_MODELS_ORG.format(org=org), headers, body)


def invoke(a: dict, prompt: str, env=None, transport=None) -> str:
    return parse_text(a, request(a, prompt, env, transport))


BLOCK_FORMAT = ("SUMMARY: one line\n"
                "<<<EDIT relative/path>>>\n<<<FIND>>>\na few lines copied exactly from the existing file\n<<<REPLACE>>>\nthe lines that replace them\n<<<END>>>\n"
                "<<<FILE relative/path>>>\nfull content of a NEW file, written plainly with no escaping\n<<<END>>>\n"
                "(EDIT blocks for a file that exists, one per place changed, each FIND unique in the file; a FILE block only for a new file; nothing else in the reply)")
_BLOCK = re.compile(r"<<<FILE ([^>\n]+)>>>\r?\n(.*?)\r?\n?<<<END>>>", re.S)
_EDIT = re.compile(r"<<<EDIT ([^>\n]+)>>>\r?\n<<<FIND>>>\r?\n(.*?)\r?\n?<<<REPLACE>>>\r?\n?(.*?)\r?\n?<<<END>>>", re.S)


def parse_json(text: str) -> dict:
    """The reply as {summary, files}. JSON first. REPLY-BLOCKS-1: whole files inside JSON strings need every quote, backslash and newline escaped, and
    small models break that (3 of the first 11 executor failures were JSONDecodeError), so a reply in BLOCK_FORMAT is accepted too: no escaping to get wrong.
    PATCH-EDIT-1: an EDIT block changes part of an existing file ({path, edits: [{find, replace}]}), so a small model never has to reproduce a file it
    cannot hold (every roadmap attempt on 2026-11-20 rewrote site/worker.js from about 1,150 lines to under 60 and was refused)."""
    s, e = text.find("{"), text.rfind("}")
    try:
        out = json.loads(text[s:e + 1])
    except ValueError:
        out = None
    if isinstance(out, dict) and ("files" in out or not (_BLOCK.search(text) or _EDIT.search(text))):
        return out
    files, by_path = [{"path": p.strip(), "content": c + "\n"} for p, c in _BLOCK.findall(text)], {}
    for p, find, rep in _EDIT.findall(text):
        p = p.strip()
        if p not in by_path:
            by_path[p] = {"path": p, "edits": []}
            files.append(by_path[p])
        by_path[p]["edits"].append({"find": find, "replace": rep})
    if not files:
        raise ValueError("reply is neither JSON nor FILE or EDIT blocks")
    m = re.search(r"^SUMMARY:\s*(.+)$", text, re.M)
    return {"summary": m.group(1).strip() if m else "", "files": files}


def _loose_span(text: str, find: str):
    """Where `find` sits in `text` when its lines match ignoring leading and trailing whitespace: (start, end, indent the file has and the reply lacks),
    or None when there is no match or more than one."""
    want = [l.strip() for l in find.strip("\n").splitlines()]
    lines = text.splitlines(keepends=True)
    if not want or not any(want):
        return None
    hits = [i for i in range(len(lines) - len(want) + 1) if all(lines[i + k].strip() == want[k] for k in range(len(want)))]
    if len(hits) != 1:
        return None
    i = hits[0]
    start = sum(len(l) for l in lines[:i])
    end = start + sum(len(l) for l in lines[i:i + len(want)])
    first_file, first_find = lines[i], find.strip("\n").splitlines()[0]
    lead = lambda l: l[:len(l) - len(l.lstrip())]
    pad = lead(first_file)[len(lead(first_find)):] if lead(first_file).startswith(lead(first_find)) else ""
    return start, end, pad


def apply_edit(text: str, find: str, replace: str, path: str = "file") -> str:
    """PATCH-EDIT-1: `text` with the one place `find` names replaced. Exact match first; then a match that ignores indentation and trailing spaces
    (small models drop both), re-indenting the replacement by what the reply lacked. Raises ValueError, worded for the model, when the place is
    missing or ambiguous: a patch is never applied to a guessed location."""
    if not find.strip():
        if text.strip():
            raise ValueError(f"{path}: FIND is empty but the file exists; copy the lines to change into FIND")
        return replace if replace.endswith("\n") else replace + "\n"
    n = text.count(find)
    if n == 1:
        return text.replace(find, replace)
    if n > 1:
        raise ValueError(f"{path}: the FIND text occurs {n} times; add neighbouring lines so it is unique")
    span = _loose_span(text, find)
    if not span:
        raise ValueError(f"{path}: the FIND text is not in the file (or matches more than one place); copy the lines exactly as the file shows them")
    start, end, pad = span
    body = "".join((pad + l if l.strip() else l) for l in replace.strip("\n").splitlines(keepends=True))
    return text[:start] + body + ("\n" if body and not body.endswith("\n") else "") + text[end:]


def heal(a: dict, root=REPO) -> dict | None:
    """MODEL-HEAL-1 (YEAR-SIM-1 finding model-retirement): when Workers AI answers 410 for an adapter's model, the same rung runs the successor
    doctrine/models.json names (same vendor first, then fallback_order), and the retirement is appended to ops/models-observed.jsonl so
    `modelwatch --observed --apply` rewrites source without a Workers AI credential. None when the catalog has no other available model."""
    from . import modelwatch
    try:
        d = modelwatch.load(root)
    except (OSError, ValueError):
        return None
    left = [m for m in d.get("available", []) if m != a["model"]]
    if not left:
        return None
    succ = (d.get("retired", {}).get(a["model"], {}) or {}).get("successor") or modelwatch.successor(a["model"], {**d, "available": left})
    if not succ or succ == a["model"]:
        return None
    try:
        p = Path(root) / "ops/models-observed.jsonl"
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "model": a["model"], "status": 410, "successor": succ, "adapter": a["id"]}) + "\n")
    except OSError as e:
        print(f"MODEL-HEAL-1: could not record the retirement of {a['model']}: {e}", file=sys.stderr)
    return {**a, "model": succ, "id": a["id"] + "@" + succ.rsplit("/", 1)[-1]}


def complete(prompt: str, env=None, transport=http, root=REPO) -> tuple[dict, str]:
    """The executor's model call: authors in routed order; a failure moves to the next (same failure twice mutates the route). Returns (json, adapter id)."""
    errs = []
    for a in route_authors(env, root):
        try:
            return parse_json(invoke(a, prompt, env, transport)), a["id"]
        except urllib.error.HTTPError as e:
            if e.code == 410 and a["route"] == "workers-ai":  # MODEL-HEAL-1: a retired model keeps its rung; the call moves to the catalog's successor
                alt = heal(a, root)
                if alt:
                    try:
                        return parse_json(invoke(alt, prompt, env, transport)), alt["id"]
                    except Exception as e2:  # recorded, then the next adapter
                        errs.append(f"{alt['id']}: {type(e2).__name__}: {str(e2)[:120]}")
                        continue
            errs.append(f"{a['id']}: {type(e).__name__}: {str(e)[:120]}")
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
