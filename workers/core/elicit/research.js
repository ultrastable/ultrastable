// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Cited research for system-unknowns (US-SPEC-16 R01, R27, R30): a research adapter that reads the public pages a Need declares through a fetch port and returns
// { value, sources: [{ url, title }] } only when a page answered 200 and says one thing, and a verifier that reads the cited page again later. Ports only: fetch, db.
// No network is reached here; a deployment passes its own fetch. The live act (real pages, real network) is a host's, and tests use a fake fetch.
const MAX_BYTES = 200000;
const FREE_TEXT_MAX = 200;
/** The closing probe of the live act of R27: a researched Need whose cited source answered 200 when the verifier read it back. */
export const RESEARCH_PROBE = `SELECT COUNT(*) FROM elicit_needs n WHERE n.provenance='researched' AND n.state='derived' AND EXISTS (SELECT 1 FROM elicit_derivations d WHERE d.project=n.project AND d.need_id=n.id AND d.surface='research_verify' AND d.result='hit' AND d.detail = '200 ' || n.source)`;
const https = u => { try { const x = new URL(String(u)); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; } };
const href = u => { try { return new URL(String(u)).href; } catch { return null; } };
const compile = (src, flags) => { try { return new RegExp(String(src), flags); } catch { return null; } };

/** Read one declared source: the text of a page that answered 200, or { status, error }. A page is never trusted past its size cap. Redirects are not followed: a 3xx
 *  says nothing, and a response that reports it was redirected, or that came from another URL than the one declared, is not the declared page and says nothing either. */
async function read(fetchFn, url) {
  let res;
  try { res = await fetchFn(url, { method: 'GET', redirect: 'manual', headers: { accept: 'text/html,text/plain,application/json;q=0.9' } }); } catch (e) { return { error: String(e?.message || e).slice(0, 160) }; }
  if (res && (res.redirected === true || (typeof res.url === 'string' && res.url !== '' && href(res.url) !== href(url)))) return { status: res.status ?? null, error: `answered from ${String(res.url || 'a redirect').slice(0, 120)}, not the declared page` };
  if (!res || res.status !== 200) return { status: res?.status ?? null };
  try { return { status: 200, text: String(await res.text()).slice(0, MAX_BYTES) }; } catch (e) { return { status: 200, error: String(e?.message || e).slice(0, 160) }; }
}

/** What one page says about one Need: the single option whose pattern it matches (two different options in one page is ambiguous and says nothing), or, for a free-text
 *  Need, the first capture of `extract`. null when it says nothing. */
function valueOf(need, source, text) {
  if (need.free_text) {
    const m = source.extract ? compile(source.extract, 'i')?.exec(text) : null;
    const v = (m?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, FREE_TEXT_MAX);
    return v || null;
  }
  const options = JSON.parse(need.options || '[]');
  const hits = options.filter(o => { const re = compile(source.options?.[o], 'i'); return re && re.test(text); });
  return hits.length === 1 ? hits[0] : null;
}

/** The research port of `derive`. sources: { <need_id>: [{ url, title?, options?: { <option>: <regex source> }, extract?: <regex source with one capture> }] }.
 *  Only https pages are read; a page that does not answer 200, throws, or says two different things is skipped. Two pages that disagree return nothing: it never guesses.
 *  The result cites exactly the pages that said the value. */
export function createResearch({ fetch: fetchFn, sources = {} } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('the research adapter needs a fetch port');
  return async need => {
    const found = [];
    for (const s of sources[need.id] || []) {
      if (!https(s?.url)) continue;
      const page = await read(fetchFn, s.url);
      if (page.status !== 200 || page.error || typeof page.text !== 'string') continue;
      const value = valueOf(need, s, page.text);
      if (value != null) found.push({ value, url: s.url, title: s.title || null });
    }
    const values = new Set(found.map(f => f.value));
    if (values.size !== 1) return null; // nothing found, or the sources disagree
    return { value: found[0].value, sources: found.map(f => ({ url: f.url, title: f.title })) };
  };
}

/** Read every researched Need's cited source again (R27). A page that answers 200 is recorded as a hit (surface `research_verify`). A page that is gone (404 or 410) contradicts
 *  the value: the Need returns to open with the evidence named (R31) and is asked again. Any other outcome (a network error, a 5xx, a 429, a redirect) is recorded as an error and
 *  changes nothing: an unreadable source is unmeasured, never proof. With `every_hours` a source read back within that many hours is not read again (counted in `skipped`).
 *  Returns { checked, ok, reopened, unreadable, skipped }. */
export async function verifyResearched({ db, elicit, fetch: fetchFn, now = () => Date.now(), every_hours = null }, project) {
  const out = { checked: 0, ok: [], reopened: [], unreadable: [], skipped: 0 };
  const rows = (await db.prepare(`SELECT id, source FROM elicit_needs WHERE project=? AND state='derived' AND provenance='researched' AND source LIKE 'https://%'`).bind(project).all()).results || [];
  const clock = typeof now === 'function' ? now : () => now;
  const log = (id, result, detail) => db.prepare(`INSERT INTO elicit_derivations (project, need_id, surface, result, detail, at) VALUES (?,?,?,?,?,?)`).bind(project, id, 'research_verify', result, detail, new Date(clock()).toISOString()).run();
  const since = every_hours !== null && Number(every_hours) > 0 ? new Date(clock() - Number(every_hours) * 3600e3).toISOString() : null;
  for (const r of rows) {
    if (since && (await db.prepare(`SELECT MAX(at) AS at FROM elicit_derivations WHERE project=? AND need_id=? AND surface='research_verify'`).bind(project, r.id).first())?.at > since) { out.skipped++; continue; }
    out.checked++;
    const page = await read(fetchFn, r.source);
    if (page.status === 200 && !page.error) { await log(r.id, 'hit', `200 ${r.source}`); out.ok.push(r.id); continue; }
    if (page.status === 404 || page.status === 410) {
      await log(r.id, 'miss', `${page.status} ${r.source}`);
      const c = await elicit.contradict(project, r.id, { evidence: `the cited source ${r.source} answered ${page.status} when read back`, source: 'research' });
      if (c.ok) out.reopened.push(r.id);
      continue;
    }
    await log(r.id, 'error', `${[page.status, page.error].filter(x => x != null).join(' ') || 'no answer'} ${r.source}`);
    out.unreadable.push(r.id);
  }
  return out;
}
