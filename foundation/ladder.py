"""Credential acquisition ladder. Ultrastable is the foundation for any autonomous system: it gets its own credentials.

Every route is tried in order and every outcome is recorded, including denials. A route that answers "denied" is a
refusal: it is recorded and the NEXT route is tried; the same action is never re-tried through a different path to get
past the same check. At most ONE owner card opens, and only when every route failed. No secret value is read, only
whether a binding exists.
"""
from __future__ import annotations
import json, os, shutil, subprocess
from dataclasses import dataclass, field
from pathlib import Path

DATA = Path(__file__).parent / "data" / "credential-routes.json"


@dataclass
class Ctx:
    """Everything a probe may touch. Tests pass fakes; production uses the real environment."""
    env: dict = field(default_factory=lambda: dict(os.environ))
    which: object = shutil.which
    run: object = None          # callable(argv) -> (returncode, text)
    exists: object = lambda p: Path(p).expanduser().exists()

    def __post_init__(self):
        if self.run is None:
            self.run = self._run

    @staticmethod
    def _run(argv):
        try:
            r = subprocess.run(argv, capture_output=True, text=True, timeout=20)
            return r.returncode, r.stdout + r.stderr
        except (OSError, subprocess.SubprocessError) as e:
            return 127, f"{type(e).__name__}: {e}"


def probe(route: dict, ctx: Ctx) -> tuple[bool, str]:
    k = route["kind"]
    if k == "env":
        have = [v for v in route["vars"] if ctx.env.get(v)]
        return bool(have), ("binding set: " + have[0]) if have else "no binding set: " + "/".join(route["vars"])
    if k == "env_all":
        miss = [v for v in route["vars"] if not ctx.env.get(v)]
        return not miss, "all bindings set" if not miss else "missing: " + ", ".join(miss)
    if k == "file":
        ok = ctx.exists(route["path"])
        return ok, f"{route['path']} {'present' if ok else 'absent'}"
    if k == "cli_scope":  # a logged-in CLI whose status text names the required scope
        if not ctx.which(route["tool"]):
            return False, f"{route['tool']} not installed"
        rc, out = ctx.run(route["argv"])
        if rc != 0:
            return False, f"{route['tool']} not logged in (exit {rc})"
        return route["scope"] in out, f"scope {route['scope']} " + ("present" if route["scope"] in out else "absent")
    if k == "cli_ok":
        if not ctx.which(route["argv"][0]):
            return False, f"{route['argv'][0]} not installed"
        rc, _ = ctx.run(route["argv"])
        return rc == 0, f"exit {rc}"
    return False, f"unknown route kind {k}"


def load_routes(path=None) -> dict:
    return json.loads(Path(path or DATA).read_text(encoding="utf-8"))


def acquire(credential: str, ctx: Ctx | None = None, table: dict | None = None) -> dict:
    ctx, table = ctx or Ctx(), table or load_routes()
    spec = table["credentials"][credential]
    attempts = []
    for r in spec["routes"]:
        ok, detail = probe(r, ctx)
        attempts.append({"route": r["id"], "ok": ok, "detail": detail})
        if ok:
            return {"credential": credential, "status": "acquired", "via": r["id"], "attempts": attempts, "card": None}
    c = spec["card"]
    return {"credential": credential, "status": "carded", "via": None, "attempts": attempts,
            "card": {"id": c["id"], "line": "IDENTITY-BOUND: " + c["what"], "why": c["why"],
                     "default_in_effect": c["default"], "closing_probe": c["probe"],
                     "routes_exhausted": [a["route"] for a in attempts]}}


def acquire_all(ctx=None, table=None) -> dict:
    table = table or load_routes()
    res = [acquire(c, ctx, table) for c in table["credentials"]]
    cards = [r["card"] for r in res if r["card"]]
    return {"results": res, "cards": cards}
