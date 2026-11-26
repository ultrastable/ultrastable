// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// USER-BACKEND-1 (Rowan, 2026-11-17): the user does their idea and their front end; the system does everything behind it (errors,
// credentials, deploys, identity, retries). Backend detail is recorded for the owner-only audit log and never reaches a user-facing
// response. Every Worker (site, dashboard, tenants, spinoffs, the seed tick) imports this one module; a copy is a defect that
// `python3 -m foundation userbackend --check` fails.
//
//   say(message, status)           an error whose text is written for people: the only kind that may reach a user as is
//   plain(e)                       { code, status, message } safe to send to a user, whatever e is
//   userError(e, where, opts)      records the full backend detail (console + opts.audit) and returns plain(e) as { ok:false, code, error } plus the
//                                  RFC 9457 members { type, title, status, detail, instance }
//   userJson(e, where, opts)       the same as an application/problem+json Response
//   backendRecord(e, where, opts)  record only
export class UserFacing extends Error {
  constructor(message, status = 400, code = 'bad_request') { super(message); this.userSafe = true; this.status = status; this.code = code; }
}
export const say = (message, status = 400, code) => new UserFacing(message, status, code);

const WORDS = {
  limit: ['The service is resting until its daily allowance resets. Nothing is lost; it continues by itself.', 503],
  timeout: ['That took too long. The system will try again by itself.', 504],
  network: ['A connection did not answer. The system will try again by itself.', 502],
  auth: ['Please sign in again.', 401],
  not_found: ['That could not be found.', 404],
  bad_request: ['That could not be used. Please check it and try again.', 400],
  internal: ['Something went wrong on our side. The system has recorded it and will retry by itself.', 500],
};
// RFC 9457 (Problem Details for HTTP APIs): every error body the shared path sends is application/problem+json with type, title, status, detail and
// instance beside the fields callers already read (ok, code, error). `type` is a stable tag URI per problem code (not a page to fetch), `title` never
// changes for a code, `detail` is the person-readable message, `instance` names this one occurrence and is the id on the owner-only backend record.
export const PROBLEM_TYPE = 'tag:ultrastable.io,2026:problem:';
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';
const TITLES = { limit: 'Daily allowance reached', timeout: 'Timed out', network: 'Upstream did not answer', auth: 'Sign-in required', not_found: 'Not found', bad_request: 'Request could not be used', internal: 'Internal error' };
const STATUS_TITLE = { 400: 'Bad request', 401: 'Sign-in required', 403: 'Not allowed', 404: 'Not found', 405: 'Method not allowed', 409: 'Conflict', 410: 'Gone', 413: 'Too large', 415: 'Unsupported media type', 422: 'Could not be processed', 429: 'Too many requests', 500: 'Internal error', 502: 'Upstream did not answer', 503: 'Service unavailable', 504: 'Timed out' };
const occurrence = () => { const b = crypto.getRandomValues(new Uint8Array(8)); return 'urn:ultrastable:occurrence:' + [...b].map(x => x.toString(16).padStart(2, '0')).join(''); };
export function problem(p, instance) {
  const code = String(p.code || 'internal'), status = Number(p.status) || 500;
  return { type: PROBLEM_TYPE + code.replace(/[^A-Za-z0-9_.-]+/g, '-'), title: TITLES[code] || STATUS_TITLE[status] || 'Error', status, detail: String(p.message || ''), instance: instance || occurrence() };
}
const raw = e => String((e && (e.message || e.stack)) || e || '');
export function classify(e) {
  if (e && e.userSafe) return e.code || 'bad_request';
  const m = raw(e);
  if (/free tier|row read limit|7500|exceeded|quota|rate.?limit|too many requests/i.test(m)) return 'limit';
  if (/timed? ?out|timeout|aborted/i.test(m)) return 'timeout';
  if (/fetch failed|network|ECONN|ENOTFOUND|socket|dns|unreachable/i.test(m)) return 'network';
  if (/unauthori[sz]ed|forbidden|expired token|bad credentials|401|403/i.test(m)) return 'auth';
  return 'internal';
}
// opts.fallback = { code, status, message }: for a surface whose unexpected errors are the caller's input failing (a rejected sign-in), not an outage.
export function plain(e, opts = {}) {
  if (e && e.userSafe) return { code: e.code || 'bad_request', status: e.status || 400, message: String(e.message).slice(0, 240) };
  const code = classify(e);
  if (opts.fallback && code === 'internal') return { code: opts.fallback.code, status: opts.fallback.status, message: opts.fallback.message };
  const [message, status] = WORDS[code] || WORDS.internal;
  return { code, status, message };
}
export function backendRecord(e, where = 'unknown', opts = {}) {
  const rec = { at: new Date().toISOString(), where, code: classify(e), detail: raw(e).slice(0, 600), user_safe: Boolean(e && e.userSafe), ...(opts.instance ? { instance: opts.instance } : {}) };
  try { console.error('backend_error', JSON.stringify(rec)); } catch (_) { /* allow-silent: the console itself failed; the audit hook below still records it */ }
  if (typeof opts.audit === 'function') Promise.resolve().then(() => opts.audit(rec)).catch(x => console.error('backend_error audit failed', raw(x).slice(0, 160)));
  return rec;
}
export function userError(e, where, opts = {}) {
  const instance = opts.instance || occurrence();
  backendRecord(e, where, { ...opts, instance });
  const p = plain(e, opts);
  return { ok: false, code: p.code, error: p.message, ...problem(p, instance) };
}
export function userJson(e, where, opts = {}) {
  const body = userError(e, where, opts);
  return new Response(JSON.stringify(body), { status: body.status, headers: { 'content-type': PROBLEM_CONTENT_TYPE, 'cache-control': 'no-store' } });
}
