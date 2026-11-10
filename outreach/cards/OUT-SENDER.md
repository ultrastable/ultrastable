# Owner card OUT-SENDER

**IDENTITY-BOUND:** a sending identity (a domain mailbox) can only be created by the owner.

**What:** register one mailbox for outreach and store the delivery endpoint as the `OUTREACH_SEND_URL` and `OUTREACH_SEND_TOKEN` secrets (binding names only; never paste values into the repo), then set `sender.registered` to true and `mode` to `live` in `outreach/gate.json` by PR.

**Default in effect:** dry-run; email-route targets are queued but nobody is contacted; form-route targets use the profile card.

**Closing probe:** a run logs `sent` for an email-route target.
