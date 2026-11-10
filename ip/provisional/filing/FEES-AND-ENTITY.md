# Fee and entity status (self-filer)

Not legal advice. Fees are from the USPTO schedule effective 2025-01-19 and must be confirmed on the Patent Center fee screen on the filing day (the screen shows the exact total before you pay).

| Status | Provisional filing fee |
|---|---|
| Micro entity | $65 |
| Small entity | $130 |
| Undiscounted | $325 |

The application size fee (37 CFR 1.16(s), MPEP 607) applies to provisionals too: it is charged for each 50 sheets, or part of 50, beyond 100 sheets of specification plus drawings. This package is held at 100 sheets (specification 83 + drawings 17), so no size fee is due; `tools/preflight.py` fails the build if the total ever exceeds 100. Expect a single charge of $65 to $325.

## Which status

- **Micro entity** needs all of these to be true for Rowan on the filing day: (1) qualifies as a small entity, (2) named on no more than four previously filed US non-provisional applications (provisionals and foreign filings do not count), (3) gross income last calendar year below the USPTO's micro-entity income limit (the screen and form PTO/SB/15A state the current figure), (4) has not assigned, licensed or is under obligation to assign or license to an entity that fails the income test.
- **Small entity** applies if Rowan has not assigned or licensed the invention to a large entity (500 or more employees). The QNFO licence v2.1 is a non-commercial licence of the QNFO repository; it is not an assignment of this invention. The attorney can confirm.
- Claiming a status you do not qualify for can invalidate later rights. When unsure, choose small entity ($130); the $65 difference is small compared with the risk.
- If the legal entity is formed and the IP assigned before filing, entity status is judged on the entity too. Filing in Rowan's own name today and assigning later is allowed.

## Payment

Card or USPTO deposit account in Patent Center. The filing receipt (application number, filing date, confirmation number) is available immediately; record it in `ip/evidence-log.md` and close the owner cards FUND-1 and IP-5.
