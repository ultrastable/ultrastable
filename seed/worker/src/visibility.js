// LIVE-1: with PUBLIC_HEALTH_ONLY=1 a runtime answers GET /health (the last tick's report), a public page at / (FULLSTACK-1), the public reads below (COLDSTART-1) and the signed GitHub webhook, and nothing else,
// so its liveness can be read by a dashboard or a parent system while its backlog, screens and agent surfaces stay private.
// COLDSTART-1: the standing rules make some public reads part of every system from birth, health-only or not: the discovery manifest
// (DISCOVER-1: the directory lists a site only after reading it), the knowledge graph's public view (DATAGRAPH-1: counts and declared public
// kinds only without the owner's bearer), progress (PROGRESS-1) and stickiness with its social queue (STICKY-1). Each is read-only and shows
// nothing private. doctrine/coldstart.json names the same paths and `python3 -m foundation coldstart --check` fails when the two differ.
// FLEET-CONTRACT-1 adds the statements (/claims.json) and the system's own social queue (empty, with the reason, until it has public content).
export const PUBLIC_CONTRACT = Object.freeze(['/claims.json', '/social-queue.json']);
export const PUBLIC_READS = Object.freeze(['/.well-known/ultrastable.json', '/api/graph', '/api/graph/insights', '/api/graph/search', '/api/graph/node', '/graph', '/api/progress', '/api/stickiness', ...PUBLIC_CONTRACT]);
const STICKY_QUEUE = /^\/api\/stickiness\/queue\/[a-z0-9-]{1,60}\.json$/;
export function hiddenByHealthOnly(env, method, pathname) {
  if (!env || env.PUBLIC_HEALTH_ONLY !== '1') return false;
  if (method === 'GET' && (PUBLIC_READS.includes(pathname) || STICKY_QUEUE.test(pathname))) return false;
  if (pathname === '/health' && method === 'GET') return false;
  if (pathname === '/' && method === 'GET') return false;  // FULLSTACK-1: the public page below; it shows nothing the health report does not
  if (pathname === '/hook/github' && method === 'POST') return false;
  if (pathname === '/hook/cloudflare' && method === 'POST') return false;  // CF-ALERTS-1: Cloudflare's alert webhook, verified by its own secret
  if (pathname === '/pulse/watch' && method === 'POST') return false;  // LOOPPROOF-1: the second producer; it only runs a tick when the newest one is stale
  return true;
}

// BOOT-ACCEPT-1 (Rowan, 2026-11-25: "all surfaces ... everything has to work together automatically and seamlessly from the beginning"). The gate above
// once hid the discovery manifest (DISCOVER-1) and the knowledge graph's read side (DATAGRAPH-1) on every seed and every visitor app, because each was
// added after the gate and nothing proved them together. These reads are public by design: the manifest names nothing private, and the graph's read
// side shows only counts and declared public kinds without the owner's bearer. foundation/bootaccept.py reads each one live after every launch.

// FULLSTACK-1: every system has a public front end. A health-only system serves this page at /: its name, whether its clock is turning and the
// stage it read for itself. No backlog, no screens, no owner routes. Every value comes from the same rows /health reads.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function publicPage({ name, last, ignition, footer = '', statements = '', head = '' }) {  // footer: DISCOVER-1's "Built on Ultrastable" line (discover.js footerHtml); statements: FLEET-CONTRACT-1's sentences for this page
  const done = Boolean(last && last.steps_completed === last.steps_total), when = last && (last.finished_at || last.started_at);
  const title = esc(String(name || 'system').replace(/-/g, ' '));
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${head}`
    + '<style>:root{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:2rem 1rem}h1{font-size:1.6rem;text-transform:capitalize}dt{font-weight:600;margin-top:1rem}dd{margin:0}a{display:inline-block;padding:.75rem 0;min-height:44px}</style></head><body>'
    + `<main><h1>${title}</h1><p>This system runs itself on Ultrastable. Its managers work on a clock, with nobody in the loop.</p><dl>`
    + `<dt>Clock</dt><dd>${when ? (done ? 'Last pass finished ' : 'Last pass started ') + esc(when) : 'No pass has run yet.'}</dd>`
    + `<dt>Stage</dt><dd>${ignition && ignition.stage ? esc(ignition.stage) : 'Not read yet.'}</dd></dl>`
    + '<p><a href="/health">The full health report</a><br><a href="https://ultrastable.io">Ultrastable is the foundation for any autonomous system.</a></p>' + statements + '</main>' + footer + '</body></html>';
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
