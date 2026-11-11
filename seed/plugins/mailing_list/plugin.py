"""Mailing list plugin: double opt-in subscribe, confirm, unsubscribe, campaigns. Lists live in
plugin-state/lists/<name>.json. Sending goes through the email plugin, so its consent, suppression,
rate caps and guard apply. Token secret: adapter_config.secret_env (name only)."""
import hashlib, hmac, json
from ..api import Action, Result
from ..email import plugin as email

ADAPTER = "file-store"


def _path(rt, lst): return rt.dir / "lists" / f"{lst}.json"


def _load(rt, lst):
    p = _path(rt, lst)
    return json.loads(p.read_text()) if p.exists() else {"pending": {}, "subscribed": []}


def _save(rt, lst, d):
    p = _path(rt, lst); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(d, indent=1))


def token(rt, lst, addr):
    key = (rt.secret(rt.pcfg("mailing_list")["adapter_config"].get("secret_env", "LIST_TOKEN_SECRET")) or "dry-run-key").encode()
    return hmac.new(key, f"{lst}|{addr.lower()}".encode(), hashlib.sha256).hexdigest()[:32]


def _rec(rt, what, addr):
    a = Action("mailing_list", "draft", ADAPTER, target=addr, text=what)
    if "refused" in what:
        r = Result("refused", what); rt._log(a, r); return r
    return rt.perform(a)


def subscribe(rt, lst, addr, base_url="https://example.invalid"):
    """Step 1: record a pending address and send one confirmation message. Nothing else is sent until confirmed."""
    if rt.suppressed(addr): return _rec(rt, "subscribe refused: suppressed", addr)
    d = _load(rt, lst); d["pending"][addr.lower()] = token(rt, lst, addr); _save(rt, lst, d)
    link = f"{base_url}/confirm?list={lst}&email={addr}&t={d['pending'][addr.lower()]}"
    return email.send(rt, addr, f"Confirm your subscription to {lst}", f"Open this link to confirm: {link}\nIf you did not ask for this, ignore this message; you will not be mailed.", purpose="confirmation")


def confirm(rt, lst, addr, tok):
    d = _load(rt, lst)
    want = d["pending"].get(addr.lower())
    if not want or not hmac.compare_digest(want, tok): return _rec(rt, "confirm refused: bad token", addr)
    del d["pending"][addr.lower()]; d["subscribed"].append(addr.lower()); _save(rt, lst, d)
    rt.grant_consent(addr)
    return _rec(rt, "confirmed", addr)


def unsubscribe(rt, lst, addr):
    d = _load(rt, lst)
    d["subscribed"] = [x for x in d["subscribed"] if x != addr.lower()]; d["pending"].pop(addr.lower(), None); _save(rt, lst, d)
    rt.suppress(addr)
    return _rec(rt, "unsubscribed and suppressed", addr)


def campaign(rt, lst, subject, body, base_url="https://example.invalid"):
    """One message to every confirmed subscriber; each carries an unsubscribe link. Returns [(addr, Result)]."""
    out = []
    for addr in _load(rt, lst)["subscribed"]:
        foot = f"\n\nUnsubscribe: {base_url}/unsubscribe?list={lst}&email={addr}&t={token(rt, lst, addr)}"
        out.append((addr, email.send(rt, addr, subject, body + foot)))
    return out
