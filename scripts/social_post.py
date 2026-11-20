#!/usr/bin/env python3
"""Publish due posts from social/calendar.json. Dry-run unless gate.json mode=live and a channel's secrets exist.
Exit code 1 on any adapter or state failure (never swallowed)."""
import json, os, sys, datetime as dt, urllib.request, urllib.error
from social_lib import *

def http(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")

# VIDEO-2 (OL-20261113-4): the demo video is attached to one post each time its release changes. The asset is the one .github/workflows/demo-video.yml
# publishes (releases/download/demo-video/demo.mp4). It is looked up without a credential on purpose: a link an anonymous reader cannot open is never posted.
VIDEO_REPO = os.environ.get("GITHUB_REPOSITORY") or "ultrastable/ultrastable"
VIDEO_ASSET = "demo.mp4"
VIDEO_PATH = "releases/download/demo-video/" + VIDEO_ASSET

def video_release(get=None):
    """{"url", "updated"} of the published demo video, or None when there is no public release (nothing is attached then)."""
    def _get(url):
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "ultrastable-social"}), timeout=20) as r:
            return json.loads(r.read() or b"{}")
    try:
        rel = (get or _get)(f"https://api.github.com/repos/{VIDEO_REPO}/releases/tags/demo-video")
    except (urllib.error.URLError, ValueError, OSError) as e:
        print(f"demo video: no public release reachable ({type(e).__name__}); no video post"); return None
    a = next((x for x in rel.get("assets", []) if x.get("name") == VIDEO_ASSET), None)
    url = f"https://github.com/{VIDEO_REPO}/{VIDEO_PATH}"
    return {"url": url, "updated": a["updated_at"]} if a and a.get("updated_at") and a.get("browser_download_url") == url else None

def video_post(state, release, today):
    """The post that carries the video: due once per release update. Its text is the storyboard's opening narration line, which the guard already checks."""
    if not release or (state.get("video") or {}).get("updated") == release["updated"]:
        return None
    scene = json.loads((ROOT / "video/storyboard.json").read_text())["scenes"][0]
    return {"id": "video-" + release["updated"][:10], "date": today.isoformat(), "text": scene["text"], "source": scene["source"], "kind": "video", "media": release["url"], "updated": release["updated"]}

def bluesky(text, pid, media=None):
    s = http("https://bsky.social/xrpc/com.atproto.server.createSession",
             {"identifier": os.environ["BLUESKY_HANDLE"], "password": os.environ["BLUESKY_APP_PASSWORD"]}, {})
    rec = {"$type": "app.bsky.feed.post", "text": text, "langs": ["en"],
           "createdAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")}
    if media:  # a link card to the video; the text stays the guarded excerpt
        rec["embed"] = {"$type": "app.bsky.embed.external", "external": {"uri": media, "title": "Ultrastable demo video", "description": text}}
    r = http("https://bsky.social/xrpc/com.atproto.repo.createRecord",
             {"repo": s["did"], "collection": "app.bsky.feed.post", "record": rec},
             {"Authorization": "Bearer " + s["accessJwt"]})
    return r.get("uri", "")

def mastodon(text, pid, media=None):
    base = os.environ["MASTODON_INSTANCE"].rstrip("/")
    if not base.startswith("https://"):
        base = "https://" + base
    r = http(base + "/api/v1/statuses", {"status": text + ("\n" + media if media else ""), "visibility": "public"},  # the server renders the link as a player card
             {"Authorization": "Bearer " + os.environ["MASTODON_TOKEN"], "Idempotency-Key": pid})
    return r.get("url", "")

ADAPTERS = {"bluesky": bluesky, "mastodon": mastodon}

def main(now=None, release=None):
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
    vp = video_post(state, (release or video_release)(), today)
    if vp and vp["id"] not in done_ids:
        due.append(vp)
    if not due:
        print("nothing due"); return 0
    if day_n >= gate["max_posts_per_day"] or wk_n >= gate["max_posts_per_week"]:
        print("rate limit reached; deferring"); return 0
    due.sort(key=lambda p: {"video": 0, "event": 1}.get(p.get("kind"), 2))  # a new video goes out once, ahead of the daily events, so it cannot wait behind them forever  # REACH-1: fresh events first, evergreen excerpts fill the gaps (sort is stable)
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
            print(f"[{results[ch]}] {ch}: {post['text']}" + (f" [video {post['media']}]" if post.get("media") else "")); continue
        try:
            results[ch] = "posted " + ADAPTERS[ch](post["text"], post["id"], post.get("media"))
        except (urllib.error.URLError, KeyError, ValueError) as e:
            results[ch] = f"FAILED {type(e).__name__}: {e}"; fail = True
    print(json.dumps({"id": post["id"], "results": results}))
    if live and any(v.startswith("posted") for v in results.values()):
        state["posted"].append({"id": post["id"], "date": today.isoformat(), "results": results})
        if post.get("kind") == "video":
            state["video"] = {"updated": post["updated"], "id": post["id"]}  # the same release is never posted twice; a rebuilt video is due again
        statep.write_text(json.dumps(state, indent=1) + "\n")
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
