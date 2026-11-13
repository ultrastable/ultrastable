# IP-6 conversion deadline calendar

Filing date is not known until the provisional is filed (FUND-1, ultrastable/ops#10), so no events are created yet.
After filing: `python ip/calendar/deadlines.py <filing-date>` writes `deadlines.ics` (deadline plus 90/60/30/7-day reminders). Import it, or have the agent create the events through a calendar connector. Closing probe: calendar events exist.
