"""Agent adapters. The platform manages agents; it is not one.

Adapter contract: do(item) -> Result, verify(item, result) -> (ok, evidence).
Built in:
  SimulatedAgent  deterministic, seedable; used for demos, tests and CI (never claims to be a real model)
  CommandAgent    runs any CLI agent (claude -p, codex exec, ...) in a work dir; verification by a check command
  AnthropicAgent  calls the Anthropic Messages API (set ANTHROPIC_API_KEY); text-only proposals
  GitHubConnector / GitHubPRAgent  items from issues; execution as a PR; squash-merge only on green checks (GITHUB_TOKEN)
  VertexGeminiAgent  calls Vertex AI generateContent (VERTEX_PROJECT, VERTEX_ACCESS_TOKEN); text-only proposals
"""
from __future__ import annotations
import hashlib, json, os, shlex, subprocess, urllib.error, urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional
from .config import DEFAULT_VERTEX_MODEL, DEFAULT_WORKERS_AI_MODEL


@dataclass
class Result:
    ok: bool
    evidence: str
    hidden_failure: bool = False          # doer believes it worked, but it did not (reviewer should catch)
    revert: Optional[Callable[[], None]] = None


def _h(*parts) -> float:
    d = hashlib.sha256("|".join(map(str, parts)).encode()).digest()
    return int.from_bytes(d[:8], "big") / 2**64


class SimulatedAgent:
    kind = "simulated"

    def __init__(self, name: str, seed: int = 7, fail_rate: float = 0.12, hidden_rate: float = 0.04,
                 catch_rate: float = 0.9):
        self.name, self.seed = name, seed
        self.fail_rate, self.hidden_rate, self.catch_rate = fail_rate, hidden_rate, catch_rate

    def do(self, item: dict) -> Result:
        r = _h(self.seed, self.name, item["id"], item.get("attempts", 0))
        if r < self.fail_rate:
            return Result(False, f"simulated failure: checks red for {item['id']}")
        if r < self.fail_rate + self.hidden_rate:
            return Result(True, f"simulated change for {item['id']} (looks green)", hidden_failure=True)
        return Result(True, f"simulated change for {item['id']}; done_check satisfied")

    def verify(self, item: dict, res: Result):
        if res.hidden_failure:
            if _h(self.seed, self.name, "catch", item["id"], item.get("attempts", 0)) < self.catch_rate:
                return False, "reviewer reproduced independently: the claimed result does not hold"
            return True, "reviewer pass (missed hidden failure)"
        return res.ok, "reviewer reproduced independently: " + ("pass" if res.ok else "fail")


class CommandAgent:
    """Run a CLI agent. `command` receives the item brief on stdin; `check` is the independent verifier."""
    kind = "command"

    def __init__(self, name: str, command: str, check: Optional[str] = None, cwd: str = ".", timeout: int = 1800):
        self.name, self.command, self.check, self.cwd, self.timeout = name, command, check, cwd, timeout

    def do(self, item: dict) -> Result:
        brief = f"{item['title']}\n\nDone when: {item['done_check']}\nProbe: {item.get('closing_probe') or ''}\n"
        try:
            p = subprocess.run(shlex.split(self.command), input=brief, capture_output=True, text=True,
                               cwd=self.cwd, timeout=self.timeout)
        except Exception as e:  # noqa: BLE001 - recorded as evidence, never swallowed
            return Result(False, f"command error: {e}")
        return Result(p.returncode == 0, (p.stdout or p.stderr)[-2000:])

    def verify(self, item: dict, res: Result):
        if not res.ok:
            return False, res.evidence
        if not self.check:
            return False, "no independent check configured; refusing to self-certify"
        p = subprocess.run(shlex.split(self.check), capture_output=True, text=True, cwd=self.cwd, timeout=self.timeout)
        return p.returncode == 0, (p.stdout or p.stderr)[-2000:]


