# Org repositories

Source of truth: [repos.json](repos.json) (checked by `python3 scripts/check_org_repos.py`, drift by `--live`).

Target: five repos. `ultrastable` (private system of record), `workers` (all code), `spec` (specifications and docs), `license` (canonical license), `.github` (org profile). Six early splits (`site`, `docs`, `platform`, `ip`, `business`, `seed`) are archived as superseded duplicates; their content lives in `ultrastable` and `workers`. Archived, never deleted. All repos stay private until the license sign-off.
