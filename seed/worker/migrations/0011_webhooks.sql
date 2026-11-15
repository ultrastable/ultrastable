-- WEBHOOKS-1: outbound subscriptions (CloudEvents, Standard Webhooks signing), delivery log, inbound hook registry and replay guard. Mirrors DDL in site/webhooks.js, which also creates these on first use.
CREATE TABLE IF NOT EXISTS webhook_subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '*', description TEXT, salt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, failures INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, subject TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_deliveries (id TEXT PRIMARY KEY, sub_id TEXT NOT NULL, event_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, http_status INTEGER, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (status, next_at);
CREATE TABLE IF NOT EXISTS webhook_inbound (provider TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_seen (provider TEXT NOT NULL, msg_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (provider, msg_id));
CREATE TABLE IF NOT EXISTS webhook_state (k TEXT PRIMARY KEY, v TEXT);