class AnthropicAgent:
    kind = "anthropic"

    def __init__(self, name: str, model: str, api_key_env: str = "ANTHROPIC_API_KEY"):
        self.name, self.model, self.key_env = name, model, api_key_env

    def _call(self, prompt: str) -> str:
        key = os.environ.get(self.key_env)
        if not key:
            raise RuntimeError(f"{self.key_env} not set")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=json.dumps({"model": self.model, "max_tokens": 1024,
                             "messages": [{"role": "user", "content": prompt}]}).encode(),
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())["content"][0]["text"]

    def do(self, item: dict) -> Result:
        try:
            return Result(True, self._call(f"Produce a concise plan and change summary for: {item['title']}\nDone when: {item['done_check']}"))
        except Exception as e:  # noqa: BLE001
            return Result(False, f"anthropic error: {e}")

    def verify(self, item: dict, res: Result):
        try:
            out = self._call(f"Task: {item['title']}\nDone when: {item['done_check']}\nClaimed result:\n{res.evidence}\n"
                             "Reply PASS or FAIL then one line why.")
            return out.strip().upper().startswith("PASS"), out[:500]
        except Exception as e:  # noqa: BLE001
            return False, f"verifier error: {e}"


class WorkersAIAgent:
    """Edits files in `cwd` using a Cloudflare Workers AI model (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in env).
    The model returns full replacement files; originals are kept so a failed review can revert. Verified by a separate check command."""
    kind = "workers-ai"

    def __init__(self, name, files, cwd=".", check=None, model=DEFAULT_WORKERS_AI_MODEL, transport=None):
        self.name, self.files, self.cwd, self.check, self.model = name, files, cwd, check, model
        self.transport = transport or self._http

    def _http(self, prompt: str) -> str:
        tok, acct = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        if not (tok and acct):
            raise RuntimeError("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required")
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{self.model}",
            data=json.dumps({"messages": [{"role": "user", "content": prompt}], "max_tokens": 2000}).encode(),
            headers={"authorization": f"Bearer {tok}", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            resp = json.loads(r.read())["result"]["response"]
        return resp if isinstance(resp, str) else json.dumps(resp)  # Workers AI may return pre-parsed JSON

    def do(self, item: dict) -> Result:
        orig = {f: open(os.path.join(self.cwd, f), encoding="utf-8").read() for f in self.files}
        NL = chr(10)
        files = NL.join("--- " + f + " ---" + NL + c for f, c in orig.items())
        prompt = ("Task: " + item["title"] + NL + "Done when: " + item["done_check"] + NL + NL + "Files:" + NL + files +
                  NL + NL + "Reply with ONLY a JSON object mapping each file you change to its COMPLETE new content.")
        try:
            out = self.transport(prompt)
            a, b = out.index("{"), out.rindex("}") + 1
            changes = json.loads(out[a:b])
            for f, c in changes.items():
                if f not in orig:
                    raise ValueError(f"model tried to write unlisted file {f}")
        except Exception as e:  # noqa: BLE001
            return Result(False, f"model error: {e}")
        for f, c in changes.items():
            open(os.path.join(self.cwd, f), "w", encoding="utf-8").write(c)

        def revert():
            for f, c in orig.items():
                open(os.path.join(self.cwd, f), "w", encoding="utf-8").write(c)
        return Result(True, f"{self.model} rewrote {', '.join(changes)}", revert=revert)

    def verify(self, item, res):
        if not res.ok:
            return False, res.evidence
        if not self.check:
            return False, "no independent check configured; refusing to self-certify"
        p = subprocess.run(shlex.split(self.check), capture_output=True, text=True, cwd=self.cwd, timeout=600)
        return p.returncode == 0, (p.stdout + p.stderr)[-1500:]


class VertexGeminiAgent:
    """Vertex AI Gemini adapter (text proposals, like AnthropicAgent). `transport(prompt) -> str` is injectable for tests.
    Live use needs VERTEX_PROJECT and VERTEX_ACCESS_TOKEN (e.g. `gcloud auth print-access-token`); VERTEX_LOCATION defaults to us-central1."""
    kind = "vertex-gemini"

    def __init__(self, name: str, model: str = DEFAULT_VERTEX_MODEL, transport=None):
        self.name, self.model = name, model
        self.transport = transport or self._http

    def _http(self, prompt: str) -> str:
        proj, tok = os.environ.get("VERTEX_PROJECT"), os.environ.get("VERTEX_ACCESS_TOKEN")
        if not (proj and tok):
            raise RuntimeError("VERTEX_PROJECT and VERTEX_ACCESS_TOKEN required")
        loc = os.environ.get("VERTEX_LOCATION", "us-central1")
        host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
        url = f"https://{host}/v1/projects/{proj}/locations/{loc}/publishers/google/models/{self.model}:generateContent"
        req = urllib.request.Request(
            url, data=json.dumps({"contents": [{"role": "user", "parts": [{"text": prompt}]}]}).encode(),
            headers={"authorization": f"Bearer {tok}", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read())
        return "".join(p.get("text", "") for p in body["candidates"][0]["content"]["parts"])

    def do(self, item: dict) -> Result:
        try:
            return Result(True, self.transport(f"Produce a concise plan and change summary for: {item['title']}\nDone when: {item['done_check']}"))
        except Exception as e:  # noqa: BLE001
            return Result(False, f"vertex error: {e}")

    def verify(self, item: dict, res: Result):
        try:
            out = self.transport(f"Task: {item['title']}\nDone when: {item['done_check']}\nClaimed result:\n{res.evidence}\n"
                                 "Reply PASS or FAIL then one line why.")
            return out.strip().upper().startswith("PASS"), out[:500]
        except Exception as e:  # noqa: BLE001
            return False, f"verifier error: {e}"


class GitHubConnector:
    """GitHub REST connector. `transport(method, path, body|None) -> (status, json)` is injectable for tests.
    Live use needs GITHUB_TOKEN in env. Items come from open issues; execution is a PR; merge happens only on green checks."""

    def __init__(self, repo: str, transport=None, token_env: str = "GITHUB_TOKEN"):
        self.repo, self.token_env = repo, token_env
        self.transport = transport or self._http

    def _http(self, method: str, path: str, body=None):
        tok = os.environ.get(self.token_env)
        if not tok:
            raise RuntimeError(f"{self.token_env} not set")
        req = urllib.request.Request(
            "https://api.github.com" + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"authorization": f"Bearer {tok}", "accept": "application/vnd.github+json",
                     "x-github-api-version": "2022-11-28", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, {"message": e.read().decode(errors="replace")[:300]}

    def fetch_items(self, label: str = "agent-ready") -> list:
        st, issues = self.transport("GET", f"/repos/{self.repo}/issues?state=open&labels={label}&per_page=100", None)
        if st != 200:
            raise RuntimeError(f"github issues list failed: {st} {issues}")
        out = []
        for i in issues:
            names = {l["name"] for l in i.get("labels", [])}
            if "pull_request" in i or "hold" in names:
                continue
            body = i.get("body") or ""
            probe = next((ln.split(":", 1)[1].strip() for ln in body.splitlines()
                          if ln.lower().startswith("closing probe:")), "")
            out.append({"id": f"GH-{i['number']}", "title": i["title"],
                        "done_check": probe or "linked PR merged with green checks",
                        "closing_probe": probe})
        return out

    def open_pr(self, head: str, base: str, title: str, body: str) -> int:
        st, pr = self.transport("POST", f"/repos/{self.repo}/pulls",
                                {"head": head, "base": base, "title": title, "body": body, "draft": False})
        if st not in (200, 201):
            raise RuntimeError(f"open PR failed: {st} {pr.get('message')}")
        return pr["number"]

    def checks_green(self, pr: int):
        st, p = self.transport("GET", f"/repos/{self.repo}/pulls/{pr}", None)
        if st != 200:
            return False, f"cannot read PR #{pr}: {st}"
        if any(l["name"] == "hold" for l in p.get("labels", [])):
            return False, f"PR #{pr} is on hold"
        st, runs = self.transport("GET", f"/repos/{self.repo}/commits/{p['head']['sha']}/check-runs", None)
        rs = runs.get("check_runs", []) if st == 200 else []
        if not rs:
            return False, f"PR #{pr}: no check runs reported (not treated as green)"
        bad = [r["name"] for r in rs if r.get("status") != "completed" or r.get("conclusion") not in ("success", "neutral", "skipped")]
        return (not bad), (f"PR #{pr}: {len(rs)} checks green" if not bad else f"PR #{pr}: not green: {', '.join(bad)}")

    def merge_if_green(self, pr: int):
        ok, why = self.checks_green(pr)
        if not ok:
            return False, why
        st, m = self.transport("PUT", f"/repos/{self.repo}/pulls/{pr}/merge", {"merge_method": "squash"})
        return (st == 200 and bool(m.get("merged"))), (f"{why}; squash-merged" if st == 200 else f"merge refused: {st} {m.get('message')}")


class GitHubPRAgent:
    """Execution as a PR: do() opens a PR from the prepared `head` branch that references the issue (Refs, never closes);
    verify() merges only when every check run is green. Item ids are 'GH-<issue number>'."""
    kind = "github-pr"

    def __init__(self, name: str, repo: str, head: str, base: str = "main", connector: Optional[GitHubConnector] = None):
        self.name, self.head, self.base = name, head, base
        self.gh = connector or GitHubConnector(repo)
        self.prs: dict = {}

    def do(self, item: dict) -> Result:
        num = str(item["id"]).removeprefix("GH-")
        try:
            pr = self.gh.open_pr(self.head, self.base, item["title"], f"Refs #{num}\n\nDone when: {item['done_check']}")
        except Exception as e:  # noqa: BLE001
            return Result(False, f"github error: {e}")
        self.prs[item["id"]] = pr
        return Result(True, f"opened PR #{pr} for {item['id']}")

    def verify(self, item: dict, res: Result):
        pr = self.prs.get(item["id"])
        if not (res.ok and pr):
            return False, res.evidence
        try:
            return self.gh.merge_if_green(pr)
        except Exception as e:  # noqa: BLE001
            return False, f"github error: {e}"


def model_family(spec: dict) -> str:
    """Model family of an agent spec: gemini, claude, workers-ai:<vendor>, or the kind itself (simulated/command)."""
    k = spec.get("kind", "simulated")
    if k == "vertex-gemini":
        return "gemini"
    if k == "anthropic":
        return "claude"
    if k == "workers-ai":
        parts = (spec.get("model") or DEFAULT_WORKERS_AI_MODEL).lower().split("/")
        return "workers-ai:" + (parts[1] if len(parts) > 2 else parts[-1])
    return k


def check_pairing(doer: dict, reviewer: dict) -> None:
    """The reviewer must be a different model family than the doer, so shared blind spots are not shared verdicts.
    Simulated and command agents are exempt (no model family to differ)."""
    fd, fr = model_family(doer), model_family(reviewer)
    if fd == fr and fd not in ("simulated", "command"):
        raise ValueError(f"reviewer model family '{fr}' must differ from doer family '{fd}'")


def build_agent(spec: dict, name: str):
    k = spec.get("kind", "simulated")
    if k == "simulated":
        return SimulatedAgent(name, **{a: spec[a] for a in ("seed", "fail_rate", "hidden_rate", "catch_rate") if a in spec})
    if k == "command":
        return CommandAgent(name, spec["command"], spec.get("check"), spec.get("cwd", "."))
    if k == "anthropic":
        return AnthropicAgent(name, spec["model"])
    if k == "vertex-gemini":
        return VertexGeminiAgent(name, spec.get("model", DEFAULT_VERTEX_MODEL))
    if k == "github-pr":
        return GitHubPRAgent(name, spec["repo"], spec["head"], spec.get("base", "main"))
    if k == "workers-ai":
        return WorkersAIAgent(name, spec["files"], spec.get("cwd", "."), spec.get("check"), spec.get("model", DEFAULT_WORKERS_AI_MODEL))
    raise ValueError(f"unknown agent kind {k}")
