// LIVE-1: with PUBLIC_HEALTH_ONLY=1 a runtime answers GET /health (the last tick's report) the signed GitHub webhook and the watcher's /internal/pulse, and nothing else,
// so its liveness can be read by a dashboard or a parent system while its backlog, screens and agent surfaces stay private.
export function hiddenByHealthOnly(env, method, pathname) {
  if (!env || env.PUBLIC_HEALTH_ONLY !== '1') return false;
  if (pathname === '/health' && method === 'GET') return false;
  if (pathname === '/hook/github' && method === 'POST') return false;
  if (pathname === '/internal/pulse') return false;  // PULSE-1: the outside watcher must reach a health-only runtime too; it answers liveness figures only
  return true;
}
