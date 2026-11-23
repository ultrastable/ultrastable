#!/usr/bin/env python3
"""NEEDS-PAT-1: the credential the merge lane uses for pull requests that change `.github/workflows/**`.

GitHub refuses to let the workflow's built-in token merge a change to workflow files. Two server-side credentials can, and the lane takes
the first one that is bound as a repository secret:

  lane-pat     LANE_PAT: a fine-grained token with Contents, Pull requests and Workflows read and write on this repository
  github-app   LANE_APP_ID + LANE_APP_PRIVATE_KEY: a GitHub App installed on this repository with the same three permissions; the lane
               mints a one-hour installation token from them on each run

  python3 scripts/lane_credential.py source   prints lane-pat, github-app or none. Never prints a secret.
  python3 scripts/lane_credential.py token    prints the token, for command substitution only: scripts/lane.sh captures it in a shell
                                              variable and passes it to one `gh pr merge` call. Never run this as a bare log step.
  python3 scripts/lane_credential.py org-token  the App's installation token without a repository restriction (administration and
                                              contents write), captured the same way by tenant-repos.yml to create a tenant repository.

With neither bound the answer is `none`: the lane leaves such pull requests open, green and labeled `needs-pat`, says so on every pass,
and nothing works around it. Binding one is the owner step `lane-credential` in foundation/data/needs-you.json. Server-side only (owner,
2026-11-12): this replaces a task that ran on a person's computer with that person's own login.
"""
from __future__ import annotations
import base64, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.request

API = "https://api.github.com"
PERMISSIONS = {"contents": "write", "pull_requests": "write", "workflows": "write"}


def source(env=None) -> str:
    env = os.environ if env is None else env
    if env.get("LANE_PAT"):
        return "lane-pat"
    if env.get("LANE_APP_ID") and env.get("LANE_APP_PRIVATE_KEY"):
        return "github-app"
    return "none"


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def app_jwt(app_id: str, key_pem: str, now: int | None = None) -> str:
    """RS256 JWT for a GitHub App. The key goes to openssl on standard input and is never written to disk; only the unsigned
    header.payload text (not a secret) is."""
    now = int(time.time()) if now is None else now
    head = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64(json.dumps({"iat": now - 60, "exp": now + 540, "iss": str(app_id)}, separators=(",", ":")).encode())
    signing_input = f"{head}.{body}"
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "signing-input")
        with open(p, "w", encoding="ascii") as f:
            f.write(signing_input)
        r = subprocess.run(["openssl", "dgst", "-sha256", "-sign", "/dev/stdin", "-binary", p], input=key_pem.encode(), capture_output=True, timeout=30)
    if r.returncode != 0 or not r.stdout:
        raise RuntimeError("openssl could not sign with LANE_APP_PRIVATE_KEY (is it a PEM RSA private key?)")  # stderr is not echoed: it may quote key material
    return f"{signing_input}.{_b64(r.stdout)}"


def _http(method: str, path: str, bearer: str, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {bearer}", "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                                          "User-Agent": "ultrastable-lane"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, {"message": e.read().decode("utf-8", "replace")[:200]}


def installation_token(env=None, http=_http, now: int | None = None) -> str:
    """A one-hour installation token scoped to this repository and to the three permissions the merge needs."""
    env = os.environ if env is None else env
    repo = env["GITHUB_REPOSITORY"]
    jwt = app_jwt(env["LANE_APP_ID"], env["LANE_APP_PRIVATE_KEY"], now)
    st, inst = http("GET", f"/repos/{repo}/installation", jwt)
    if st != 200:
        raise RuntimeError(f"the GitHub App is not installed on {repo} (HTTP {st})")
    st, tok = http("POST", f"/app/installations/{inst['id']}/access_tokens", jwt, {"repositories": [repo.split("/", 1)[1]], "permissions": PERMISSIONS})
    if st != 201 or not tok.get("token"):
        raise RuntimeError(f"GitHub did not issue an installation token (HTTP {st}); the App needs {', '.join(sorted(PERMISSIONS))} write on {repo}")
    return tok["token"]


ORG_PERMISSIONS = {"administration": "write", "contents": "write"}


def org_token(env=None, http=_http, now: int | None = None) -> str:
    """TENANT-REPO-1: an installation token over the whole installation (no repository restriction), asking for administration and
    contents write, so the tenant-repos workflow can create a tenant repository in the org and push its first history. GitHub refuses it
    when the App was not granted those permissions; the refusal is raised with its status, never hidden."""
    env = os.environ if env is None else env
    repo = env["GITHUB_REPOSITORY"]
    jwt = app_jwt(env["LANE_APP_ID"], env["LANE_APP_PRIVATE_KEY"], now)
    st, inst = http("GET", f"/repos/{repo}/installation", jwt)
    if st != 200:
        raise RuntimeError(f"the GitHub App is not installed on {repo} (HTTP {st})")
    st, tok = http("POST", f"/app/installations/{inst['id']}/access_tokens", jwt, {"permissions": ORG_PERMISSIONS})
    if st != 201 or not tok.get("token"):
        raise RuntimeError(f"GitHub did not issue an org installation token (HTTP {st}); the App needs administration and contents write")
    return tok["token"]


def token(env=None, http=_http) -> str:
    env = os.environ if env is None else env
    src = source(env)
    if src == "lane-pat":
        return env["LANE_PAT"]
    if src == "github-app":
        return installation_token(env, http)
    raise RuntimeError("no workflow-capable credential is bound (LANE_PAT, or LANE_APP_ID with LANE_APP_PRIVATE_KEY)")


def main(argv) -> int:
    cmd = argv[0] if argv else "source"
    if cmd == "source":
        print(source())
        return 0
    if cmd == "token":
        try:
            sys.stdout.write(token())
        except (RuntimeError, KeyError, OSError, subprocess.TimeoutExpired) as e:
            print(f"lane-credential: {e}", file=sys.stderr)
            return 1
        return 0
    if cmd == "org-token":
        try:
            if source() != "github-app" and not (os.environ.get("LANE_APP_ID") and os.environ.get("LANE_APP_PRIVATE_KEY")):
                raise RuntimeError("LANE_APP_ID and LANE_APP_PRIVATE_KEY are not bound")
            sys.stdout.write(org_token())
        except (RuntimeError, KeyError, OSError, subprocess.TimeoutExpired) as e:
            print(f"lane-credential: {e}", file=sys.stderr)
            return 1
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
