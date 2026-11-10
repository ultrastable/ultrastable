# Funding application packets

One folder per program, keyed by the `id` in `../registry.json`. Each folder holds `packet.json` (machine-readable: answers, prerequisites, submit steps, status) and `ANSWERS.md` (the same answers for reading and pasting). `scripts/funding_packet.py` validates every packet against the registry, checks that answers carry no banned claims, and writes `STATUS.md`. The weekly `funding-maintenance` workflow runs it and files an issue for every packet that is stale, blocked past its probe, or failing validation.

Statuses: `drafted` (answers done, not submittable yet), `ready` (all prerequisites met, only the identity-bound submit remains), `submitted` (confirmation filed under `confirmations/`), `decided`, `rejected`.

Adding a program: copy `_template/packet.json`, set `registry_id`, fill answers from primary sources, run `python3 scripts/funding_packet.py`.

Rules: truthful, generic, no financial claims, no QNFO or research framing, nothing about patents, no mechanism details, no prior-publication statements. Applicant identity (entity, email, signature, attestations, sign-in) is never invented; it comes from `applicant.json`, which the owner card fills.
