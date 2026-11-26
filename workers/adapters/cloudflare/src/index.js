// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Ultrastable Worker: the server-side runtime for one org. Cron (or, when the account refuses cron, the Heartbeat
// Durable Object alarm) runs one tick of every loop (core/org), once per slot whichever scheduler fires; fetch serves /health,
// /console, /describe, /describe.json and /llms.txt. The logic is in worker.js; this file only binds it to the rendered config.js.
import config from './config.js';
import { createWorker } from './worker.js';

const worker = createWorker(config);

export const Heartbeat = worker.Heartbeat;
export default worker.handler;
