// PROMOTE-1: credential-free promotion channels run by the site Worker. Ultrastable is the foundation for any autonomous system.
// IndexNow: the key is public by design (the protocol proves site ownership by serving it at /<key>.txt), so it is not a secret.
// Once a day the hourly site tick submits every sitemap URL to api.indexnow.org, which shares it with Bing, Yandex, Seznam, Naver and others.
export const INDEXNOW_KEY = "ultrastable-indexnow-7f3a9c2e4b1d";
// REACH-PAPERS-1: papers are in the sitemap and the IndexNow list, so search engines find each one the day it is written.
import RESEARCH_DATA from "./research-data.js";
export const SITEMAP_PATHS = ["/", "/directory", "/ops", "/engineers", "/roadmap", "/decisions", "/goals", "/progress", "/left-alone", "/product", "/how", "/showcase", "/showcase/qnfo", "/showcase/practical-solutions", "/for", "/for/founders", "/for/communities", "/for/developers", "/for/funders", "/for/partners", "/claims", "/team", "/org", "/faq", "/contact", "/pilot", "/start", "/setup", "/privacy", "/accessibility", "/research", ...RESEARCH_DATA.papers.map(p => "/research/" + p.slug)];
export const DAY_MS = 23 * 3600e3;

export function keyFile(pathname) {
  return pathname === "/" + INDEXNOW_KEY + ".txt" ? new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8" } }) : null;
}

// last: ISO time of the previous submission or null. Returns the record to store, or null when not due.
export async function indexNow({ host, fetchFn, now = new Date(), last = null }) {
  if (last && now - new Date(last.at) < DAY_MS && last.ok) return null;
  const body = { host, key: INDEXNOW_KEY, keyLocation: "https://" + host + "/" + INDEXNOW_KEY + ".txt", urlList: SITEMAP_PATHS.map(p => "https://" + host + p) };
  try {
    const r = await fetchFn("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    return { at: now.toISOString(), status: r.status, ok: r.status === 200 || r.status === 202, urls: body.urlList.length };
  } catch (e) {
    return { at: now.toISOString(), status: 0, ok: false, error: String(e).slice(0, 200) };
  }
}

// ATTENTION-1 (Rowan, 2026-11-20): more credential-free reach, all from this Worker's own clock. Evidence, never targeting: nothing here names,
// replies to or mentions a person; it only makes the public record easier to find, subscribe to and verify.
// WebSub: the feeds declare a public hub, and once a day the tick tells the hub they changed, so feed readers that subscribed get the update pushed.
export const WEBSUB_HUB = "https://pubsubhubbub.appspot.com/";
export const FEED_PATHS = ["/feed.xml", "/progress.atom"];
export async function webSub({ host, fetchFn, now = new Date(), last = null }) {
  if (last && now - new Date(last.at) < DAY_MS && last.ok) return null;
  const res = {};
  for (const p of FEED_PATHS) {
    try {
      const r = await fetchFn(WEBSUB_HUB, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ "hub.mode": "publish", "hub.url": "https://" + host + p }).toString() });
      res[p] = r.status;
    } catch (e) { res[p] = 0; }
  }
  return { at: now.toISOString(), status: res, ok: Object.values(res).every(s => s === 204 || s === 200 || s === 202) };
}

// Third-party evidence: one public page a day is snapshotted by the Internet Archive (anonymous Save Page Now, well inside its rate limit), so the
// record of what the system shipped and checked has timestamped copies that this system cannot edit afterwards. Pages rotate by day.
export const ARCHIVE_PATHS = ["/progress", "/claims", "/live", "/showcase/practical-solutions", "/goals"];
export async function archiveEvidence({ host, fetchFn, now = new Date(), last = null }) {
  if (last && now - new Date(last.at) < DAY_MS) return null;
  const path = ARCHIVE_PATHS[Math.floor(now.getTime() / 864e5) % ARCHIVE_PATHS.length];
  try {
    const r = await fetchFn("https://web.archive.org/save/https://" + host + path, { method: "GET", redirect: "manual", headers: { "user-agent": "ultrastable-site (+https://" + host + "/contact)" } });
    return { at: now.toISOString(), path, status: r.status, ok: r.status < 400 };
  } catch (e) {
    return { at: now.toISOString(), path, status: 0, ok: false, error: String(e).slice(0, 200) };
  }
}

// Reach measurement from inside the Worker (its own D1 binding), so the reach loop is measured even when the CI token cannot read D1.
// Counts only, grouped by referring host and path over 7 days: no address, no agent string, no person. Computed at most once a day (one scan) and
// served from KV at /api/reach; foundation/reach.py classifies the hosts with doctrine/reach.json, so the rules live in one place.
export async function reachRows(db, now = new Date()) {
  const since = Math.floor(now.getTime() / 1000) - 7 * 86400;
  const r = await db.prepare("SELECT ref, path, name, bot, count(*) AS n FROM hits WHERE at >= ? AND (bot = 0 OR path = '/feed.xml' OR path = '/progress.atom') GROUP BY ref, path, name, bot ORDER BY n DESC LIMIT 3000").bind(since).all();
  return { at: now.toISOString(), window_days: 7, rows: (r.results || []).map(x => ({ ref: x.ref || "", path: x.path, name: x.name, bot: x.bot ? 1 : 0, n: x.n })) };
}
