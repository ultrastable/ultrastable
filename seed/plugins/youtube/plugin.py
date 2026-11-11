"""YouTube plugin: YouTube Data API v3 resumable upload, always private or unlisted. Making a video
public is a gate card, not a plugin action. OAuth refresh: client_id_env, client_secret_env, refresh_token_env."""
from ..api import Action


def build_upload(rt, video_path, title, description, privacy="private"):
    if privacy not in ("private", "unlisted"): raise ValueError("plugin uploads are private or unlisted; public release is a gate card")
    ac = rt.pcfg("youtube")["adapter_config"]
    e = lambda k, d: "${env:%s}" % ac.get(k, d)
    steps = [{"method": "POST", "url": "https://oauth2.googleapis.com/token", "headers": {"content-type": "application/json"},
              "body": {"client_id": e("client_id_env", "YT_CLIENT_ID"), "client_secret": e("client_secret_env", "YT_CLIENT_SECRET"),
                       "refresh_token": e("refresh_token_env", "YT_REFRESH_TOKEN"), "grant_type": "refresh_token"}},
             {"method": "POST", "url": "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
              "headers": {"authorization": "Bearer ${step0.body.access_token}", "content-type": "application/json"},
              "body": {"snippet": {"title": title, "description": description}, "status": {"privacyStatus": privacy}}},
             {"method": "PUT", "url": "${step1.headers.location}", "headers": {"authorization": "Bearer ${step0.body.access_token}", "content-type": "video/*"},
              "body": {"file": video_path}}]
    return Action("youtube", "publish_video", "youtube-data-v3", target="youtube", text=title + "\n" + description, steps=steps)


def upload(rt, *a, **kw): return rt.perform(build_upload(rt, *a, **kw))
