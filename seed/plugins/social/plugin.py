"""Social plugin. Adapters: bluesky (app password), mastodon (access token), buffer (v1 REST, as proven
in the system this was learned from; check Buffer's current API terms before enabling, it may need a
different endpoint). Text must pass the guard: a verbatim excerpt of the approved self-description."""
import hashlib, time
from ..api import Action

ADAPTERS = ("buffer", "bluesky", "mastodon")


def build(rt, adapter, text, services=("mastodon", "linkedin")):
    ac = rt.pcfg("social")["adapter_config"]
    if adapter == "mastodon":
        key = hashlib.sha256((text + time.strftime("%Y-%m-%d", time.gmtime(rt.now()))).encode()).hexdigest()[:32]
        req = {"method": "POST", "url": "${env:%s}/api/v1/statuses" % ac.get("instance_env", "MASTODON_URL"),
               "headers": {"authorization": "Bearer ${env:%s}" % ac.get("token_env", "MASTODON_TOKEN"), "idempotency-key": key},
               "body": {"status": text, "visibility": "public"}}
        return Action("social", "publish_public", adapter, target="mastodon", text=text, request=req)
    if adapter == "bluesky":
        ident = ac.get("handle_env", "BLUESKY_HANDLE")
        steps = [{"method": "POST", "url": "https://bsky.social/xrpc/com.atproto.server.createSession", "headers": {"content-type": "application/json"},
                  "body": {"identifier": "${env:%s}" % ident, "password": "${env:%s}" % ac.get("token_env", "BLUESKY_APP_PASSWORD")}},
                 {"method": "POST", "url": "https://bsky.social/xrpc/com.atproto.repo.createRecord",
                  "headers": {"authorization": "Bearer ${step0.body.accessJwt}", "content-type": "application/json"},
                  "body": {"repo": "${step0.body.did}", "collection": "app.bsky.feed.post",
                           "record": {"$type": "app.bsky.feed.post", "text": text, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(rt.now()))}}}]
        return Action("social", "publish_public", adapter, target="bluesky", text=text, steps=steps)
    if adapter == "buffer":
        tok = "${env:%s}" % ac.get("token_env", "BUFFER_TOKEN")
        steps = [{"method": "GET", "url": "https://api.bufferapp.com/1/profiles.json?access_token=" + tok},   # channel ids are discovered live, never stored
                 {"method": "POST", "url": "https://api.bufferapp.com/1/updates/create.json?access_token=" + tok,
                  "headers": {"content-type": "application/json"},
                  "body": {"profile_ids": ["<discovered from step 0 for: %s>" % ",".join(services)], "text": text, "now": True}}]
        return Action("social", "publish_public", adapter, target="buffer:" + ",".join(services), text=text, steps=steps)
    raise ValueError(f"unknown social adapter {adapter}")


def publish(rt, adapter, text, **kw):
    return rt.perform(build(rt, adapter, text, **kw))
