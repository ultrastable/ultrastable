# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""STANDARDS-FIRST-1 (Rowan, 2026-11-25): "Standards, don't reinvent the wheel." Events between loops are CloudEvents 1.0 (CNCF), JSON format.
Ultrastable is the foundation for any autonomous system.

One envelope for every Python loop; the Worker twin is seed/worker/src/cloudevents.js and both pass seed/standards/cloudevents-vectors.json.

  event(area, name, source, data, subject=..., id=..., time=...)   a conformant envelope; type is io.ultrastable.<area>.<name>
  conforms(e)                                                       every way e breaks the spec ([] = conformant)
  unwrap(row)                                                       the payload of an envelope, or the row itself when it predates the envelope
Rows written before the envelope stay as they are; readers call unwrap() (foundation/ledger.py does it for every ledger).
Tests: tests/foundation/test_cloudevents.py."""
from __future__ import annotations
import re, time as _time, uuid

SPECVERSION, TYPE_PREFIX = "1.0", "io.ultrastable."
_NAME = re.compile(r"^[a-z0-9]+$")
_RFC3339 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_CORE = ("specversion", "id", "source", "type", "datacontenttype", "dataschema", "subject", "time", "data", "data_base64")


def _part(s) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9_-]+", "-", str(s).lower()))


def event_type(area, name) -> str:
    a, ev = _part(area), ".".join(p for p in (_part(x) for x in str(name).split(".")) if p)
    if not a or not ev:
        raise ValueError("a CloudEvent type needs an area and an event")
    return TYPE_PREFIX + a + "." + ev


def event(area, name, source, data=None, *, subject=None, id=None, time=None, dataschema=None, extensions=None) -> dict:
    e = {"specversion": SPECVERSION, "id": str(id or uuid.uuid4().hex), "source": str(source or ""), "type": event_type(area, name)}
    if subject not in (None, ""):
        e["subject"] = str(subject)
    if time is not False:  # False: the caller has no RFC 3339 time for the occurrence and the envelope must stay deterministic
        e["time"] = time or _time.strftime("%Y-%m-%dT%H:%M:%SZ", _time.gmtime())
    if dataschema:
        e["dataschema"] = dataschema
    e.update(extensions or {})
    if data is not None:
        e["datacontenttype"] = "application/json"
        e["data"] = data
    bad = conforms(e)
    if bad:
        raise ValueError("not a CloudEvent: " + "; ".join(bad))
    return e


def conforms(e) -> list[str]:
    if not isinstance(e, dict):
        return ["an event is a JSON object"]
    bad = []
    if e.get("specversion") != SPECVERSION:
        bad.append('specversion must be "1.0"')
    for k in ("id", "source", "type"):
        if not isinstance(e.get(k), str) or not e.get(k):
            bad.append(f"{k} must be a non-empty string")
    if isinstance(e.get("source"), str) and re.search(r"\s", e["source"]):
        bad.append("source must be a URI-reference")
    for k in ("datacontenttype", "dataschema", "subject"):
        if k in e and (not isinstance(e[k], str) or not e[k]):
            bad.append(f"{k} must be a non-empty string when present")
    if "time" in e and not (isinstance(e["time"], str) and _RFC3339.match(e["time"])):
        bad.append("time must be an RFC 3339 timestamp")
    if "data" in e and "data_base64" in e:
        bad.append("data and data_base64 are exclusive")
    for k, v in e.items():
        if not _NAME.match(k) and k != "data_base64":
            bad.append(f"attribute name {k} must be lower-case letters and digits")
        elif k not in _CORE and (isinstance(v, (dict, list)) or v is None):
            bad.append(f"extension attribute {k} must be a string, number or boolean")
    return bad


def is_event(r) -> bool:
    return isinstance(r, dict) and r.get("specversion") == SPECVERSION and isinstance(r.get("type"), str) and isinstance(r.get("id"), str)


def unwrap(r):
    return r["data"] if is_event(r) and r["type"].startswith(TYPE_PREFIX) and isinstance(r.get("data"), dict) else r
