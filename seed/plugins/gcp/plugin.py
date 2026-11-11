"""Google Cloud plugin: allowlisted REST calls. Reads are GET only. Writes may only create or update
resources labelled managed-by=ultrastable; deleting is out of bounds. Auth: token_env holds a short-lived
OAuth access token minted by your platform (workload identity or similar); the plugin never holds a key."""
from ..api import Action

ADAPTER = "gcp-rest"


def _auth(rt):
    return {"authorization": "Bearer ${env:%s}" % rt.pcfg("gcp")["adapter_config"].get("token_env", "GCP_ACCESS_TOKEN")}


def read(rt, url):
    """GET a googleapis.com URL, for example https://cloudresourcemanager.googleapis.com/v1/projects"""
    return rt.perform(Action("gcp", "cloud_read", ADAPTER, target=url, request={"method": "GET", "url": url, "headers": _auth(rt)}))


def write(rt, method, url, body):
    if method not in ("POST", "PUT", "PATCH"): return _refused(rt, url, f"method {method} is out of bounds")
    labels = (body or {}).get("labels", {})
    if labels.get("managed-by") != "ultrastable":
        return _refused(rt, url, "write must carry labels.managed-by=ultrastable")
    return rt.perform(Action("gcp", "cloud_write", ADAPTER, target=url, request={"method": method, "url": url, "headers": dict(_auth(rt), **{"content-type": "application/json"}), "body": body}))


def _refused(rt, url, why):
    from ..api import Result
    r = Result("refused", "scope: " + why)
    rt._log(Action("gcp", "cloud_write", ADAPTER, target=url), r)
    return r
