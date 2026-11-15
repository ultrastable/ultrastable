// LIVE-1: with PUBLIC_HEALTH_ONLY=1 a runtime answers GET /health (the last tick's report) and the signed GitHub webhook, and nothing else,
// so its liveness can be read by a dashboard or a parent system while its backlog, screens and agent surfaces stay private.
export function hiddenByHealthOnly(env, method, pathname) {
  if (!env || env.PUBLIC_HEALTH_ONLY !== '1') return false;
  if (pathname === '/health' && method === 'GET') return false;
  if (pathname === '/hook/github' && method === 'POST') return false;
  if (pathname === '/pulse/watch' && method === 'POST') return false;  // LOOPPROOF-1: the second producer; it only runs a tick when the newest one is stale
  return true;
}
