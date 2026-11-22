// VENDORED from ultrastable/workers core/stickiness/index.js so a seed checkout is self-contained (SEED-SELFCONTAINED-1); tests/foundation/test_failmine.py keeps it identical.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Usage and contract: core/stickiness/README.md.
// STICKY-1 (Rowan, 2026-11-22): every app, tenant and platform must give people a reason to come back: breadth, depth and diversity of content, fresh
// content on a steady rhythm, and that content promoted. Tenant-agnostic and pure: the caller supplies entries that already exist; nothing here
// invents, pads or re-dates one. A system with no entries is unmeasured, never fresh. No imports, so a seed can vendor this file unchanged.
// entry: { id, at (ISO), title, url, summary?, domain? (topic area), kind? (e.g. solution, guide, update), depth? (sources, words or sections: the tenant's unit) }
const H = 3600e3, D = 24 * H;
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export const DEFAULTS = { expect_days: 2, stall: 2, min_depth: 3, narrow_share: 0.6, thin_share: 0.5, window_days: 30, domains: [] };

export function normalize(entries) {
  const seen = new Set(), out = [];
  for (const e of entries || []) {
    const t = Date.parse(e && e.at);
    if (!e || !e.id || isNaN(t) || seen.has(e.id)) continue;
    seen.add(e.id); out.push({ ...e, at: new Date(t).toISOString() });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (x, p = 1000) => x == null ? null : Math.round(x * p) / p;
const entropy = counts => { const n = counts.reduce((a, b) => a + b, 0); if (n === 0 || counts.length < 2) return counts.length === 1 ? 0 : null; return -counts.reduce((a, c) => a + (c / n) * Math.log(c / n), 0) / Math.log(counts.length); };
const tally = xs => { const m = {}; for (const x of xs) m[x] = (m[x] || 0) + 1; return m; };

// What a returning reader finds: freshness, breadth, depth, diversity, and (when the caller can measure it) whether people actually return.
// audience (optional, the caller's own first-party counts): { visits_7d, returning_7d, feed_hits_7d, subscribers }.
export function measure(entries, { now = Date.now(), audience = null, ...cfg } = {}) {
  const c = { ...DEFAULTS, ...cfg }, all = normalize(entries), win = all.filter(e => now - Date.parse(e.at) <= c.window_days * D && Date.parse(e.at) <= now);
  const n = h => all.filter(e => now - Date.parse(e.at) <= h * H).length;
  if (!all.length) return { state: 'unmeasured', score: null, fresh: { last_at: null, hours_since: null, n_24h: 0, n_7d: 0, n_30d: 0, median_gap_days: null }, breadth: null, depth: null, diversity: null, audience: audienceOf(audience), expect_days: c.expect_days };
  const hours = (now - Date.parse(all[0].at)) / H, ts = win.map(e => Date.parse(e.at)).sort((a, b) => a - b), gaps = ts.slice(1).map((t, i) => (t - ts[i]) / D);
  const dom = tally(win.filter(e => e.domain).map(e => e.domain)), kinds = tally(win.filter(e => e.kind).map(e => e.kind)), dn = Object.values(dom);
  const declared = c.domains.length, distinct = dn.length;
  const breadth = distinct ? { domains_30d: distinct, declared, coverage: declared ? round(c.domains.filter(d => dom[d]).length / declared) : null, uncovered: c.domains.filter(d => !dom[d]) } : null;
  const top = dn.length ? Math.max(...dn) / dn.reduce((a, b) => a + b, 0) : null;
  const diversity = distinct ? { even: round(entropy(dn)), top_share: round(top), kinds: Object.keys(kinds).length, kind_even: round(entropy(Object.values(kinds))) } : null;
  const depths = win.filter(e => typeof e.depth === 'number').map(e => e.depth);
  const depth = depths.length ? { median: median(depths), thin_share: round(depths.filter(d => d < c.min_depth).length / depths.length), measured: depths.length } : null;
  const limit = c.expect_days * 24;
  let state = hours > limit * c.stall ? 'stale' : hours > limit ? 'aging' : 'fresh';
  if (state === 'fresh' && depth && depth.thin_share > c.thin_share) state = 'thin';
  if (state === 'fresh' && diversity && distinct >= 3 && diversity.top_share > c.narrow_share) state = 'narrow';
  const parts = [Math.max(0, 1 - hours / (limit * c.stall)), breadth && breadth.coverage != null ? breadth.coverage : null, depth ? 1 - depth.thin_share : null, diversity && diversity.even != null ? diversity.even : null].filter(x => x != null);
  return { state, score: round(parts.reduce((a, b) => a + b, 0) / parts.length),
    fresh: { last_at: all[0].at, hours_since: round(hours, 10), n_24h: n(24), n_7d: n(168), n_30d: win.length, median_gap_days: round(median(gaps), 100) },
    breadth, depth, diversity, audience: audienceOf(audience), expect_days: c.expect_days };
}
// Return rate is null (unmeasured) unless the caller supplied visits: a missing count is never read as zero or as good.
function audienceOf(a) {
  const sub = a && a.subscribers != null ? a.subscribers : null, fh = a && a.feed_hits_7d != null ? a.feed_hits_7d : null;
  if (!a || !(a.visits_7d > 0) || typeof a.returning_7d !== 'number') return { return_rate: null, subscribers: sub, feed_hits_7d: fh };  // no count of returning visitors: unmeasured
  return { return_rate: round(a.returning_7d / a.visits_7d), subscribers: sub, feed_hits_7d: fh };
}

// What to do about it. Every action names the metric it should move and a checkable prediction; a fresh system with no gap plans nothing but promotion.
export function plan(m, { now = Date.now(), ...cfg } = {}) {
  const c = { ...DEFAULTS, ...cfg }, out = [];
  if (m.state === 'unmeasured') return [{ kind: 'generate', why: 'no entry exists yet', metric: 'n_7d', prediction: 'n_7d >= 1 within 48 h' }];
  const want = Math.max(1, Math.ceil(7 / c.expect_days)), uncovered = (m.breadth && m.breadth.uncovered) || [];
  if (m.state === 'stale' || m.state === 'aging') out.push({ kind: 'generate', domain: uncovered[0] || null, why: `nothing new for ${m.fresh.hours_since} h against ${c.expect_days} d declared`, metric: 'n_7d', prediction: `n_7d >= ${want} within 168 h` });
  if (m.state === 'thin') out.push({ kind: 'deepen', why: `${Math.round(m.depth.thin_share * 100)}% of recent entries are under ${c.min_depth}`, metric: 'thin_share', prediction: `thin_share <= ${c.thin_share} within 168 h` });
  if (m.state === 'narrow' || (uncovered.length && m.state === 'fresh')) out.push({ kind: 'diversify', domain: uncovered[0] || null, why: uncovered.length ? `no entry in ${uncovered.join(', ')} for ${c.window_days} d` : `${Math.round(m.diversity.top_share * 100)}% of entries are one domain`, metric: 'top_share', prediction: `top_share <= ${c.narrow_share} within 336 h` });
  return out;
}

// Daily series, one row per UTC day, so a trend is read from a series and never from one snapshot (TEMPORAL-1). Upserts today's row; keeps `keep` days.
export function record(series, m, { now = Date.now(), keep = 400 } = {}) {
  const day = new Date(now).toISOString().slice(0, 10), row = { day, state: m.state, score: m.score, n_7d: m.fresh.n_7d, n_30d: m.fresh.n_30d, coverage: m.breadth ? m.breadth.coverage : null, thin_share: m.depth ? m.depth.thin_share : null, even: m.diversity ? m.diversity.even : null, return_rate: m.audience.return_rate };
  return [...(series || []).filter(r => r.day !== day), row].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-keep);
}
// Mean of `key` over the last `days` days against the `days` before; flat inside `eps`. Null when either window has no reading.
export function trend(series, key, { days = 7, eps = 0.02, now = Date.now() } = {}) {
  const cut = d => new Date(now - d * D).toISOString().slice(0, 10), mean = rs => { const v = rs.map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const a = mean((series || []).filter(r => r.day > cut(days))), b = mean((series || []).filter(r => r.day <= cut(days) && r.day > cut(2 * days)));
  if (a == null || b == null) return { direction: 'unmeasured', recent: a, before: b };
  return { direction: Math.abs(a - b) <= eps ? 'flat' : a > b ? 'rising' : 'falling', recent: round(a), before: round(b) };
}

// Feeds a returning reader can subscribe to: RSS 2.0 and JSON Feed 1.1 (with tags and the depth extension), and a "what's new" page that marks
// everything newer than the reader's last visit using only the reader's own browser storage.
export const toRss = ({ title, link, description, items }) => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(title)}</title><link>${esc(link)}</link><description>${esc(description)}</description>`
  + normalize(items).map(i => `<item><title>${esc(i.title)}</title><link>${esc(i.url)}</link><guid isPermaLink="false">${esc(i.id)}</guid><pubDate>${new Date(i.at).toUTCString()}</pubDate>${i.domain ? `<category>${esc(i.domain)}</category>` : ''}<description>${esc(i.summary)}</description></item>`).join('') + '</channel></rss>';
export const toJsonFeed = ({ title, link, description, feedUrl, items }) => ({ version: 'https://jsonfeed.org/version/1.1', title, home_page_url: link, feed_url: feedUrl, description,
  items: normalize(items).map(i => ({ id: i.id, url: i.url, title: i.title, content_text: i.summary || '', date_published: i.at, tags: [i.domain, i.kind].filter(Boolean), _depth: i.depth ?? null, _domain: i.domain ?? null, _kind: i.kind ?? null })) });
// Read a JSON Feed back into entries. The domain is `_domain`, else the first tag; a feed that carries neither leaves breadth unmeasured.
export const fromJsonFeed = feed => ((feed && feed.items) || []).map(i => ({ id: i.id || i.url, at: i.date_published, title: i.title, url: i.url, summary: i.content_text, domain: i._domain || (i.tags || [])[0] || null, kind: i._kind || null,
  depth: typeof i._depth === 'number' ? i._depth : null }));
export function whatsNew({ title, link, items, graceMin = 30, key = 'us-last-visit' }) {
  const rows = normalize(items).slice(0, 50).map(i => `<li data-at="${esc(i.at)}"><a href="${esc(i.url)}">${esc(i.title)}</a>${i.domain ? ` <small>${esc(i.domain)}</small>` : ''} <time datetime="${esc(i.at)}">${esc(i.at.slice(0, 10))}</time>${i.summary ? `<p>${esc(i.summary)}</p>` : ''}</li>`).join('');
  const js = `(function(){try{var k=${JSON.stringify(key)},g=${Number(graceMin)}*6e4,now=Date.now(),raw=JSON.parse(localStorage.getItem(k)||'null')||{},prev=raw.prev||0,last=raw.last||0;if(last&&now-last>g){prev=last}var n=0;document.querySelectorAll('[data-at]').forEach(function(el){if(prev&&Date.parse(el.getAttribute('data-at'))>prev){el.classList.add('is-new');n++}});var o=document.getElementById('since');if(o){o.textContent=!prev?'First visit on this device. Next time this line counts what is new.':n+' new since your last visit.'}localStorage.setItem(k,JSON.stringify({prev:prev,last:now}))}catch(e){}})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>What's new: ${esc(title)}</title><link rel="alternate" type="application/rss+xml" href="${esc(link)}/feed.xml"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:42rem;margin:0 auto;padding:1rem 16px}li{margin:1rem 0;list-style:none}.is-new{border-left:4px solid currentColor;padding-left:.75rem}</style></head><body><h1>What's new</h1><p id="since"></p><ul>${rows}</ul><script>${js}</script></body></html>`;
}

// Social queue in the shape the core social module drains ({ posts: [{ id, date, text, texts, kind, arm }] }). Entries not yet promoted (not in `posted`)
// and newer than `since_days` become at most `max_per_day` posts a day, in plain words: the entry's own title and a line from its own summary, a link,
// and the tenant's `reveal` line. No hashtags, no emoji, no claim the entry does not make. `voice` is the tenant's: an array of openers.
export function queue(entries, { now = Date.now(), posted = [], max_per_day = 2, since_days = 14, reveal = '', voice = ['New:', 'Just added:', 'Worth a read:', 'Fresh this week:'], arm = 'sticky', limit = 300 } = {}) {
  const done = new Set(posted), h = s => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0; return x; };
  const due = normalize(entries).filter(e => !done.has(e.id) && e.url && now - Date.parse(e.at) <= since_days * D).reverse(), posts = [], skipped = [];
  due.forEach((e, i) => {
    const day = new Date(now + Math.floor(i / max_per_day) * D).toISOString().slice(0, 10), open = voice[h(e.id) % voice.length];
    const line = String(e.summary || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || '', tail = [e.url, reveal].filter(Boolean).join('\n');
    const room = limit - tail.length - 1, full = `${open} ${e.title}${line && line !== e.title ? '. ' + line : ''}`, bare = `${open} ${e.title}`;
    // A post is never cut: it uses the title and one whole sentence if they fit, the title alone if not, and is left out (and counted) if even that does not fit.
    const body = full.length <= room ? full : bare.length <= room ? bare : null;
    if (body == null) { skipped.push(e.id); return; }
    posts.push({ id: `${arm}:${e.id}`, date: day, kind: 'entry', arm, text: body + '\n' + tail, entry: e.id, ...(e.grade ? { grade: e.grade } : {}) });  // the entry's evidence grade travels with the post so the social quality gate (POST-QUALITY-1) can hold an overclaim
  });
  return { posts, skipped };
}
