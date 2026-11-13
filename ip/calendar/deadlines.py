#!/usr/bin/env python3
"""IP-6: write an .ics with the 12-month conversion deadline and 90/60/30-day reminders.

Usage: python ip/calendar/deadlines.py YYYY-MM-DD [out.ics]
The date is the provisional's filing date (from the USPTO receipt). The deadline is
filing date + 12 months (35 USC 119(e)); if it falls on a weekend/holiday the filing
may roll to the next business day, but the calendar uses the earlier calendar date.
Import the file into the owner's calendar. Nothing is sent anywhere.
"""
import sys, datetime as d, calendar

def add_months(x, m):
    y, mo = divmod(x.month - 1 + m, 12)
    y += x.year; mo += 1
    return d.date(y, mo, min(x.day, calendar.monthrange(y, mo)[1]))

def events(filed):
    dl = add_months(filed, 12)
    out = [(dl, "DEADLINE: file non-provisional / PCT (12 months from provisional)")]
    for n in (90, 60, 30, 7):
        out.append((dl - d.timedelta(days=n), f"{n} days to non-provisional / PCT deadline ({dl})"))
    return out

def ics(filed):
    L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ultrastable//ip6//EN"]
    for day, s in events(filed):
        L += ["BEGIN:VEVENT", f"UID:ip6-{day:%Y%m%d}@ultrastable", f"DTSTAMP:{d.datetime.utcnow():%Y%m%dT%H%M%SZ}",
              f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"SUMMARY:{s}", "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY",
              f"DESCRIPTION:{s}", "END:VALARM", "END:VEVENT"]
    return "\r\n".join(L + ["END:VCALENDAR"]) + "\r\n"

if __name__ == "__main__":
    f = d.date.fromisoformat(sys.argv[1])
    p = sys.argv[2] if len(sys.argv) > 2 else "ip/calendar/deadlines.ics"
    open(p, "w", newline="").write(ics(f)); print("wrote", p)
    for day, s in events(f): print(day, s)
