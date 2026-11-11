"""Plugin runtime: the one place every plugin action passes through.

A plugin never calls the network or writes outside its lane directly. It builds an Action and
hands it to `Runtime.perform`, which applies the scope file, the kill switch, the mode, the trust
rung, the egress allowlist, consent and suppression, the rate caps and the content guard, then
either records a dry-run or sends. Dry-run is the default and writes the same record a live run
would, so a dry-run is a faithful rehearsal.

Core code never imports this package (plugins/scopecheck.py enforces that).
"""
from __future__ import annotations
import fnmatch, json, os, re, time, urllib.parse, urllib.request
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCOPE = json.loads((HERE / "SCOPE.json").read_text())
RUNGS = SCOPE["rungs"]


@dataclass
class Action:
    plugin: str
    cls: str                      # an action class from SCOPE
    adapter: str
    target: str | None = None     # recipient or channel; consent and suppression key
    text: str | None = None       # content the guard inspects
    request: dict = field(default_factory=dict)   # method, url, headers, body; secrets as "${env:NAME}"
    steps: list = field(default_factory=list)     # optional chain; later steps may use ${step0.body.x} or ${step0.headers.location}
    purpose: str = ""             # "confirmation" lets a double-opt-in message reach an unconsented address


@dataclass
class Result:
    status: str                   # dry-run | sent | refused | error
    reason: str = ""
    detail: dict = field(default_factory=dict)

    @property
    def ok(self): return self.status in ("dry-run", "sent")


DEFAULT_GUARD = {"blocked_patterns": [r"-----BEGIN [A-Z ]*PRIVATE KEY", r"\bsk-[A-Za-z0-9_-]{16,}", r"\bgh[pousr]_[A-Za-z0-9]{20,}", r"guarantee[sd]?\b", r"act now", r"100% "]}


def default_config():
    return {"rung": "observed", "plugins": {}}


