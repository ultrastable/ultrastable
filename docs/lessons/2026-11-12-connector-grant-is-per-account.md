# Connector grant is per account

Date: 2026-11-12
Kind: lesson
Session: session_0156nqDsKJeaUwp76zyz87oo

Probe 2026-11-12: the Cloudflare login is an accepted member of account 81e3 (GET /memberships) but the connector token is scoped to edb167b7 only (403 on 81e3). Reconnecting and selecting the account fixes it; no credential minting needed.
