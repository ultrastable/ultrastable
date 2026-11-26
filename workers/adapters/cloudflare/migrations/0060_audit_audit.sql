-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
-- AUDIT-1: hot events (recent, hash-chained), one anchor row per rolled day, and a tiny key/value meta table. Only the primary key is indexed
-- on events, so an append writes one row. Older days are rolled into one compressed batch each (audit_days) and their event rows deleted.
CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY, day TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', pay TEXT NOT NULL DEFAULT '', prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_days (day TEXT PRIMARY KEY, first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL, n INTEGER NOT NULL, first_prev TEXT NOT NULL, last_hash TEXT NOT NULL, root TEXT NOT NULL, prev_day TEXT NOT NULL, day_hash TEXT NOT NULL, kinds TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, blob_sha TEXT NOT NULL DEFAULT '', archive_key TEXT NOT NULL DEFAULT '', blob TEXT, pruned INTEGER NOT NULL DEFAULT 0, rolled_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
