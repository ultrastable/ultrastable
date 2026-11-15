// Probe for ITEM ZERO-MINUTES-1 step (1): runs after the owner clicks
// "Connect GitHub" on the Worker's GitHub App. Exits 0 only when the
// Worker can actually see the org and merge green PRs with no lane run.
// Usage: node scripts/probe_worker_merge.mjs
// Requires: WRANGLER (for `wrangler d1 execute`) or direct D1 binding in Workers context.
import { execFileSync } from 'node:child_process';

function fail(msg) {
  console.error(`PROBE FAIL: ${msg}`);
  process.exit(1);
}

// 1. Sweeper health: latest sweeper_runs row must be status=ok, not the
//    measured 404 state from 2026-11-13.
let rows;
try {
  rows = JSON.parse(
    execFileSync('wrangler', [
      'd1', 'execute', 'sweeper-db', '--json', '--command',
      "SELECT status, repo, ran_at FROM sweeper_runs ORDER BY ran_at DESC LIMIT 5",
    ]).toString(),
  );
} catch (e) {
  fail(`cannot read sweeper_runs: ${e.message}`);
}
const latest = rows?.[0]?.results?.[0];
if (!latest) fail('no sweeper_runs rows at all');
if (latest.status !== 'ok')
  fail(`latest sweeper status=${latest.status} (${latest.repo} at ${latest.ran_at}) — App still cannot see the org`);

// 2. Merge evidence: the done-check file must show at least one merge
//    whose provenance is the Worker and with no lane run attached.
let evidence;
try {
  evidence = (await import('node:fs/promises'))
    .readFile(new URL('../ops/worker-merge-evidence.jsonl', import.meta.url), 'utf8')
    .then((t) => t.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
} catch (e) {
  fail(`cannot read ops/worker-merge-evidence.jsonl: ${e.message}`);
}
const workerMerge = evidence.find(
  (e) => e.provenance_host === 'cloudflare-worker' && e.lane_run_id == null,
);
if (!workerMerge)
  fail('no green PR merged by the Worker without a lane run in ops/worker-merge-evidence.jsonl');

// 3. No parallel Actions lane run for that merge.
const runs = JSON.parse(
  execFileSync('gh', [
    'run', 'list', '--workflow=lane.yml', '--limit', '20', '--json',
    'databaseId,headBranch,conclusion,createdAt',
  ]).toString(),
);
const overlap = runs.find(
  (r) => r.headBranch === workerMerge.branch &&
    Math.abs(new Date(r.createdAt) - new Date(workerMerge.merged_at)) < 15 * 60 * 1000,
);
if (overlap) fail(`lane run ${overlap.databaseId} ran alongside a Worker merge — trigger not yet Worker-only`);

console.log(`PROBE OK: sweeper status=ok, Worker merged ${workerMerge.pr} with no lane run`);
process.exit(0);
