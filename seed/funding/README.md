# Funding registry

`registry.json` (created from `registry.template.json` on first bootstrap, never overwritten) lists credit, grant and funding programs. Each item: `id`, `track`, `name`, `url`, `amount`, `deadline` (ISO date or null), `status` (verified | secondary | unverified), `last_verified`, `notes`.

- `verify.py [--fetch] [--today YYYY-MM-DD] [--out report.json]` flags stale, unverified, expiring, passed and unreachable entries.
- `file_issues.py report.json` files or updates one open issue per (program, kind) with label `funding-maintenance`.
- `.github/workflows/funding-maintenance.yml` runs both every Monday 07:00 UTC.
