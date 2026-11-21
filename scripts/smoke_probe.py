#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# SPDX-License-Identifier: Apache-2.0
# SMOKE-LIVE-1: fetch public URLs from production and print status, type, size, an excerpt. Read-only.
import sys, time, urllib.request, urllib.error

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None

def get(url, ua="ultrastable-smoke/1", follow=True):
    req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept": "*/*"})
    t = time.time()
    opener = urllib.request.build_opener() if follow else urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=25) as r:
            body = r.read(400000)
            return {"url": url, "status": r.status, "type": r.headers.get("content-type", ""), "bytes": len(body),
                    "ms": int((time.time() - t) * 1000), "final": r.geturl(), "headers": {k.lower(): v for k, v in r.headers.items() if k.lower() in ("link", "x-robots-tag", "location")},
                    "body": body.decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"url": url, "status": e.code, "type": e.headers.get("content-type", ""), "bytes": 0, "location": e.headers.get("location", ""), "ms": int((time.time() - t) * 1000), "body": e.read(2000).decode("utf-8", "replace")}
    except Exception as e:
        return {"url": url, "status": 0, "type": "", "bytes": 0, "ms": int((time.time() - t) * 1000), "body": "", "error": repr(e)}

if __name__ == "__main__":
    for u in sys.argv[1:]:
        r = get(u)
        ex = " ".join(r["body"][:300].split())
        print(f"{r['status']:>3} {r['bytes']:>7}B {r['ms']:>5}ms {u} [{r['type'][:30]}] {r.get('error','')} :: {ex}")