class Runtime:
    """config: {rung, plugins:{name:{enabled,mode,kill,adapter_config,limits}}}. state_dir holds
    ledger.jsonl (every attempt), suppression.json and consent.json. transport(req)->(status, body)."""

    def __init__(self, config=None, state_dir="plugin-state", env=None, transport=None, now=None, guard_sources=None):
        self.config = config or default_config()
        self.dir = Path(state_dir); self.dir.mkdir(parents=True, exist_ok=True)
        self.env = os.environ if env is None else env
        self.transport = transport or self._http
        self.now = now or time.time
        self.guard_sources = guard_sources or []

    # -- config and secrets -------------------------------------------------
    def pcfg(self, plugin):
        c = {"enabled": False, "mode": "dry-run", "kill": False, "adapter_config": {}, "limits": {}}
        c.update(self.config.get("plugins", {}).get(plugin, {}))
        return c

    def secret(self, name):
        """The only place a secret value is read. Never logged, never returned in a Result."""
        return self.env.get(name) or None

    def missing_credentials(self, plugin):
        ac = self.pcfg(plugin)["adapter_config"]
        return [v for k, v in ac.items() if k.endswith("_env") and k != "instance_env" and not self.secret(v)]

    # -- files --------------------------------------------------------------
    def _read(self, name, default):
        p = self.dir / name
        return json.loads(p.read_text()) if p.exists() else default

    def suppressed(self, target):
        return target.lower() in {x.lower() for x in self._read("suppression.json", [])}

    def consented(self, target):
        return target.lower() in {x.lower() for x in self._read("consent.json", [])}

    def suppress(self, target):
        s = self._read("suppression.json", [])
        if target.lower() not in {x.lower() for x in s}:
            s.append(target); (self.dir / "suppression.json").write_text(json.dumps(s, indent=1))

    def grant_consent(self, target):
        s = self._read("consent.json", [])
        if target.lower() not in {x.lower() for x in s}:
            s.append(target); (self.dir / "consent.json").write_text(json.dumps(s, indent=1))

    def _log(self, a, r):
        rec = {"at": int(self.now()), "plugin": a.plugin, "class": a.cls, "adapter": a.adapter, "target": a.target,
               "status": r.status, "reason": r.reason, "text": (a.text or "")[:280]}
        with open(self.dir / "ledger.jsonl", "a") as f: f.write(json.dumps(rec) + "\n")

    def _count(self, plugin, cls, seconds):
        p = self.dir / "ledger.jsonl"
        if not p.exists(): return 0
        cut = self.now() - seconds
        n = 0
        for line in p.read_text().splitlines():
            r = json.loads(line)
            if r["plugin"] == plugin and r["class"] == cls and r["status"] == "sent" and r["at"] >= cut: n += 1
        return n

    # -- the gate -----------------------------------------------------------
    def perform(self, a: Action) -> Result:
        r = self._decide(a)
        self._log(a, r)
        return r

    def _decide(self, a: Action) -> Result:
        spec = SCOPE["plugins"].get(a.plugin)
        if not spec: return Result("refused", f"unknown plugin {a.plugin}")
        if a.cls not in SCOPE["action_classes"]: return Result("refused", f"unknown action class {a.cls}")
        if a.cls not in spec["classes"]: return Result("refused", f"scope: {a.plugin} may not do {a.cls}")
        if a.adapter not in spec["adapters"]: return Result("refused", f"scope: adapter {a.adapter} not allowed for {a.plugin}")
        cfg = self.pcfg(a.plugin)
        if cfg["kill"]: return Result("refused", "kill switch is on")
        if not cfg["enabled"]: return Result("refused", f"plugin {a.plugin} is not enabled")
        klass = SCOPE["action_classes"][a.cls]
        if not klass["external"]:
            return Result("sent", "internal action")
        bad = self.guard(a)
        if bad: return Result("refused", bad)
        if a.target and a.cls == "send_to_person":
            if self.suppressed(a.target): return Result("refused", "target is suppressed")
            if not self.consented(a.target) and a.purpose != "confirmation":
                return Result("refused", "no recorded consent for target")
        for window, secs in (("day", 86400), ("week", 604800)):
            for key, cap in SCOPE["plugins"][a.plugin]["caps"].items():
                if key.endswith("_per_" + window):
                    lim = min(cap, cfg["limits"].get(key, cap))
                    if self._count(a.plugin, a.cls, secs) >= lim:
                        return Result("refused", f"rate cap {key}={lim} reached")
        if cfg["mode"] != "live":
            return Result("dry-run", "mode is dry-run; nothing was sent", {"request": self.redact(a.steps or [a.request])})
        if RUNGS.index(self.config.get("rung", "observed")) < RUNGS.index(klass["min_rung"]):
            return Result("refused", f"trust rung {self.config.get('rung')} is below {klass['min_rung']} for {a.cls}")
        miss = self.missing_credentials(a.plugin)
        if miss: return Result("refused", "credential bindings missing: " + ", ".join(miss))
        return self._execute(a, spec, cfg)

    def _execute(self, a, spec, cfg):
        steps = a.steps or [a.request]
        seen = []
        for i, step in enumerate(steps):
            req = self.materialize(step, seen)
            host_err = self.egress(req, a, spec, cfg)
            if host_err: return Result("refused", f"step {i}: {host_err}")
            try:
                out = self.transport(req)
            except Exception as e:  # recorded, never swallowed
                return Result("error", f"step {i}: {type(e).__name__}: {e}")
            status, body = out[0], out[1]
            headers = {k.lower(): v for k, v in (out[2] if len(out) > 2 else {}).items()}
            seen.append({"body": body, "headers": headers})
            if not 200 <= status < 300: return Result("error", f"step {i}: http {status}", {"body": str(body)[:500]})
        last = seen[-1]["body"]
        return Result("sent", f"http ok after {len(steps)} step(s)", {"body": last if isinstance(last, (dict, list)) else str(last)[:500]})

    # -- guard: content rules ----------------------------------------------
    def guard(self, a: Action):
        if a.cls not in ("publish_public", "send_to_person", "publish_video") or a.text is None: return None
        t = a.text
        if not t.strip(): return "empty text"
        g = self._read("guard.json", DEFAULT_GUARD)
        for pat in g.get("blocked_patterns", []):
            if re.search(pat, t, re.I): return f"guard: blocked pattern {pat!r}"
        if a.cls == "publish_public" and self.guard_sources:
            if not any(t.strip() in s for s in self.guard_sources):
                return "guard: public text must be a verbatim excerpt of the approved self-description"
        return None

    # -- egress: where a request may go ------------------------------------
    def egress(self, req, a, spec, cfg):
        url = req.get("url", "")
        host = urllib.parse.urlparse(url).hostname or ""
        for h in spec["hosts"]:
            if h.startswith("$ENV:"):
                envname = cfg["adapter_config"].get(h[5:])
                allowed = urllib.parse.urlparse(self.secret(envname) or "").hostname if envname else None
                if allowed and host == allowed: return None
            elif fnmatch.fnmatch(host, h): return None
        return f"egress: host {host!r} is not allowed for {a.plugin}"

    # -- request handling ---------------------------------------------------
    @staticmethod
    def redact(req):
        s = json.dumps(req)
        return json.loads(re.sub(r"\$\{env:([A-Za-z0-9_]+)\}", r"<secret:\1>", s))

    def materialize(self, req, seen=()):
        def look(m):
            i, path = int(m.group(1)), m.group(2).split(".")
            v = seen[i] if i < len(seen) else {}
            for p in path:
                v = v.get(p, "") if isinstance(v, dict) else ""
            return str(v)
        def sub(v):
            if isinstance(v, dict): return {k: sub(x) for k, x in v.items()}
            if isinstance(v, list): return [sub(x) for x in v]
            if isinstance(v, str):
                v = re.sub(r"\$\{env:([A-Za-z0-9_]+)\}", lambda m: self.secret(m.group(1)) or "", v)
                return re.sub(r"\$\{step(\d+)\.([A-Za-z0-9_.]+)\}", look, v)
            return v
        return sub(req)

    @staticmethod
    def _http(req):
        data = req.get("body")
        if isinstance(data, dict) and set(data) == {"file"}: data = Path(data["file"]).read_bytes()
        elif isinstance(data, (dict, list)): data = json.dumps(data).encode()
        elif isinstance(data, str): data = data.encode()
        rq = urllib.request.Request(req["url"], data=data, method=req.get("method", "GET"), headers=req.get("headers", {}))
        try:
            with urllib.request.urlopen(rq, timeout=30) as r:
                raw = r.read().decode("utf-8", "replace")
                try: body = json.loads(raw)
                except ValueError: body = raw
                return r.status, body, dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)
