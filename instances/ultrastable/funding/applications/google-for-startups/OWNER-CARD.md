# Owner card: submit the Google for Startups Cloud Program application (identity-bound)

What: the form sits behind a Google sign-in and needs a company-domain email, a Google Cloud billing account ID owned by that account, a live site with team and product content, and typed attestations as the applicant. Those are the owner's identity, so no agent signs in or attests for them.

Prepared: all answers (`packet.json`, `ANSWERS.md`), the submit steps, the weekly tracker. Once `applicant.json` is filled, `python3 scripts/funding_packet.py` reports `ready` and prints the exact paste order.

Fewest steps: (1) create the company-domain account and billing account, (2) put the five values into `applicant.json`, (3) sign in at the form URL and paste. Nothing else is needed.

Default in effect: not submitted; the tracker re-checks weekly. Closing probe: `confirmations/` holds Google's email and `packet.json` status is `submitted`.
