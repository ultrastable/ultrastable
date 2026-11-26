/**
 * ultrastable-lite: lightweight request filtering and handlers (ULTRASTABLE-LITE-1, 2026-11-26).
 * Handles webmentions and other direct site operations.
 */
export function lite(request, env) {
  const url = new URL(request.url);
  
  // Handle WebMentions for reach tracking (Q-IMPROVE-webmention)
  if (url.pathname === '/webmention' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response('Invalid JSON', { status: 400 });
    }
    
    const { source, target } = body;
    
    // Validate required fields
    if (!source || !target) {
      return new Response('source and target required', { status: 400 });
    }
    
    // Validate target domain matches site
    const siteDomains = ['ultrastable.io', 'ultrastable.app', 'ultrastable.net'];
    if (!siteDomains.includes(new URL(target).hostname)) {
      return new Response('Target domain is not ultrastable', { status: 400 });
    }
    
    // Verify target exists in source content (Webmention spec)
    let sourceContent;
    try {
      sourceContent = await fetch(source);
      if (!sourceContent.ok) {
        return new Response('Source fetch failed', { status: 400 });
      }
      const text = await sourceContent.text();
      if (!text.includes(target)) {
        return new Response('Source does not link to target', { status: 400 });
      }
    } catch (e) {
      return new Response('Source fetch error', { status: 400 });
    }
    
    // Consume and store the signal
    // Write to site_data to track external referrals as reach
    // poller/ranker can use this coll="webmentions" later
    if (env.DB) {
      try {
        env.DB.prepare(
          "INSERT INTO site_data (site, coll, at, data) VALUES (?, ?, ?, ?)"
        )
        .bind("ultrastable.io", "webmentions", new Date().toISOString(), source)
        .run();
      } catch (dbErr) {
        // Store non-critical if DB is busy; system continues
        console.error("Db write failed", dbErr);
      }
    }
    
    // Return acceptance
    return new Response('Webmention accepted', { status: 202 });
  }
  
  return new Response('Not Found', { status: 404 });
}
