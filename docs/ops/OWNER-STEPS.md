# Owner steps

Superseded 2026-11-12 (owner directive: no cards, one status surface). The only list of what a person must do is [NEEDS-YOU.md](../../NEEDS-YOU.md), rendered from `foundation/data/needs-you.json`. Each owner-only step is still encoded as a chain of autonomous routes in `foundation/data/owner-steps.json` and run by `foundation/ownersteps.py`; a person is asked only when every route failed and the act is identity-bound, and then only as one link in NEEDS-YOU.md.
