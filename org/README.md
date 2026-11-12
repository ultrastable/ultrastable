# Org repositories

Source of truth: [repos.json](repos.json) (checked by `python3 scripts/check_org_repos.py`, drift by `--live`).

Target: four repos. `ultrastable` (private system of record), `workers` (all code), `spec` (specifications, docs, license), `.github` (org profile). `license` (folded into spec) and six early splits (`site`, `docs`, `platform`, `ip`, `business`, `seed`) are archived as superseded duplicates; their content lives in `ultrastable` and `workers`. Archived, never deleted. All repos stay private until the license sign-off.
