// PROMOTE-1: credential-free promotion channels run by the site Worker. Ultrastable is the foundation for any autonomous system.
// IndexNow: the key is public by design (the protocol proves site ownership by serving it at /<key>.txt), so it is not a secret.
// Once a day the hourly site tick submits every sitemap URL to api.indexnow.org, which shares it with Bing, Yandex, Seznam, Naver and others.
export const INDEXNOW_KEY = "ultrastable-indexnow-7f3a9c2e4b1d";
export const SITEMAP_PATHS = ["/", "/ops", "/engineers", "/roadmap", "/product", "/how", "/showcase", "/showcase/qnfo", "/showcase/practical-solutions", "/for", "/for/founders", "/for/communities", "/for/developers", "/for/funders", "/for/partners", "/proof", "/claims", "/team", "/org", "/faq", "/contact", "/pilot", "/start", "/setup", "/privacy", "/accessibility"];
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
