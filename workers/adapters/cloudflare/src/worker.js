// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The Worker, built from a configuration (US-SPEC-03 R16). index.js binds it to the rendered config.js, which a fresh clone does not have; this file
// takes the configuration as an argument, so tests and other hosts build the same Worker without it.
//   createWorker(config, { now }) -> { Heartbeat, handler: { scheduled, fetch }, orgFor }
// Both schedulers run the same guarded entry, org.scheduledTick(): the cron firing and the Heartbeat alarm claim one slot between them
// (adapters/shared/slot.js), so a cron and an alarm that fire in the same ten minutes run one tick, and a scheduler that fires twice runs once.
import { createOrg } from '../../../core/org/index.js';
import { githubPullReader } from '../../github/pulls.js';
import { createHeartbeat, ensureArmed } from './heartbeat.js';

export function createWorker(config, { now } = {}) {
  // The ports a Cloudflare host builds for the organization: the GitHub REST reading of a pull request (core/claims releases a claim when its pull request merges).
  const orgFor = env => createOrg({ db: env.DB, env, config, ports: { pullReader: githubPullReader }, ...(now ? { now } : {}) });

  const Heartbeat = createHeartbeat(env => orgFor(env).scheduledTick());

  const handler = {
    async scheduled(_event, env, ctx) {
      ctx.waitUntil(orgFor(env).scheduledTick()); // one tick per slot: a cron firing twice runs once
    },

    async fetch(request, env) {
      await ensureArmed(env); // alarm mode: any visit makes sure the heartbeat is armed
      return (await orgFor(env).handle(request))
        ?? new Response('ultrastable worker\n', { status: 404, headers: { 'content-type': 'text/plain' } });
    },
  };

  return { Heartbeat, handler, orgFor };
}
