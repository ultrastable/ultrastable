# Security policy (DRAFT)

- **Report privately** to the maintainer through the repository's private vulnerability reporting once the repository is public. Until then, report to the owner directly. Do not open a public issue for a vulnerability.
- **What to include:** affected file or endpoint, steps to reproduce, impact, and any proof of concept.
- **Response targets (estimates):** acknowledge within 3 working days, assess within 10, fix or mitigate within 30 for high severity.
- **Supported versions:** the latest tagged release and `main`.
- **Out of scope:** findings that need physical access, social engineering of the maintainer, and the simulated agents bundled for demos.
- **Secrets:** never include a live credential in a report. The system never stores secret values in the repository; they are referenced by binding name.
