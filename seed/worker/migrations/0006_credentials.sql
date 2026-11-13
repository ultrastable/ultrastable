-- AUTH-1: per-tenant credential material for every provider (GitHub App, OAuth, Cloudflare). Sensitive fields are sealed (AES-GCM, key CREDENTIAL_KEY);
-- short-lived access tokens are cached with their expiry so the tick refreshes before they lapse. Nothing here is ever logged.
CREATE TABLE IF NOT EXISTS credentials (
  tenant TEXT NOT NULL,
  provider TEXT NOT NULL,                  -- github-app | oauth:<name> | cloudflare
  sealed TEXT,                             -- sealed JSON: app private key, client secret, refresh token
  meta TEXT NOT NULL DEFAULT '{}',         -- non-secret JSON: app id, slug, installation id, scopes
  access_sealed TEXT,                      -- sealed cached access token
  expires_at TEXT,                         -- when the cached access token lapses
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | ok | refreshing | failed
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (tenant, provider)
);
CREATE TABLE IF NOT EXISTS credential_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  tenant TEXT NOT NULL, provider TEXT NOT NULL,
  event TEXT NOT NULL,                     -- minted | refreshed | expiring | failed | consent
  detail TEXT
);
CREATE INDEX IF NOT EXISTS credential_events_at ON credential_events (at);
