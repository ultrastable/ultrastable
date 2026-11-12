"""Email plugin. Sends through a small sender Worker you deploy (email/worker/sender.js) that holds the
Cloudflare send_email binding. Config holds env NAMES: endpoint_env (URL) and token_env (bearer)."""
from ..api import Action

ADAPTER = "cloudflare-sender"


def build_send(rt, to, subject, body, from_addr=None, purpose=""):
    ac = rt.pcfg("email")["adapter_config"]
    sender = from_addr or ac.get("from") or ""
    req = {"method": "POST", "url": "${env:%s}" % ac.get("endpoint_env", "MAIL_SEND_URL"),
           "headers": {"authorization": "Bearer ${env:%s}" % ac.get("token_env", "MAIL_SEND_TOKEN"), "content-type": "application/json"},
           "body": {"from": sender, "to": to, "subject": subject, "text": body}}
    return Action("email", "send_to_person", ADAPTER, target=to, text=subject + "\n" + body, request=req, purpose=purpose)


def send(rt, to, subject, body, **kw):
    return rt.perform(build_send(rt, to, subject, body, **kw))
