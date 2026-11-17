#!/usr/bin/env python3
"""Publish due posts from social/calendar.json. Dry-run unless gate.json mode=live and a channel's secrets exist.
Exit code 1 on any adapter or state failure (never swallowed)."""
import json, os, sys, datetime as dt, urllib.request, urllib.error
from social_lib import *

def http(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")

def bluesky(text, pid):
    s = http("https://bsky.social/xrpc/com.atproto.server.createSession",
             {"identifier": os.environ["BLUESKY_HANDLE"], "password": os.environ["BLUESKY_APP_PASSWORD"]}, {})
    rec = {"$type": "app.bsky.feed.post", "text": text, "langs": ["en"],
           "createdAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
    r = http("https://bsky.social/xrpc/com.atproto.repo.createRecord",
             {"repo": s["did"], "collection": "app.bsky.feed.post", "record": rec},
             {"Authorization": "Bearer " + s["accessJwt"]})
    return r.get("uri", "")

def mastodon(text, pid):
    base = os.environ["MASTODON_INSTANCE"].rstrip("/")
    if not base.startswith("https://"):
        base = "https://" + base
    r = http(base + "/api/v1/statuses", {"status": text, "visibility": "public"},
             {"Authorization": "Bearer " + os.environ["MASTODON_TOKEN"], "Idempotency-Key": pid})
    return r.get("url", "")

ADAPTERS = {"bluesky": bluesky, "mastodon": mastodon}

def main(now=None):
    gate, acc = load("gate.json"), load("accounts.json")["channels"]
    cal = load("calendar.json")
    statep = S / "state.json"
    state = json.loads(statep.read_text()) if statep.exists() else {"posted": []}
    if gate["kill"]:
        print("KILL SWITCH ON: nothing posted"); return 0
    now = now or dt.datetime.now(dt.timezone.utc)
    today = now.date()
    done_ids = {p["id"] for p in state["posted"]}
    day_n = sum(1 for p in state["posted"] if p["date"] == today.isoformat())
    wk_n = sum(1 for p in state["posted"] if week_key(dt.date.fromisoformat(p["date"])) == week_key(today))
    due = [p for p in cal["posts"] if p["id"] not in done_ids and dt.date.fromisoformat(p["date"]) <= today]
    if not due:
        print("nothing due"); return 0
    if day_n >= gate["max_posts_per_day"] or wk_n >= gate["max_posts_per_week"]:
        print("rate limit reached; deferring"); return 0
    due.sort(key=lambda p: p.get("kind") != "event")  # REACH-1: fresh events first, evergreen excerpts fill the gaps (sort is stable)
    post = due[0]
    if post.get("kind") == "event":
        import sys as _s; _s.path.insert(0, str(ROOT))
        from foundation import reach
        ev = {c["id"]: c["event"] for c in reach.candidates(ROOT)}.get(post["id"][3:], post["text"])
        bad = reach.guard(post["text"], ev, ROOT)
    else:
        bad = guard(post["text"], post["source"])
    if bad:
        print(f"GUARD BLOCKED {post['id']}: {bad}"); return 1
    live = gate["mode"] == "live"
    results, fail = {}, False
    for ch, cfg in acc.items():
        if ch in gate["paused_channels"]:
            results[ch] = "paused"; continue
        have = all(os.environ.get(k) for k in cfg["secrets"])
        if not live or not have:
            results[ch] = "dry-run" if not live else "no-credentials"
            print(f"[{results[ch]}] {ch}: {post['text']}"); continue
        try:
            results[ch] = "posted " + ADAPTERS[ch](post["text"], post["id"])
        except (urllib.error.URLError, KeyError, ValueError) as e:
            results[ch] = f"FAILED {type(e).__name__}: {e}"; fail = True
    print(json.dumps({"id": post["id"], "results": results}))
    if live and any(v.startswith("posted") for v in results.values()):
        state["posted"].append({"id": post["id"], "date": today.isoformat(), "results": results})
        statep.write_text(json.dumps(state, indent=1) + "\n")
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
