# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REDTEAM-1 timebomb check: loaded through PYTHONPATH, shifts wall-clock time forward by REDTEAM_SHIFT_DAYS so date bombs in tests show up.
Pure Python (no LD_PRELOAD), so it needs no third-party library."""
import datetime as _dt, os, time as _time

_S = float(os.environ.get("REDTEAM_SHIFT_DAYS", "0")) * 86400
if _S:
    _real = _time.time
    _time.time = lambda: _real() + _S
    _D = _dt.timedelta(seconds=_S)

    class _Shifted(_dt.datetime):
        @classmethod
        def now(cls, tz=None):
            return _dt.datetime.now(tz) + _D if cls is _Shifted else super().now(tz) + _D

        @classmethod
        def utcnow(cls):
            return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None) + _D

    _real_dt = _dt.datetime

    class _ShiftedDate(_dt.date):
        @classmethod
        def today(cls):
            return (_real_dt.now() + _D).date()

    _real_dt = _dt.datetime
    _Shifted.now = classmethod(lambda cls, tz=None: _real_dt.now(tz) + _D)
    _dt.datetime, _dt.date = _Shifted, _ShiftedDate
